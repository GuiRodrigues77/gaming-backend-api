import { InvalidWagerMessageError } from './errors';
import type { SubmitWagerTransactionCommand } from './submit-wager-transaction';

export const WAGER_MESSAGE_TYPE = 'WagerTransactionRequested';

/** OPENING é interno: não é aceito pela fila, igual à API HTTP. */
const SUBMITTABLE_KINDS = new Set(['BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK']);

export interface ParsedWagerMessage {
  messageId: string;
  occurredAt: Date;
  command: SubmitWagerTransactionCommand;
}

export interface ParseWagerMessageOptions {
  consumerName: string;
  /** Vem do atributo da mensagem, se houver. Sem ele, o use case gera um. */
  correlationId?: string | undefined;
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new InvalidWagerMessageError(`${what} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requiredString(
  source: Record<string, unknown>,
  field: string,
  maxLength: number,
  path: string = field,
): string {
  const value = source[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new InvalidWagerMessageError(`${path} must be a non-empty string`);
  }
  if (value.length > maxLength) {
    throw new InvalidWagerMessageError(`${path} must have at most ${maxLength} characters`);
  }
  return value;
}

/**
 * Valida só o formato do envelope e dos tipos. As regras de domínio (UUID, dinheiro, referência)
 * continuam sendo do use case, o mesmo da API HTTP; o que ele recusar também é erro permanente.
 */
export function parseWagerMessage(body: string, options: ParseWagerMessageOptions): ParsedWagerMessage {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new InvalidWagerMessageError('message body is not valid JSON');
  }

  const envelope = asRecord(json, 'message');
  const messageId = requiredString(envelope, 'messageId', 200);
  if (envelope.type !== WAGER_MESSAGE_TYPE) {
    throw new InvalidWagerMessageError(`unsupported message type, expected ${WAGER_MESSAGE_TYPE}`);
  }
  const occurredAt = new Date(requiredString(envelope, 'occurredAt', 64));
  if (Number.isNaN(occurredAt.getTime())) {
    throw new InvalidWagerMessageError('occurredAt must be an ISO-8601 date');
  }

  const data = asRecord(envelope.data, 'data');
  const money = asRecord(data.money, 'data.money');
  const kind = requiredString(data, 'kind', 20, 'data.kind');
  if (!SUBMITTABLE_KINDS.has(kind)) {
    throw new InvalidWagerMessageError('data.kind is not a submittable kind');
  }
  const reference =
    data.referenceExternalTransactionId === undefined || data.referenceExternalTransactionId === null
      ? undefined
      : requiredString(data, 'referenceExternalTransactionId', 200, 'data.referenceExternalTransactionId');

  return {
    messageId,
    occurredAt,
    command: {
      idempotencyKey: requiredString(data, 'idempotencyKey', 255, 'data.idempotencyKey'),
      providerId: requiredString(data, 'providerId', 100, 'data.providerId'),
      externalTransactionId: requiredString(data, 'externalTransactionId', 200, 'data.externalTransactionId'),
      playerId: requiredString(data, 'playerId', 64, 'data.playerId'),
      walletId: requiredString(data, 'walletId', 64, 'data.walletId'),
      roundId: requiredString(data, 'roundId', 200, 'data.roundId'),
      gameId: requiredString(data, 'gameId', 200, 'data.gameId'),
      kind,
      money: {
        amount: requiredString(money, 'amount', 40, 'data.money.amount'),
        currency: requiredString(money, 'currency', 3, 'data.money.currency'),
      },
      referenceExternalTransactionId: reference,
      correlationId: options.correlationId,
      inbox: { consumerName: options.consumerName, messageId },
    },
  };
}