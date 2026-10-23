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

export class WalletAlreadyExistsError extends Error {
  constructor(
    public readonly playerId: string,
    public readonly currency: string,
  ) {
    super(`Wallet already exists for player ${playerId} in ${currency}`);
    this.name = 'WalletAlreadyExistsError';
  }
}

export class ResourceNotFoundError extends Error {
  constructor(
    public readonly resource: string,
    public readonly id: string,
  ) {
    super(`${resource} ${id} not found`);
    this.name = 'ResourceNotFoundError';
  }
}

/** Parâmetro de consulta inválido (cursor, limit, id malformado). */
export class InvalidQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidQueryError';
  }
}

/** Mesmo messageId chegando com payload diferente: conflito, não redelivery. */
export class InboxPayloadMismatchError extends Error {
  constructor(
    public readonly consumerName: string,
    public readonly messageId: string,
  ) {
    super(`Inbox message ${messageId} (${consumerName}) was already received with a different payload`);
    this.name = 'InboxPayloadMismatchError';
  }
}

/** Mensagem da fila malformada ou de tipo desconhecido: erro permanente, vai direto para a DLQ. */
export class InvalidWagerMessageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidWagerMessageError';
  }
}