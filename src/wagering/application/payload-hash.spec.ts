import { describe, expect, test } from 'bun:test';
import { canonicalJson, computePayloadHash, type PayloadHashInput } from './payload-hash';

const base: PayloadHashInput = {
  providerId: 'provider-a',
  externalTransactionId: 'tx-1',
  playerId: 'p',
  walletId: 'w',
  roundId: 'r',
  gameId: 'g',
  kind: 'BET',
  money: { amount: '25.00', currency: 'BRL' },
};

describe('canonicalJson', () => {
  test('ordena chaves recursivamente e omite undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: undefined, e: [3, { z: 1, y: 2 }] } })).toBe(
      '{"a":{"d":2,"e":[3,{"y":2,"z":1}]},"b":1}',
    );
  });
});

describe('computePayloadHash', () => {
  test('é determinístico e independente da ordem das chaves', () => {
    const reordered = {
      money: { currency: 'BRL', amount: '25.00' },
      kind: 'BET',
      gameId: 'g',
      roundId: 'r',
      walletId: 'w',
      playerId: 'p',
      externalTransactionId: 'tx-1',
      providerId: 'provider-a',
    };
    expect(computePayloadHash(reordered)).toBe(computePayloadHash(base));
    expect(computePayloadHash(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  test('qualquer campo de negócio diferente muda o hash', () => {
    const h = computePayloadHash(base);
    expect(computePayloadHash({ ...base, money: { amount: '25.01', currency: 'BRL' } })).not.toBe(h);
    expect(computePayloadHash({ ...base, kind: 'WIN' })).not.toBe(h);
    expect(computePayloadHash({ ...base, roundId: 'r2' })).not.toBe(h);
    expect(computePayloadHash({ ...base, referenceExternalTransactionId: 'x' })).not.toBe(h);
  });
});