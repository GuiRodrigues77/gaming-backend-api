import { InvalidLedgerEntryError } from '../domain/ledger/ledger.errors';
import { InvalidMoneyError } from '../domain/money/money.errors';
import { InvalidWagerTransactionError } from '../domain/transaction/wager-transaction.errors';
import type { WagerTransactionStatus } from '../domain/transaction/wager-transaction-status';
import { InvalidWalletOperationError } from '../domain/wallet/wallet.errors';
import {
  IdempotencyConflictError,
  InboxPayloadMismatchError,
  InvalidWagerMessageError,
  UniqueViolationError,
} from './errors';
import { isTransientDatabaseError } from './transient-error';

/** Deve ser menor ou igual ao maxReceiveCount da fila (5). O redrive da SQS fica como rede de segurança. */
export const DEFAULT_MAX_ATTEMPTS = 5;

export type DeadLetterReason =
  | 'INVALID_MESSAGE' // JSON ou envelope malformado, tipo desconhecido
  | 'INVALID_PAYLOAD' // o use case recusou os dados (dinheiro, UUID, referência, kind)
  | 'CONFLICT' // chave de idempotência ou messageId com payload diferente
  | 'MAX_ATTEMPTS_EXCEEDED'; // falha repetida de infraestrutura ou erro inesperado

export type RetryReason = 'TRANSIENT' | 'UNEXPECTED';

export type MessageDisposition =
  | {
      action: 'ACK';
      transactionId: string;
      status: WagerTransactionStatus;
      idempotentReplay: boolean;
    }
  | { action: 'RETRY'; visibilityTimeoutSeconds: number; reason: RetryReason }
  | { action: 'DEAD_LETTER'; reason: DeadLetterReason; detail: string };

/** 2s, 4s, 8s, 16s... limitado a 60s. */
export function retryVisibilityTimeoutSeconds(receiveCount: number): number {
  return Math.min(2 * 2 ** Math.max(receiveCount - 1, 0), 60);
}

function detailOf(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text.slice(0, 500);
}

/** Espelha o mapeamento HTTP: o que lá é 400 ou 409 aqui é permanente; 503 é transitório. */
export function classifyFailure(
  error: unknown,
  receiveCount: number,
  maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
): Exclude<MessageDisposition, { action: 'ACK' }> {
  if (error instanceof InvalidWagerMessageError) {
    return { action: 'DEAD_LETTER', reason: 'INVALID_MESSAGE', detail: detailOf(error) };
  }
  if (error instanceof IdempotencyConflictError || error instanceof InboxPayloadMismatchError) {
    return { action: 'DEAD_LETTER', reason: 'CONFLICT', detail: detailOf(error) };
  }
  if (
    error instanceof InvalidMoneyError ||
    error instanceof InvalidWagerTransactionError ||
    error instanceof InvalidWalletOperationError ||
    error instanceof InvalidLedgerEntryError
  ) {
    return { action: 'DEAD_LETTER', reason: 'INVALID_PAYLOAD', detail: detailOf(error) };
  }

  if (receiveCount >= maxAttempts) {
    return { action: 'DEAD_LETTER', reason: 'MAX_ATTEMPTS_EXCEEDED', detail: detailOf(error) };
  }
  const transient = error instanceof UniqueViolationError || isTransientDatabaseError(error);
  return {
    action: 'RETRY',
    visibilityTimeoutSeconds: retryVisibilityTimeoutSeconds(receiveCount),
    reason: transient ? 'TRANSIENT' : 'UNEXPECTED',
  };
}