import { InboxMessage } from '../domain/inbox/inbox-message';
import { Money, type MoneyProps } from '../domain/money/money';
import { OutboxMessage } from '../domain/outbox/outbox-message';
import type { FailureCode } from '../domain/transaction/failure-code';
import { WagerTransaction } from '../domain/transaction/wager-transaction';
import { InvalidWagerTransactionError } from '../domain/transaction/wager-transaction.errors';
import type { WagerTransactionKind } from '../domain/transaction/wager-transaction-kind';
import type { WagerTransactionStatus } from '../domain/transaction/wager-transaction-status';
import { IdempotencyConflictError, InboxPayloadMismatchError, UniqueViolationError } from './errors';
import { computePayloadHash } from './payload-hash';
import type {
  StoredTransaction,
  WageringTransactionScope,
  WageringUnitOfWork,
} from './ports/wagering-unit-of-work.port';
import { uuidv7 } from './uuid-v7';
import { buildWagerEvents } from './wager-events';
import { WagerTransactionProcessor } from './wager-transaction-processor';
import { NOOP_WAGERING_METRICS, type WageringMetrics } from './ports/wagering-metrics.port';
import { databaseLockConflictType } from './transient-error';

export interface TransactionDecision {
  transactionId: string;
  status: string;
  failureCode: string | undefined;
  replay: boolean;
  kind: string;
  walletId: string;
  providerId: string;
  correlationId: string | undefined;
  /** messageId da fila, quando a entrada foi SQS. */
  messageId: string | undefined;
}

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
  /** Só o consumer SQS informa: deduplicação persistente por (consumerName, messageId). */
  inbox?: { consumerName: string; messageId: string } | undefined;
  metrics?: WageringMetrics;
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
  metrics?: WageringMetrics;
  onDecision?: (decision: TransactionDecision) => void;
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
  private readonly metrics: WageringMetrics;
  private readonly onDecision: ((decision: TransactionDecision) => void) | undefined;

  constructor(
    private readonly uow: WageringUnitOfWork,
    options: SubmitWagerTransactionOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? (() => uuidv7());
    this.pendingReferenceBackoffMs = options.pendingReferenceBackoffMs ?? 1_000;
    this.processor = new WagerTransactionProcessor(this.newId);
    this.metrics = options.metrics ?? NOOP_WAGERING_METRICS;
    this.onDecision = options.onDecision;
  }

  async execute(command: SubmitWagerTransactionCommand): Promise<SubmitWagerTransactionResult> {
    const started = performance.now();
    let outcome = 'error';

    try {
      const prepared = this.prepare(command);

      for (let attempt = 1; ; attempt += 1) {
        try {
          const result = await this.uow.run((scope) => this.executeInScope(scope, prepared));
          // Fora do uow.run: só conta depois do commit e uma única vez, mesmo com retry.
          this.recordResult(command, result);
          this.notifyDecision(command, result);
          outcome = result.status.toLowerCase();
          return result;
        } catch (error) {
          // Corrida entre inserts da mesma chave: a transação perdedora foi revertida;
          // refazer encontra a vencedora e responde como replay.
          if (error instanceof UniqueViolationError && attempt < MAX_ATTEMPTS) continue;
          throw error;
        }
      }
    } catch (error) {
      this.recordFailure(error);
      throw error;
    } finally {
      this.metrics.processingTime((performance.now() - started) / 1000, outcome);
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
    const lockStarted = performance.now();
    const wallet = await scope.lockWallet(command.walletId);
    this.metrics.walletLockWaited((performance.now() - lockStarted) / 1000);

    // 2) Inbox (só mensagens vindas da fila). Vem antes da idempotência: se o mesmo
    //    messageId chegar com outra Idempotency-Key, só o inbox impede um novo processamento.
    if (command.inbox !== undefined) {
      const received = await scope.findInboxMessage(
        command.inbox.consumerName,
        command.inbox.messageId,
      );
      if (received !== undefined) {
        if (!received.matchesPayload(payloadHash)) {
          throw new InboxPayloadMismatchError(command.inbox.consumerName, command.inbox.messageId);
        }
        // O inbox só é gravado junto com a transação: se existe, a transação existe.
        const original = await scope.findTransactionByExternalId(
          command.providerId,
          command.externalTransactionId,
        );
        if (original === undefined) {
          throw new Error(`inbox message ${command.inbox.messageId} has no stored transaction`);
        }
        return this.replay(original, payloadHash, command.idempotencyKey);
      }
    }

    // 3) Idempotência persistente.
    const byKey = await scope.findTransactionByIdempotencyKey(command.idempotencyKey);
    if (byKey !== undefined) {
      const replayed = this.replay(byKey, payloadHash, command.idempotencyKey);
      // A transação pode ter sido criada antes por HTTP: registra o messageId desta entrega.
      this.recordInbox(scope, command, payloadHash, this.now());
      return replayed;
    }

    const byExternal = await scope.findTransactionByExternalId(
      command.providerId,
      command.externalTransactionId,
    );
    if (byExternal !== undefined) {
      throw new IdempotencyConflictError(command.idempotencyKey, 'DUPLICATE_EXTERNAL_TRANSACTION');
    }

    // 4) Regras de negócio.
    const now = this.now();
    const tx = build();
    const result = await this.processor.process(scope, tx, wallet, now);
    if (result.outcome === 'pending_reference') tx.markPendingReference();

    // 5) Persistência: wallet + transação juntas; ledger depois (FK); tudo no mesmo commit.
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

    // 6) Outbox: os eventos entram na MESMA transação SQL (nada é publicado aqui).
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
    this.recordInbox(scope, command, payloadHash, now);

    return {
      transactionId: tx.id,
      status: tx.status,
      failureCode: tx.failureCode,
      balance: observedBalance,
      idempotentReplay: false,
    };
  }

  /** Mesma transação SQL do saldo, do ledger e da outbox. */
  private recordInbox(
    scope: WageringTransactionScope,
    command: SubmitWagerTransactionCommand,
    payloadHash: string,
    at: Date,
  ): void {
    if (command.inbox === undefined) return;
    const message = InboxMessage.receive({
      messageId: command.inbox.messageId,
      consumerName: command.inbox.consumerName,
      payloadHash,
      receivedAt: at,
    });
    message.markProcessed(at); // recebimento e processamento confirmam juntos, no mesmo commit
    scope.saveInboxMessage(message);
  }

  private recordResult(command: SubmitWagerTransactionCommand, result: SubmitWagerTransactionResult): void {
    if (result.idempotentReplay) this.metrics.duplicateDetected('replay');
    else this.metrics.transactionDecided(result.status, command.kind);
  }

  private notifyDecision(command: SubmitWagerTransactionCommand, result: SubmitWagerTransactionResult): void {
    try {
      this.onDecision?.({
        transactionId: result.transactionId,
        status: result.status,
        failureCode: result.failureCode,
        replay: result.idempotentReplay,
        kind: command.kind,
        walletId: command.walletId,
        providerId: command.providerId,
        correlationId: command.correlationId,
        messageId: command.inbox?.messageId,
      });
    } catch {
      // um listener com defeito não pode afetar o resultado financeiro
    }
  }

  private recordFailure(error: unknown): void {
    if (error instanceof IdempotencyConflictError) {
      this.metrics.duplicateDetected(
        error.reason === 'PAYLOAD_MISMATCH' ? 'payload_mismatch' : 'duplicate_external_transaction',
      );
    } else if (error instanceof InboxPayloadMismatchError) {
      this.metrics.duplicateDetected('inbox_payload_mismatch');
    }
    const lockConflict = databaseLockConflictType(error);
    if (lockConflict !== undefined) this.metrics.lockConflict(lockConflict);
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