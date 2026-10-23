export type DuplicateReason =
  | 'replay' // mesma operação reenviada: devolveu o resultado original
  | 'payload_mismatch' // mesma Idempotency-Key com payload diferente
  | 'duplicate_external_transaction' // mesmo externalTransactionId com outra chave
  | 'inbox_payload_mismatch'; // mesmo messageId com payload diferente

export type RetryComponent = 'use_case' | 'outbox' | 'consumer';

export type LockConflictType =
  | 'unique_violation' // corrida entre inserts: a transação perdedora refaz
  | 'deadlock'
  | 'serialization_failure'
  | 'lock_not_available';

export type PendingReferenceOutcome = 'processed' | 'rejected' | 'expired';

export interface WageringMetrics {
  /** Decisão de uma transação nova (replay não entra aqui). */
  transactionDecided(status: string, kind: string): void;
  /** Desfecho das pendentes de referência, resolvidas pelo worker. */
  pendingReferenceResolved(outcome: PendingReferenceOutcome, count: number): void;
  duplicateDetected(reason: DuplicateReason): void;
  retried(component: RetryComponent): void;
  deadLettered(reason: string): void;
  lockConflict(type: LockConflictType): void;
  /** Tempo esperando o SELECT ... FOR UPDATE da wallet. */
  walletLockWaited(seconds: number): void;
  /** Latência total do use case, incluindo as refeições por corrida. */
  processingTime(seconds: number, outcome: string): void;
}

export const NOOP_WAGERING_METRICS: WageringMetrics = {
  transactionDecided: () => undefined,
  pendingReferenceResolved: () => undefined,
  duplicateDetected: () => undefined,
  retried: () => undefined,
  deadLettered: () => undefined,
  lockConflict: () => undefined,
  walletLockWaited: () => undefined,
  processingTime: () => undefined,
};

export const WAGERING_METRICS = Symbol('WAGERING_METRICS');

/** O que o endpoint /metrics precisa saber, sem conhecer o Prometheus. */
export interface MetricsRenderer {
  readonly contentType: string;
  render(): Promise<string>;
}

export const METRICS_RENDERER = Symbol('METRICS_RENDERER');