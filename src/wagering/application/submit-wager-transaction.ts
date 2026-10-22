import { Money, type MoneyProps } from '../domain/money/money';
import { OutboxMessage } from '../domain/outbox/outbox-message';
import type { FailureCode } from '../domain/transaction/failure-code';
import { WagerTransaction } from '../domain/transaction/wager-transaction';
import { InvalidWagerTransactionError } from '../domain/transaction/wager-transaction.errors';
import type { WagerTransactionKind } from '../domain/transaction/wager-transaction-kind';
import type { WagerTransactionStatus } from '../domain/transaction/wager-transaction-status';
import { IdempotencyConflictError, UniqueViolationError } from './errors';
import { computePayloadHash } from './payload-hash';
import type {
  StoredTransaction,
  WageringTransactionScope,
  WageringUnitOfWork,
} from './ports/wagering-unit-of-work.port';
import { uuidv7 } from './uuid-v7';
import { buildWagerEvents } from './wager-events';
import { WagerTransactionProcessor } from './wager-transaction-processor';

export interface SubmitWagerTransactionCommand {
  idempotencyKey: string;
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: string;
  money: MoneyProps;
  referenceExternalTransactionId?: string | undefined;
  /** Para rastrear a requisição nos eventos e logs. Se ausente, é gerado. */
  correlationId?: string | undefined;
}

export interface SubmitWagerTransactionResult {
  transactionId: string;
  status: WagerTransactionStatus;
  failureCode: FailureCode | undefined;
  balance: Money | undefined;
  idempotentReplay: boolean;
}

export interface SubmitWagerTransactionOptions {
  now?: () => Date;
  newId?: () => string;
  /** Atraso até a primeira reavaliação de uma transação PENDING_REFERENCE. */
  pendingReferenceBackoffMs?: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ATTEMPTS = 5;

interface Prepared {
  command: SubmitWagerTransactionCommand;
  payloadHash: string;
  build: () => WagerTransaction;
}

export class SubmitWagerTransaction {
  private readonly now: () => Date;
  private readonly newId: () => string;
  private readonly pendingReferenceBackoffMs: number;
  private readonly processor: WagerTransactionProcessor;

  constructor(
    private readonly uow: WageringUnitOfWork,
    options: SubmitWagerTransactionOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? (() => uuidv7());
    this.pendingReferenceBackoffMs = options.pendingReferenceBackoffMs ?? 1_000;
    this.processor = new WagerTransactionProcessor(this.newId);
  }

  async execute(command: SubmitWagerTransactionCommand): Promise<SubmitWagerTransactionResult> {
    const prepared = this.prepare(command);

    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.uow.run((scope) => this.executeInScope(scope, prepared));
      } catch (error) {
        // Corrida entre inserts da mesma chave: a transação perdedora foi revertida;
        // refazer encontra a vencedora e responde como replay.
        if (error instanceof UniqueViolationError && attempt < MAX_ATTEMPTS) continue;
        throw error;
      }
    }
  }

  /** Validação de entrada e cálculo do hash, antes de qualquer acesso ao banco. */
  private prepare(command: SubmitWagerTransactionCommand): Prepared {
    for (const field of ['walletId', 'playerId'] as const) {
      const value = command[field];
      if (typeof value !== 'string' || !UUID.test(value)) {
        throw new InvalidWagerTransactionError(`${field} must be a UUID`);
      }
    }
    const money = Money.from(command.money);
    const payloadHash = computePayloadHash({
      providerId: command.providerId,
      externalTransactionId: command.externalTransactionId,
      playerId: command.playerId,
      walletId: command.walletId,
      roundId: command.roundId,
      gameId: command.gameId,
      kind: command.kind,
      money: money.toJSON(),
      referenceExternalTransactionId: command.referenceExternalTransactionId,
    });
    const createdAt = this.now();

    // Uma instância nova por tentativa: uma tentativa que falhou pode deixar a anterior mutada.
    const build = () =>
      WagerTransaction.create({
        id: this.newId(),
        providerId: command.providerId,
        externalTransactionId: command.externalTransactionId,
        idempotencyKey: command.idempotencyKey,
        payloadHash,
        walletId: command.walletId,
        playerId: command.playerId,
        roundId: command.roundId,
        gameId: command.gameId,
        kind: command.kind as WagerTransactionKind,
        money,
        referenceExternalTransactionId: command.referenceExternalTransactionId,
        createdAt,
      });
    build(); // valida o payload (lança InvalidWagerTransactionError)

    return { command, payloadHash, build };
  }

  private async executeInScope(
    scope: WageringTransactionScope,
    { command, payloadHash, build }: Prepared,
  ): Promise<SubmitWagerTransactionResult> {
    // 1) Trava a wallet ANTES de consultar a idempotência: requisições da mesma wallet
    //    se serializam e a checagem abaixo deixa de ter corrida.
    const wallet = await scope.lockWallet(command.walletId);

    // 2) Idempotência persistente.
    const byKey = await scope.findTransactionByIdempotencyKey(command.idempotencyKey);
    if (byKey !== undefined) return this.replay(byKey, payloadHash, command.idempotencyKey);

    const byExternal = await scope.findTransactionByExternalId(
      command.providerId,
      command.externalTransactionId,
    );
    if (byExternal !== undefined) {
      throw new IdempotencyConflictError(command.idempotencyKey, 'DUPLICATE_EXTERNAL_TRANSACTION');
    }

    // 3) Regras de negócio.
    const now = this.now();
    const tx = build();
    const result = await this.processor.process(scope, tx, wallet, now);
    if (result.outcome === 'pending_reference') tx.markPendingReference();

    // 4) Persistência: wallet + transação juntas; ledger depois (FK); tudo no mesmo commit.
    if (wallet !== undefined && result.ledgerEntry !== undefined) scope.saveWallet(wallet);

    const observedBalance =
      wallet !== undefined &&
      wallet.playerId === tx.playerId &&
      wallet.currency === tx.money.currency
        ? wallet.balance
        : undefined; // nunca expor saldo de wallet de outro jogador

    await scope.saveNewTransaction(tx, {
      observedBalance,
      nextAttemptAt:
        result.outcome === 'pending_reference'
          ? new Date(now.getTime() + this.pendingReferenceBackoffMs)
          : undefined,
    });
    if (wallet !== undefined && result.ledgerEntry !== undefined) {
      scope.appendLedgerEntry(result.ledgerEntry, wallet.version);
    }

    // 5) Outbox: os eventos entram na MESMA transação SQL (nada é publicado aqui).
    const events = buildWagerEvents({
      transaction: tx,
      outcome: result.outcome,
      wallet,
      ledgerEntry: result.ledgerEntry,
      correlationId: command.correlationId ?? this.newId(),
      newId: this.newId,
      now,
    });
    for (const event of events) scope.enqueueOutbox(OutboxMessage.enqueue(event));

    return {
      transactionId: tx.id,
      status: tx.status,
      failureCode: tx.failureCode,
      balance: observedBalance,
      idempotentReplay: false,
    };
  }

  private replay(
    stored: StoredTransaction,
    payloadHash: string,
    idempotencyKey: string,
  ): SubmitWagerTransactionResult {
    if (!stored.transaction.matchesPayload(payloadHash)) {
      throw new IdempotencyConflictError(idempotencyKey, 'PAYLOAD_MISMATCH');
    }
    return {
      transactionId: stored.transaction.id,
      status: stored.transaction.status,
      failureCode: stored.transaction.failureCode,
      balance: stored.observedBalance,
      idempotentReplay: true,
    };
  }
}