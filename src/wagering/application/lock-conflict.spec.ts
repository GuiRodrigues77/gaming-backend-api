import { describe, expect, test } from 'bun:test';
import { databaseLockConflictType } from './transient-error';

describe('databaseLockConflictType', () => {
  test('reconhece deadlock, falha de serialização e lock indisponível', () => {
    expect(databaseLockConflictType({ code: '40P01' })).toBe('deadlock');
    expect(databaseLockConflictType({ code: '40001' })).toBe('serialization_failure');
    expect(databaseLockConflictType({ code: '55P03' })).toBe('lock_not_available');
  });

  test('procura na cadeia de causas', () => {
    expect(databaseLockConflictType({ message: 'wrapped', cause: { code: '40P01' } })).toBe('deadlock');
  });

  test('erros comuns não são conflito de lock', () => {
    expect(databaseLockConflictType(new Error('boom'))).toBeUndefined();
    expect(databaseLockConflictType({ code: '23505' })).toBeUndefined();
    expect(databaseLockConflictType(undefined)).toBeUndefined();
  });
});