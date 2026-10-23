import { describe, expect, test } from 'bun:test';
import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';
import type { ReadinessCheck } from './readiness-check';
import { withTimeout } from './with-timeout';

const up = (name: string): ReadinessCheck => ({ name, check: async () => undefined });
const down = (name: string): ReadinessCheck => ({
  name,
  check: async () => {
    throw new Error('boom');
  },
});

describe('HealthController', () => {
  test('live não depende de nada', () => {
    expect(new HealthController([down('postgres'), down('sqs')]).live()).toEqual({ status: 'ok' });
  });

  test('ready: tudo alcançável', async () => {
    expect(await new HealthController([up('postgres'), up('sqs')]).ready()).toEqual({
      status: 'ok',
      checks: { postgres: 'up', sqs: 'up' },
    });
  });

  test('ready: dependência fora => 503 indicando qual caiu', async () => {
    const error = await new HealthController([up('postgres'), down('sqs')])
      .ready()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getResponse()).toEqual({
      status: 'unavailable',
      checks: { postgres: 'up', sqs: 'down' },
    });
  });
});

describe('withTimeout', () => {
  test('devolve o resultado quando responde a tempo', async () => {
    expect(await withTimeout(Promise.resolve(7), 100, 'x')).toBe(7);
  });

  test('rejeita quando estoura o tempo', async () => {
    await expect(withTimeout(new Promise<never>(() => undefined), 10, 'x')).rejects.toThrow(
      'timed out',
    );
  });
});