import { describe, expect, test } from 'bun:test';
import { Money } from '../domain/money/money';
import { WagerTransactionProcessed } from '../domain/events/wagering-events';
import { OutboxMessage, type OutboxEnvelope } from '../domain/outbox/outbox-message';
import { WagerTransaction } from '../domain/transaction/wager-transaction';
import { WagerTransactionKind } from '../domain/transaction/wager-transaction-kind';
import { OutboxPublisher } from './outbox-publisher';
import type { EventPublisher } from './ports/event-publisher.port';
import type { OutboxBatch, OutboxStore } from './ports/outbox-store.port';

const NOW = new Date('2026-01-01T00:00:00.000Z');

const newMessage = (n: number) => {
  const tx = WagerTransaction.create({
    id: `tx-${n}`, providerId: 'p', externalTransactionId: `ext-${n}`, idempotencyKey: `k-${n}`,
    payloadHash: 'h', walletId: 'w', playerId: 'pl', roundId: 'r', gameId: 'g',
    kind: WagerTransactionKind.Bet, money: Money.from({ amount: '1.00', currency: 'BRL' }), createdAt: NOW,
  });
  tx.markProcessed(undefined, NOW);
  return OutboxMessage.enqueue(
    WagerTransactionProcessed.from(tx, { eventId: `event-${n}`, correlationId: 'c', occurredAt: NOW }),
  );
};

class InMemoryOutboxStore implements OutboxStore {
  constructor(readonly messages: OutboxMessage[]) {}
  async withDueBatch<T>(limit: number, now: Date, work: (batch: OutboxBatch) => Promise<T>): Promise<T> {
    const due = this.messages.filter((m) => m.isDue(now)).slice(0, limit);
    return work({ messages: due, save: () => undefined }); // objetos mutados em memória
  }
}

class FlakyPublisher implements EventPublisher {
  readonly published: string[] = [];
  constructor(private readonly failFor: Set<string> = new Set()) {}
  async publish(event: OutboxEnvelope): Promise<void> {
    if (this.failFor.has(event.eventId)) throw new Error('broker down');
    this.published.push(event.eventId);
  }
}

describe('OutboxPublisher', () => {
  test('publica as mensagens elegíveis e as marca como publicadas', async () => {
    const messages = [newMessage(1), newMessage(2)];
    const broker = new FlakyPublisher();
    const result = await new OutboxPublisher(new InMemoryOutboxStore(messages), broker, {
      now: () => NOW,
    }).publishDue();

    expect(result).toEqual({ claimed: 2, published: 2, failed: 0 });
    expect(broker.published).toEqual(['event-1', 'event-2']);
    expect(messages.every((m) => !m.isPending())).toBe(true);
  });

  test('falha em uma mensagem agenda retry e não impede as outras', async () => {
    const messages = [newMessage(1), newMessage(2), newMessage(3)];
    const broker = new FlakyPublisher(new Set(['event-2']));
    const result = await new OutboxPublisher(new InMemoryOutboxStore(messages), broker, {
      now: () => NOW,
    }).publishDue();

    expect(result).toEqual({ claimed: 3, published: 2, failed: 1 });
    expect(messages[1]!.isPending()).toBe(true);
    expect(messages[1]!.attempts).toBe(1);
    expect(messages[1]!.isDue(NOW)).toBe(false); // ainda em backoff
  });

  test('respeita o tamanho do lote', async () => {
    const messages = [newMessage(1), newMessage(2), newMessage(3)];
    const result = await new OutboxPublisher(new InMemoryOutboxStore(messages), new FlakyPublisher(), {
      batchSize: 2,
      now: () => NOW,
    }).publishDue();
    expect(result.claimed).toBe(2);
  });
});