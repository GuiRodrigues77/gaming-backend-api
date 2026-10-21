export type IdempotencyConflictReason = 'PAYLOAD_MISMATCH' | 'DUPLICATE_EXTERNAL_TRANSACTION';

/** Mesma chave com payload diferente, ou mesmo externalTransactionId com outra chave. */
export class IdempotencyConflictError extends Error {
  constructor(
    public readonly idempotencyKey: string,
    public readonly reason: IdempotencyConflictReason,
  ) {
    super(`Idempotency conflict (${reason}) for key ${idempotencyKey}`);
    this.name = 'IdempotencyConflictError';
  }
}

/** Violação de unicidade no banco (corrida entre inserts). A aplicação refaz a operação. */
export class UniqueViolationError extends Error {
  constructor(public readonly original: unknown) {
    super('Unique constraint violation');
    this.name = 'UniqueViolationError';
  }
}