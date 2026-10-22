import { describe, expect, test } from 'bun:test';
import { Money } from '../money/money';
import { WagerTransaction } from '../transaction/wager-transaction';
import { WagerTransactionKind } from '../transaction/wager-transaction-kind';
import { WagerTransactionProcessed } from '../events/wagering-events';
import {
  OutboxAlreadyPublishedError,
  OutboxMessage,
  retryDelayMs,
} from './outbox-message';

const NOW = new Date('2026-01-01T00:00:00.000Z');

const makeMessage = () => {
  const tx = WagerTransaction.create({
    id: 'tx-1',
    providerId: 'provider-a',
    externalTransactionId: 'ext-1',
    idempotencyKey: 'provider-a:ext-1',
    payloadHash: 'h',
    walletId: 'wallet-1',
    playerId: 'player-1',
    roundId: 'round-1',
    gameId: 'game-1',
    kind: WagerTransactionKind.Bet,
    money: Money.from({ amount: '25', currency: 'BRL' }),
    createdAt: NOW,
  });
  tx.markProcessed(undefined, NOW);
  const event = WagerTransactionProcessed.from(tx, {
    eventId: 'event-1',
    correlationId: 'corr-1',
    occurredAt: NOW,
  });
  return { event, message: OutboxMessage.enqueue(event) };
};

describe('IntegrationEvent', () => {
  test('toJSON gera o envelope com tipo, versão e dinheiro como string decimal', () => {
    const { event } = makeMessage();
    const json = event.toJSON();
    expect(json.eventType).toBe('WagerTransactionProcessed');
    expect(json.version).toBe(1);
    expect(json.aggregateId).toBe('tx-1');
    expect(json.occurredAt).toBe('2026-01-01T00:00:00.000Z');
    expect(json.causationId).toBeUndefined();
    expect(json.data.money).toEqual({ amount: '25.00', currency: 'BRL' });
  });
});

describe('OutboxMessage', () => {
  test('enqueue nasce pendente e imediatamente elegível', () => {
    const { event, message } = makeMessage();
    expect(message.id).toBe(event.eventId);
    expect(message.isPending()).toBe(true);
    expect(message.isDue(NOW)).toBe(true);
    expect(message.attempts).toBe(0);
    expect(message.payload).toEqual(JSON.parse(JSON.stringify(event)));
  });

  test('markPublished encerra a mensagem e não pode ser repetido', () => {
    const { message } = makeMessage();
    message.markPublished(NOW);
    expect(message.isPending()).toBe(false);
    expect(message.isDue(NOW)).toBe(false);
    expect(() => message.markPublished(NOW)).toThrow(OutboxAlreadyPublishedError);
    expect(() => message.scheduleRetry(NOW)).toThrow(OutboxAlreadyPublishedError);
  });

  test('scheduleRetry incrementa attempts e adia a próxima tentativa', () => {
    const { message } = makeMessage();
    message.scheduleRetry(NOW);
    expect(message.attempts).toBe(1);
    expect(message.nextAttemptAt).toEqual(new Date(NOW.getTime() + 1_000));
    expect(message.isDue(NOW)).toBe(false);
    expect(message.isDue(new Date(NOW.getTime() + 1_000))).toBe(true);
  });

  test('backoff exponencial com teto de 60s', () => {
    expect([1, 2, 3, 4].map(retryDelayMs)).toEqual([1_000, 2_000, 4_000, 8_000]);
    expect(retryDelayMs(7)).toBe(60_000);
    expect(retryDelayMs(500)).toBe(60_000);
  });
});