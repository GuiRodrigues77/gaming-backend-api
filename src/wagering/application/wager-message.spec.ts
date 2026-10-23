import { describe, expect, test } from 'bun:test';
import { InvalidWagerMessageError } from './errors';
import { parseWagerMessage } from './wager-message';

const valid = () => ({
  messageId: 'msg-123',
  type: 'WagerTransactionRequested',
  occurredAt: '2026-07-29T15:00:00.000Z',
  data: {
    providerId: 'provider-a',
    externalTransactionId: 'transaction-123',
    idempotencyKey: 'provider-a:transaction-123',
    playerId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1',
    walletId: '0192f291-27dd-7d3f-8071-5f8685deef37',
    roundId: 'round-987',
    gameId: 'fortune-chimp',
    kind: 'BET',
    money: { amount: '25.00', currency: 'BRL' },
  },
});

const parse = (body: unknown) =>
  parseWagerMessage(typeof body === 'string' ? body : JSON.stringify(body), {
    consumerName: 'wager-consumer',
  });

describe('parseWagerMessage', () => {
  test('a mensagem do README vira o comando do use case, com o inbox', () => {
    const parsed = parse(valid());
    expect(parsed.messageId).toBe('msg-123');
    expect(parsed.occurredAt.toISOString()).toBe('2026-07-29T15:00:00.000Z');
    expect(parsed.command).toEqual({
      ...valid().data,
      inbox: { consumerName: 'wager-consumer', messageId: 'msg-123' },
    });
  });

  test('referenceExternalTransactionId e correlationId são repassados quando existem', () => {
    const message = valid();
    const withReference = {
      ...message,
      data: { ...message.data, kind: 'REFUND', referenceExternalTransactionId: 'bet-1' },
    };
    const parsed = parseWagerMessage(JSON.stringify(withReference), {
      consumerName: 'wager-consumer',
      correlationId: 'corr-1',
    });
    expect(parsed.command.referenceExternalTransactionId).toBe('bet-1');
    expect(parsed.command.correlationId).toBe('corr-1');
  });

  test('corpo que não é JSON é rejeitado', () => {
    expect(() => parse('{nope')).toThrow(InvalidWagerMessageError);
  });

  const cases: Array<[string, unknown]> = [
    ['corpo é array', []],
    ['corpo é null', null],
    ['sem messageId', { ...valid(), messageId: undefined }],
    ['tipo desconhecido', { ...valid(), type: 'Other' }],
    ['occurredAt inválido', { ...valid(), occurredAt: 'ontem' }],
    ['data ausente', { ...valid(), data: undefined }],
    ['data é array', { ...valid(), data: [] }],
    ['kind OPENING (interno)', { ...valid(), data: { ...valid().data, kind: 'OPENING' } }],
    ['kind desconhecido', { ...valid(), data: { ...valid().data, kind: 'FOO' } }],
    ['money sem amount', { ...valid(), data: { ...valid().data, money: { currency: 'BRL' } } }],
    [
      'amount não é string',
      { ...valid(), data: { ...valid().data, money: { amount: 25, currency: 'BRL' } } },
    ],
    ['providerId gigante', { ...valid(), data: { ...valid().data, providerId: 'x'.repeat(101) } }],
    ['idempotencyKey vazia', { ...valid(), data: { ...valid().data, idempotencyKey: ' ' } }],
  ];
  for (const [name, payload] of cases) {
    test(`rejeita: ${name}`, () => {
      expect(() => parse(payload)).toThrow(InvalidWagerMessageError);
    });
  }
});