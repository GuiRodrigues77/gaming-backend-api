import { describe, expect, test } from 'bun:test';
import { WagerTransactionStatus as Status } from '../domain/transaction/wager-transaction-status';
import type { MessageDisposition } from './message-disposition';
import type { DeadLetterInfo, ReceivedMessage, WagerQueue } from './ports/wager-queue.port';
import { WagerMessageConsumer, type WagerMessageProcessor } from './wager-message-consumer';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const msg = (id: string, groupId?: string): ReceivedMessage => ({
  messageId: id,
  body: id,
  receiptHandle: `rh-${id}`,
  receiveCount: 1,
  groupId,
  correlationId: undefined,
});

class FakeQueue implements WagerQueue {
  readonly calls: string[] = [];
  readonly failAck = new Set<string>();
  receives = 0;

  constructor(private readonly batches: ReceivedMessage[][]) {}

  async receive(): Promise<ReceivedMessage[]> {
    this.receives += 1;
    return this.batches.shift() ?? [];
  }
  async acknowledge(message: ReceivedMessage): Promise<void> {
    if (this.failAck.has(message.messageId)) throw new Error('ack failed');
    this.calls.push(`ack:${message.messageId}`);
  }
  async release(message: ReceivedMessage, seconds: number): Promise<void> {
    this.calls.push(`release:${message.messageId}:${seconds}`);
  }
  async deadLetter(message: ReceivedMessage, info: DeadLetterInfo): Promise<void> {
    this.calls.push(`dlq:${message.messageId}:${info.reason}`);
  }
}

const ack: MessageDisposition = {
  action: 'ACK',
  transactionId: 'tx-1',
  status: Status.Processed,
  idempotentReplay: false,
};
const retry: MessageDisposition = { action: 'RETRY', visibilityTimeoutSeconds: 4, reason: 'TRANSIENT' };
const deadLetter: MessageDisposition = { action: 'DEAD_LETTER', reason: 'INVALID_MESSAGE', detail: 'bad' };

const processor = (byId: Record<string, MessageDisposition> = {}): WagerMessageProcessor => ({
  handle: async (body) => byId[body] ?? ack,
});

describe('WagerMessageConsumer', () => {
  test('ack de tudo e devolve quantas mensagens concluiu', async () => {
    const queue = new FakeQueue([[msg('a1', 'g1'), msg('b1', 'g2'), msg('c1', 'g3')]]);
    const consumer = new WagerMessageConsumer(queue, processor());

    expect(await consumer.runOnce()).toBe(3);
    expect([...queue.calls].sort()).toEqual(['ack:a1', 'ack:b1', 'ack:c1']);
  });

  test('retry: a mensagem espera o backoff e o resto da mesma carteira volta na hora', async () => {
    const queue = new FakeQueue([[msg('a1', 'g1'), msg('a2', 'g1'), msg('b1', 'g2')]]);
    const consumer = new WagerMessageConsumer(queue, processor({ a1: retry }));

    expect(await consumer.runOnce()).toBe(1);
    expect(queue.calls).toContain('release:a1:4');
    expect(queue.calls).toContain('release:a2:0');
    expect(queue.calls).toContain('ack:b1'); // outra carteira não é afetada
    expect(queue.calls).not.toContain('ack:a2'); // não passa na frente de a1
  });

  test('DLQ: a venenosa sai da fila e a próxima da mesma carteira segue', async () => {
    const queue = new FakeQueue([[msg('a1', 'g1'), msg('a2', 'g1')]]);
    const consumer = new WagerMessageConsumer(queue, processor({ a1: deadLetter }));

    expect(await consumer.runOnce()).toBe(2);
    expect(queue.calls).toEqual(['dlq:a1:INVALID_MESSAGE', 'ack:a2']);
  });

  test('mesma carteira em ordem; carteiras diferentes em paralelo', async () => {
    const events: string[] = [];
    const queue = new FakeQueue([[msg('a1', 'g1'), msg('a2', 'g1'), msg('b1', 'g2')]]);
    const consumer = new WagerMessageConsumer(queue, {
      handle: async (body) => {
        events.push(`start:${body}`);
        await sleep(20);
        events.push(`end:${body}`);
        return ack;
      },
    });

    await consumer.runOnce();
    expect(events.indexOf('end:a1')).toBeLessThan(events.indexOf('start:a2'));
    expect(events.indexOf('start:b1')).toBeLessThan(events.indexOf('end:a1'));
  });

  test('respeita o limite de concorrência', async () => {
    let current = 0;
    let max = 0;
    const queue = new FakeQueue([[msg('a', 'g1'), msg('b', 'g2'), msg('c', 'g3'), msg('d', 'g4')]]);
    const consumer = new WagerMessageConsumer(
      queue,
      {
        handle: async () => {
          current += 1;
          max = Math.max(max, current);
          await sleep(15);
          current -= 1;
          return ack;
        },
      },
      { concurrency: 2 },
    );

    expect(await consumer.runOnce()).toBe(4);
    expect(max).toBe(2);
  });

  test('falha no ack: não conta, devolve o resto da carteira e reporta; outras carteiras seguem', async () => {
    const queue = new FakeQueue([[msg('a1', 'g1'), msg('a2', 'g1'), msg('b1', 'g2')]]);
    queue.failAck.add('a1');
    const errors: unknown[] = [];
    const consumer = new WagerMessageConsumer(queue, processor(), {
      onError: (error) => errors.push(error),
    });

    expect(await consumer.runOnce()).toBe(1);
    expect(queue.calls).toContain('release:a2:0');
    expect(queue.calls).toContain('ack:b1');
    expect(queue.calls).not.toContain('ack:a2');
    expect(errors).toHaveLength(1);
  });

  test('stop durante o processamento: a em andamento conclui e a seguinte volta para a fila', async () => {
    const queue = new FakeQueue([[msg('a1', 'g1'), msg('a2', 'g1')]]);
    const consumer: WagerMessageConsumer = new WagerMessageConsumer(queue, {
      handle: async (body) => {
        if (body === 'a1') consumer.stop(); // SIGTERM chega no meio do processamento
        return ack;
      },
    });

    expect(await consumer.runOnce()).toBe(1);
    expect(queue.calls).toEqual(['ack:a1', 'release:a2:0']);
  });

  test('depois do stop não recebe mais nada', async () => {
    const queue = new FakeQueue([[msg('a1', 'g1')]]);
    const consumer = new WagerMessageConsumer(queue, processor());
    consumer.stop();

    expect(await consumer.runOnce()).toBe(0);
    expect(queue.receives).toBe(0);
  });

  test('o listener recebe a decisão de cada mensagem', async () => {
    const queue = new FakeQueue([[msg('a1', 'g1'), msg('b1', 'g2')]]);
    const seen: string[] = [];
    const consumer = new WagerMessageConsumer(queue, processor({ b1: deadLetter }), {
      onSettled: (message, disposition) => seen.push(`${message.messageId}:${disposition.action}`),
    });

    await consumer.runOnce();
    expect([...seen].sort()).toEqual(['a1:ACK', 'b1:DEAD_LETTER']);
  });
});