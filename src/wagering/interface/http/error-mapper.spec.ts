import { describe, expect, test } from 'bun:test';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  IdempotencyConflictError,
  InvalidQueryError,
  ResourceNotFoundError,
  UniqueViolationError,
  WalletAlreadyExistsError,
} from '../../application/errors';
import { InvalidMoneyError } from '../../domain/money/money.errors';
import { InvalidWagerTransactionError } from '../../domain/transaction/wager-transaction.errors';
import { isTransientDatabaseError, mapError } from './error-mapper';

describe('mapError', () => {
  test('conflito de idempotência => 409 com o motivo', () => {
    const mapped = mapError(new IdempotencyConflictError('key-1', 'PAYLOAD_MISMATCH'));
    expect(mapped.statusCode).toBe(409);
    expect(mapped.body.error).toBe('IDEMPOTENCY_CONFLICT');
    expect(mapped.body.details).toEqual({ reason: 'PAYLOAD_MISMATCH' });
  });

  test('wallet duplicada => 409', () => {
    const mapped = mapError(new WalletAlreadyExistsError('player-1', 'BRL'));
    expect(mapped.statusCode).toBe(409);
    expect(mapped.body.error).toBe('WALLET_ALREADY_EXISTS');
  });

  test('não encontrado => 404', () => {
    expect(mapError(new ResourceNotFoundError('wallet', 'x')).statusCode).toBe(404);
  });

  test('erros de validação de domínio e de consulta => 400', () => {
    for (const error of [
      new InvalidMoneyError('x'),
      new InvalidWagerTransactionError('x'),
      new InvalidQueryError('x'),
    ]) {
      const mapped = mapError(error);
      expect(mapped.statusCode).toBe(400);
      expect(mapped.body.error).toBe('VALIDATION_ERROR');
    }
  });

  test('erros do ValidationPipe viram VALIDATION_ERROR com a lista de campos', () => {
    const mapped = mapError(new BadRequestException({ message: ['playerId must be a UUID'] }));
    expect(mapped.statusCode).toBe(400);
    expect(mapped.body.details).toEqual(['playerId must be a UUID']);
  });

  test('HttpException de outros status mantém o status', () => {
    expect(mapError(new NotFoundException('nope')).body.error).toBe('NOT_FOUND');
  });

  test('falha transitória e corrida de unicidade => 503 com Retry-After', () => {
    const connection = mapError(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }));
    expect(connection.statusCode).toBe(503);
    expect(connection.retryAfterSeconds).toBe(1);
    expect(mapError(new UniqueViolationError(new Error('dup'))).statusCode).toBe(503);
  });

  test('erro desconhecido => 500 sem vazar a mensagem', () => {
    const mapped = mapError(new Error('select * from segredo'));
    expect(mapped.statusCode).toBe(500);
    expect(mapped.body.message).toBe('Internal server error');
  });
});

describe('isTransientDatabaseError', () => {
  test('reconhece código, mensagem e causa aninhada', () => {
    expect(isTransientDatabaseError(Object.assign(new Error('x'), { code: '40P01' }))).toBe(true);
    expect(isTransientDatabaseError(new Error('Connection terminated unexpectedly'))).toBe(true);
    expect(isTransientDatabaseError(new Error('outer', { cause: { code: '57P01' } }))).toBe(true);
  });

  test('erros comuns não são transitórios', () => {
    expect(isTransientDatabaseError(new Error('bug'))).toBe(false);
    expect(isTransientDatabaseError(undefined)).toBe(false);
  });
});