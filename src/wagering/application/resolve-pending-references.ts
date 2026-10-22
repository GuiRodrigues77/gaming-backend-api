import { OutboxMessage } from '../domain/outbox/outbox-message';
import { FailureCode } from '../domain/transaction/failure-code';
import { WagerTransactionStatus } from '../domain/transaction/wager-transaction-status';
import {
  DEFAULT_PENDING_REFERENCE_POLICY,
  pendingReferenceDelayMs,
  type PendingReferencePolicy,
} from './pending-reference-policy';
import type {
  DuePendingReference,
  PendingReferenceScope,
  PendingReferenceUnitOfWork,
} from './ports/pending-reference.port';
import { uuidv7 } from './uuid-v7';
import { buildWagerEvents } from './wager-events';
import { WagerTransactionProcessor } from './wager-transaction-processor';

export type ResolveOutcome = 'resolved' | 'rejected' | 'expired' | 'still_pending' | 'skipped';

export interface ResolvePendingReferencesResult {
  /** Candidatas encontradas. */
  claimed: number;
  /** Viraram PROCESSED. */
  resolved: number;
  /** Viraram REJECTED por regra de negócio. */
  rejected: number;
  /** Viraram REJECTED por esgotar as tentativas (REFERENCE_NOT_FOUND). */
  expired: number;
  /** A referência ainda não chegou: nova tentativa agendada. */
  stillPending: number;
  /** Outra instância já tinha decidido, ou ainda não era a hora. */
  skipped: number;
  /** Erro inesperado: a transação continua pendente e volta na próxima rodada. */
  failed: number;
}

export interface ResolvePendingReferencesOptions {
  policy?: PendingReferencePolicy;
  batchSize?: number;
  now?: () => Date;
  newId?: () => string;
  onError?: (error: unknown, reference: DuePendingReference) => void;
}

export class ResolvePendingReferences {
  private readonly policy: PendingReferencePolicy;
  private readonly batchSize: number;
  private readonly now: () => Date;
  private readonly newId: () => string;
  private readonly onError: (error: unknown, reference: DuePendingReference) => void;
  private readonly processor: WagerTransactionProcessor;

  constructor(
    private readonly uow: PendingReferenceUnitOfWork,
    options: ResolvePendingReferencesOptions = {},
  ) {
    this.policy = options.policy ?? DEFAULT_PENDING_REFERENCE_POLICY;
    this.batchSize = options.batchSize ?? 20;
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? (() => uuidv7());
    this.onError = options.onError ?? (() => undefined);
    this.processor = new WagerTransactionProcessor(this.newId);
  }

  /** Uma rodada: avalia as pendentes que já estão na hora. */
  async runOnce(): Promise<ResolvePendingReferencesResult> {
    const due = await this.uow.listDue(this.batchSize, this.now());
    const result: ResolvePendingReferencesResult = {
      claimed: due.length,
      resolved: 0,
      rejected: 0,
      expired: 0,
      stillPending: 0,
      skipped: 0,
      failed: 0,
    };

    for (const reference of due) {
      try {
        const outcome = await this.uow.run((scope) => this.resolveOne(scope, reference));
        switch (outcome) {
          case 'resolved':
            result.resolved += 1;
            break;
          case 'rejected':
            result.rejected += 1;
            break;
          case 'expired':
            result.expired += 1;
            break;
          case 'still_pending':
            result.stillPending += 1;
            break;
          case 'skipped':
            result.skipped += 1;
            break;
        }
      } catch (error) {
        result.failed += 1; // a transação SQL foi desfeita; ela continua pendente
        this.onError(error, reference);
      }
    }
    return result;
  }

  private async resolveOne(
    scope: PendingReferenceScope,
    reference: DuePendingReference,
  ): Promise<ResolveOutcome> {
    // Mesma ordem de locks do SubmitWagerTransaction: primeiro a wallet, depois a transação.
    const wallet = await scope.lockWallet(reference.walletId);
    const now = this.now();

    const pending = await scope.lockDuePending(reference.transactionId, now);
    if (pending === undefined) return 'skipped';

    const { transaction: tx, attempts } = pending;
    const result = await this.processor.process(scope, tx, wallet, now);

    const expired = result.outcome === 'pending_reference';
    if (expired) {
      const nextAttempts = attempts + 1;
      if (nextAttempts < this.policy.maxAttempts) {
        // A referência ainda não chegou: conta a tentativa e agenda a próxima.
        scope.savePending(tx, {
          attempts: nextAttempts,
          nextAttemptAt: new Date(now.getTime() + pendingReferenceDelayMs(nextAttempts, this.policy)),
        });
        return 'still_pending';
      }
      tx.reject(FailureCode.ReferenceNotFound); // esgotou o limite (README 7.1)
    }

    const outcome =
      tx.status === WagerTransactionStatus.Processed ? ('processed' as const) : ('rejected' as const);
    const ledgerEntry = result.ledgerEntry;

    // Nunca expor o saldo de uma wallet de outro jogador (mesma regra do submit).
    const observedBalance =
      wallet !== undefined &&
      wallet.playerId === tx.playerId &&
      wallet.currency === tx.money.currency
        ? wallet.balance
        : undefined;

    if (wallet !== undefined && ledgerEntry !== undefined) scope.saveWallet(wallet);
    scope.savePending(tx, { attempts, nextAttemptAt: undefined, observedBalance });
    if (wallet !== undefined && ledgerEntry !== undefined) {
      scope.appendLedgerEntry(ledgerEntry, wallet.version);
    }

    // Eventos na MESMA transação SQL. O id da transação serve de correlationId: a
    // correlação da requisição original não é persistida.
    const events = buildWagerEvents({
      transaction: tx,
      outcome,
      wallet,
      ledgerEntry,
      correlationId: tx.id,
      newId: this.newId,
      now,
    });
    for (const event of events) scope.enqueueOutbox(OutboxMessage.enqueue(event));

    if (expired) return 'expired';
    return outcome === 'processed' ? 'resolved' : 'rejected';
  }
}