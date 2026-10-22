import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_PENDING_REFERENCE_POLICY,
  pendingReferenceDelayMs,
} from './pending-reference-policy';

describe('pendingReferenceDelayMs', () => {
  test('dobra a cada tentativa e respeita o teto de 60s', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => pendingReferenceDelayMs(n))).toEqual([
      2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000,
    ]);
  });

  test('espera total até a rejeição: cerca de 5 minutos', () => {
    let total = 0;
    for (let n = 1; n < DEFAULT_PENDING_REFERENCE_POLICY.maxAttempts; n += 1) {
      total += pendingReferenceDelayMs(n);
    }
    expect(total).toBe(302_000);
  });

  test('base zero não espera (usado nos testes)', () => {
    const policy = { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0 };
    expect(pendingReferenceDelayMs(5, policy)).toBe(0);
  });
});