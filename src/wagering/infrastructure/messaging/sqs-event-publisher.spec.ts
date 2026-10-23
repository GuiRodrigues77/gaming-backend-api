import { describe, expect, test } from 'bun:test';
import { GetQueueUrlCommand, SendMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';
import type { OutboxEnvelope } from '../../domain/outbox/outbox-message';
import { SqsEventPublisher } from './sqs-event-publisher';

const envelope: OutboxEnvelope = {
  eventId: 'evt-1',
  eventType: 'WalletBalanceChanged',
  aggregateId: 'agg-1',
  payload: { eventId: 'evt-1', correlationId: 'corr-1', data: { walletId: 'wallet-1' } },
};

function fakeClient(options: { failSend?: boolean } = {}) {
  const sent: SendMessageCommand[] = [];
  let lookups = 0;
  const client = {
    send: async (command: unknown) => {
      if (command instanceof GetQueueUrlCommand) {
        lookups += 1;
        return { QueueUrl: 'http://queue/wager-events.fifo' };
      }
      if (command instanceof SendMessageCommand) {
        if (options.failSend) throw new Error('sqs down');
        sent.push(command);
        return {};
      }
      throw new Error('unexpected command');
    },
  } as unknown as SQSClient;
  return { client, sent, lookups: () => lookups };
}

describe('SqsEventPublisher', () => {
  test('envia o payload como corpo, agrupa por wallet e deduplica por eventId', async () => {
    const { client, sent } = fakeClient();
    await new SqsEventPublisher(client, 'wager-events.fifo').publish(envelope);

    const input = sent[0]!.input;
    expect(input.MessageBody).toBe(JSON.stringify(envelope.payload));
    expect(input.MessageGroupId).toBe('wallet-1');
    expect(input.MessageDeduplicationId).toBe('evt-1');
    expect(input.MessageAttributes?.eventType?.StringValue).toBe('WalletBalanceChanged');
    expect(input.MessageAttributes?.correlationId?.StringValue).toBe('corr-1');
  });

  test('sem walletId no payload, agrupa pelo aggregateId', async () => {
    const { client, sent } = fakeClient();
    await new SqsEventPublisher(client, 'wager-events.fifo').publish({
      ...envelope,
      payload: { eventId: 'evt-1' },
    });
    expect(sent[0]!.input.MessageGroupId).toBe('agg-1');
  });

  test('resolve a URL da fila uma única vez', async () => {
    const { client, lookups } = fakeClient();
    const publisher = new SqsEventPublisher(client, 'wager-events.fifo');
    await publisher.publish(envelope);
    await publisher.publish(envelope);
    expect(lookups()).toBe(1);
  });

  test('propaga a falha de envio para o OutboxPublisher reagendar', async () => {
    const { client } = fakeClient({ failSend: true });
    await expect(new SqsEventPublisher(client, 'wager-events.fifo').publish(envelope)).rejects.toThrow(
      'sqs down',
    );
  });
});