import { HttpException } from '@nestjs/common';
import {
  IdempotencyConflictError,
  InvalidQueryError,
  ResourceNotFoundError,
  UniqueViolationError,
  WalletAlreadyExistsError,
} from '../../application/errors';
import { isTransientDatabaseError } from '../../application/transient-error';
import { InvalidLedgerEntryError } from '../../domain/ledger/ledger.errors';
import { InvalidMoneyError } from '../../domain/money/money.errors';
import { InvalidWagerTransactionError } from '../../domain/transaction/wager-transaction.errors';
import { InvalidWalletOperationError } from '../../domain/wallet/wallet.errors';

export { isTransientDatabaseError };

export interface ErrorBody {
  statusCode: number;
  error: string;
  message: string;
  details?: unknown;
}

export interface MappedError {
  statusCode: number;
  body: ErrorBody;
  retryAfterSeconds?: number;
}

function fail(statusCode: number, error: string, message: string, details?: unknown): MappedError {
  return {
    statusCode,
    body: { statusCode, error, message, ...(details !== undefined ? { details } : {}) },
  };
}

function isValidationError(error: unknown): error is Error {
  return (
    error instanceof InvalidMoneyError ||
    error instanceof InvalidWagerTransactionError ||
    error instanceof InvalidWalletOperationError ||
    error instanceof InvalidLedgerEntryError ||
    error instanceof InvalidQueryError
  );
}

function fromHttpException(error: HttpException): MappedError {
  const status = error.getStatus();
  const response = error.getResponse();
  const messages =
    typeof response === 'object' && response !== null
      ? (response as { message?: unknown }).message
      : undefined;

  if (status === 400) {
    // O ValidationPipe devolve a lista de campos inválidos em "message".
    return Array.isArray(messages)
      ? fail(400, 'VALIDATION_ERROR', 'Request validation failed', messages)
      : fail(400, 'VALIDATION_ERROR', error.message);
  }
  return fail(status, status === 404 ? 'NOT_FOUND' : `HTTP_${status}`, error.message);
}

export function mapError(error: unknown): MappedError {
  if (error instanceof IdempotencyConflictError) {
    return fail(409, 'IDEMPOTENCY_CONFLICT', error.message, { reason: error.reason });
  }
  if (error instanceof WalletAlreadyExistsError) {
    return fail(409, 'WALLET_ALREADY_EXISTS', error.message);
  }
  if (error instanceof ResourceNotFoundError) {
    return fail(404, 'NOT_FOUND', error.message, { resource: error.resource });
  }
  if (isValidationError(error)) {
    return fail(400, 'VALIDATION_ERROR', error.message);
  }
  if (error instanceof HttpException) {
    return fromHttpException(error);
  }
  if (error instanceof UniqueViolationError || isTransientDatabaseError(error)) {
    return {
      ...fail(503, 'SERVICE_UNAVAILABLE', 'Service temporarily unavailable, retry later'),
      retryAfterSeconds: 1,
    };
  }
  return fail(500, 'INTERNAL_ERROR', 'Internal server error'); // nunca vaza detalhe interno
}