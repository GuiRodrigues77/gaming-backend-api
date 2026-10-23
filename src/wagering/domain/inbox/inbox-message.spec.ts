import { describe, expect, test } from 'bun:test';
import {
  InboxMessage,
  InboxMessageAlreadyProcessedError,
  InvalidInboxMessageError,
} from './inbox-message';

const props = {
  messageId: 'msg-1',
  consumerName: 'wager-consumer',
  payloadHash: 'hash-1',
  receivedAt: new Date('2026-10-23T10:00:00Z'),
};

describe('InboxMessage', () => {
  test('nasce não processada', () => {
    const message = InboxMessage.receive(props);
    expect(message.isProcessed()).toBe(false);
    expect(message.processedAt).toBeUndefined();
  });

  test('markProcessed registra o instante e não pode repetir', () => {
    const message = InboxMessage.receive(props);
    const at = new Date('2026-10-23T10:00:01Z');
    message.markProcessed(at);
    expect(message.processedAt).toEqual(at);
    expect(() => message.markProcessed(at)).toThrow(InboxMessageAlreadyProcessedError);
  });

  test('matchesPayload distingue redelivery de conflito', () => {
    const message = InboxMessage.receive(props);
    expect(message.matchesPayload('hash-1')).toBe(true);
    expect(message.matchesPayload('hash-2')).toBe(false);
  });

  test('rejeita campos vazios', () => {
    expect(() => InboxMessage.receive({ ...props, messageId: ' ' })).toThrow(
      InvalidInboxMessageError,
    );
  });

  test('rehydrate restaura o estado processado sem revalidar', () => {
    const at = new Date('2026-10-23T10:00:01Z');
    const message = InboxMessage.rehydrate({ ...props, processedAt: at });
    expect(message.isProcessed()).toBe(true);
    expect(message.processedAt).toEqual(at);
  });
});