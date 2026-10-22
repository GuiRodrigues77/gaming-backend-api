import { describe, expect, test } from 'bun:test';
import { InvalidQueryError } from './errors';
import { decodeLedgerCursor, encodeLedgerCursor } from './ledger-cursor';

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

describe('ledger cursor', () => {
  test('ida e volta', () => {
    expect(decodeLedgerCursor(encodeLedgerCursor(42))).toBe(42);
  });

  test('o cursor é opaco (não mostra o número)', () => {
    expect(encodeLedgerCursor(42)).not.toContain('42');
  });

  test.each([
    ['vazio', ''],
    ['lixo', '@@@'],
    ['sem versão', encode({})],
    ['versão zero', encode({ v: 0 })],
    ['versão string', encode({ v: '1' })],
    ['versão decimal', encode({ v: 1.5 })],
    ['versão gigante', encode({ v: 99_999_999_999 })],
    ['array', encode([])],
    ['null', encode(null)],
  ])('rejeita cursor inválido: %s', (_name, cursor) => {
    expect(() => decodeLedgerCursor(cursor)).toThrow(InvalidQueryError);
  });
});