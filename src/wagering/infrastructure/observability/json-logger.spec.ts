import { describe, expect, test } from 'bun:test';
import { JsonLogger } from './json-logger';

function capture(run: (logger: JsonLogger) => void): Array<Record<string, unknown>> {
  const lines: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    lines.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    run(new JsonLogger());
  } finally {
    process.stdout.write = original;
  }
  return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('JsonLogger', () => {
  test('string vira message, com nível, contexto e horário', () => {
    const [entry] = capture((logger) => logger.log('hello', 'Ctx'));
    expect(entry).toMatchObject({ level: 'info', context: 'Ctx', message: 'hello' });
    expect(typeof entry!.time).toBe('string');
  });

  test('objeto vira campos de primeiro nível', () => {
    const [entry] = capture((logger) =>
      logger.warn({ event: 'x', transactionId: 'tx-1', walletId: 'w-1' }, 'Ctx'),
    );
    expect(entry).toMatchObject({ level: 'warn', event: 'x', transactionId: 'tx-1', walletId: 'w-1' });
  });

  test('error com stack e contexto', () => {
    const [entry] = capture((logger) => logger.error('boom', 'stack-trace', 'Ctx'));
    expect(entry).toMatchObject({ level: 'error', message: 'boom', stack: 'stack-trace', context: 'Ctx' });
  });

  test('instância de Error é serializada com nome e stack', () => {
    const [entry] = capture((logger) => logger.error(new Error('falhou')));
    expect(entry).toMatchObject({ level: 'error', message: 'falhou', errorName: 'Error' });
    expect(typeof entry!.stack).toBe('string');
  });
});