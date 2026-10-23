import { describe, expect, test } from 'bun:test';
import { Money } from '../domain/money/money';
import { WagerTransactionStatus as Status } from '../domain/transaction/wager-transaction-status';
import {
  IdempotencyConflictError,
  InboxPayloadMismatchError,
  UniqueViolationError,
} from './errors';
import { HandleWagerMessage, type WagerMessageSubmitter } from './handle-wager-message';
import { retryVisibilityTimeoutSeconds } from './message-disposition';
import type {
  SubmitWagerTransactionCommand,
  SubmitWagerTransactionResult,
} from './submit-wager-transaction';

const body = JSON.stringify({
  messageId: 'msg-1',
  type: 'WagerTransactionRequested',
  occurredAt: '2026-07-29T15:00:00.000Z',
  data: {
    providerId: 'provider-a',
    externalTransactionId: 'transaction-1',
    idempotencyKey: 'provider-a:transaction-1',
    playerId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1',
    walletId: '0192f291-27dd-7d3f-8071-5f8685deef37',
    roundId: 'round-1',
    gameId: 'game-1',
    kind: 'BET',
    money: { amount: '25.00', currency: 'BRL' },
  },
});

const result = (overrides: Partial<SubmitWagerTransactionResult> = {}): SubmitWagerTransactionResult => ({
  transactionId: 'tx-1',
  status: Status.Processed,
  failureCode: undefined,
  balance: undefined,
  idempotentReplay: false,
  ...overrides,
});

function handlerWith(execute: WagerMessageSubmitter['execute']) {
  const calls: SubmitWagerTransactionCommand[] = [];
  const submitter: WagerMessageSubmitter = {
    execute: async (command) => {
      calls.push(command);
      return execute(command);
    },
  };
  return { handler: new HandleWagerMessage(submitter, { consumerName: 'wager-consumer' }), calls };
}

const first = { receiveCount: 1 };

describe('HandleWagerMessage', () => {
  test('mensagem válida: executa o use case com o inbox e manda dar ack', async () => {
    const { handler, calls } = handlerWith(async () => result());
    const disposition = await handler.handle(body, first);

    expect(disposition).toEqual({
      action: 'ACK',
      transactionId: 'tx-1',
      status: Status.Processed,
      idempotentReplay: false,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.inbox).toEqual({ consumerName: 'wager-consumer', messageId: 'msg-1' });
  });

  test('rejeição de negócio e pendência de referência também recebem ack', async () => {
    for (const status of [Status.Rejected, Status.PendingReference]) {
      const { handler } = handlerWith(async () => result({ status }));
      expect((await handler.handle(body, first)).action).toBe('ACK');
    }
  });

  test('redelivery (replay) recebe ack', async () => {
    const { handler } = handlerWith(async () => result({ idempotentReplay: true }));
    expect(await handler.handle(body, first)).toMatchObject({ action: 'ACK', idempotentReplay: true });
  });

  test('mensagem malformada vai direto para a DLQ sem chamar o use case', async () => {
    const { handler, calls } = handlerWith(async () => result());
    const disposition = await handler.handle('{nope', first);
    expect(disposition).toMatchObject({ action: 'DEAD_LETTER', reason: 'INVALID_MESSAGE' });
    expect(calls).toHaveLength(0);
  });

  test('dado recusado pelo domínio (dinheiro inválido) vai para a DLQ já na primeira entrega', async () => {
    const { handler } = handlerWith(async () => {
      Money.from({ amount: 'abc', currency: 'BRL' }); // lança InvalidMoneyError de verdade
      return result();
    });
    expect(await handler.handle(body, first)).toMatchObject({
      action: 'DEAD_LETTER',
      reason: 'INVALID_PAYLOAD',
    });
  });

  test('conflito de idempotência e de inbox vão para a DLQ', async () => {
    const errors = [
      new IdempotencyConflictError('k', 'PAYLOAD_MISMATCH'),
      new InboxPayloadMismatchError('wager-consumer', 'msg-1'),
    ];
    for (const error of errors) {
      const { handler } = handlerWith(async () => {
        throw error;
      });
      expect(await handler.handle(body, first)).toMatchObject({ action: 'DEAD_LETTER', reason: 'CONFLICT' });
    }
  });

  test('corrida de unicidade e falha de conexão: retry com backoff, sem ack', async () => {
    const errors = [new UniqueViolationError(new Error('dup')), Object.assign(new Error('x'), { code: '57P01' })];
    for (const error of errors) {
      const { handler } = handlerWith(async () => {
        throw error;
      });
      expect(await handler.handle(body, first)).toEqual({
        action: 'RETRY',
        visibilityTimeoutSeconds: 2,
        reason: 'TRANSIENT',
      });
    }
  });

  test('erro inesperado é retentado e o backoff cresce a cada entrega', async () => {
    const { handler } = handlerWith(async () => {
      throw new Error('bug');
    });
    const second = await handler.handle(body, { receiveCount: 2 });
    expect(second).toEqual({ action: 'RETRY', visibilityTimeoutSeconds: 4, reason: 'UNEXPECTED' });
  });

  test('esgotadas as tentativas, qualquer falha não permanente vai para a DLQ', async () => {
    for (const error of [new Error('bug'), new UniqueViolationError(new Error('dup'))]) {
      const { handler } = handlerWith(async () => {
        throw error;
      });
      expect(await handler.handle(body, { receiveCount: 5 })).toMatchObject({
        action: 'DEAD_LETTER',
        reason: 'MAX_ATTEMPTS_EXCEEDED',
      });
    }
  });
});

describe('retryVisibilityTimeoutSeconds', () => {
  test('dobra a cada entrega e respeita o teto de 60s', () => {
    expect([1, 2, 3, 4].map(retryVisibilityTimeoutSeconds)).toEqual([2, 4, 8, 16]);
    expect(retryVisibilityTimeoutSeconds(6)).toBe(60);
    expect(retryVisibilityTimeoutSeconds(30)).toBe(60);
  });
});