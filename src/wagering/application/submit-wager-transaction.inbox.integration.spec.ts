import { MikroORM } from '@mikro-orm/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import config from '../../../mikro-orm.config';
import { FailureCode } from '../domain/transaction/failure-code';
import { WagerTransactionStatus as Status } from '../domain/transaction/wager-transaction-status';
import { MikroOrmWageringUnitOfWork } from '../infrastructure/persistence/mikro-orm-wagering-unit-of-work';
import { WAGERING_SCHEMAS } from '../infrastructure/persistence/wagering-schemas';
import { ledgerSummary } from '../testing/ledger-summary';
import { resetWageringTables } from '../testing/reset-tables';
import { openWalletInDb } from '../testing/wallet-fixture';
import { InboxPayloadMismatchError } from './errors';
import {
  SubmitWagerTransaction,
  type SubmitWagerTransactionCommand,
} from './submit-wager-transaction';

const RUN = process.env.DATABASE_INTEGRATION?.trim() === '1';
const CONSUMER = 'wager-consumer';

describe.skipIf(!RUN)('SubmitWagerTransaction com inbox (PostgreSQL real)', () => {
  let orm: MikroORM;
  let submit: SubmitWagerTransaction;

  beforeAll(async () => {
    orm = await MikroORM.init({ ...config, entities: WAGERING_SCHEMAS, entitiesTs: WAGERING_SCHEMAS });
    submit = new SubmitWagerTransaction(new MikroOrmWageringUnitOfWork(orm.em));
  });

  afterAll(async () => {
    await orm.close();
  });

  beforeEach(async () => {
    await resetWageringTables(orm);
  });

  const command = (
    walletId: string,
    playerId: string,
    messageId: string,
    overrides: Partial<SubmitWagerTransactionCommand> = {},
  ): SubmitWagerTransactionCommand => {
    const externalTransactionId = overrides.externalTransactionId ?? `ext-${randomUUID()}`;
    return {
      idempotencyKey: `provider-a:${externalTransactionId}`,
      providerId: 'provider-a',
      externalTransactionId,
      playerId,
      walletId,
      roundId: 'round-1',
      gameId: 'game-1',
      kind: 'BET',
      money: { amount: '25.00', currency: 'BRL' },
      inbox: { consumerName: CONSUMER, messageId },
      ...overrides,
    };
  };

  async function count(sql: string, params: unknown[]): Promise<number> {
    const rows = (await orm.em.getConnection().execute(sql, params)) as unknown as Array<{ n: number }>;
    return rows[0]!.n;
  }

  const inboxCount = (messageId: string) =>
    count('select count(*)::int as n from inbox_messages where consumer_name = ? and message_id = ?', [
      CONSUMER,
      messageId,
    ]);

  test('redelivery da mesma mensagem: um único débito e uma única linha de inbox', async () => {
    const { walletId, playerId } = await openWalletInDb(orm, '1000.00');
    const cmd = command(walletId, playerId, 'msg-1');

    const first = await submit.execute(cmd);
    const second = await submit.execute(cmd);

    expect(first.idempotentReplay).toBe(false);
    expect(second.idempotentReplay).toBe(true);
    expect(second.transactionId).toBe(first.transactionId);
    expect(await inboxCount('msg-1')).toBe(1);

    const ledger = await ledgerSummary(orm, walletId);
    expect(ledger.consistent).toBe(true);
    expect(ledger.debits).toBe(1);
    expect(ledger.balance.amount).toBe('975.00');
  });

  test('50 entregas simultâneas da mesma mensagem: um único débito', async () => {
    const { walletId, playerId } = await openWalletInDb(orm, '1000.00');
    const cmd = command(walletId, playerId, 'msg-1');

    const results = await Promise.all(Array.from({ length: 50 }, () => submit.execute(cmd)));

    expect(results.filter((r) => !r.idempotentReplay)).toHaveLength(1);
    expect(new Set(results.map((r) => r.transactionId)).size).toBe(1);
    expect(await inboxCount('msg-1')).toBe(1);

    const ledger = await ledgerSummary(orm, walletId);
    expect(ledger.consistent).toBe(true);
    expect(ledger.debits).toBe(1);
  });

  test('mesmo messageId com payload e chave diferentes: conflito, nada novo é processado', async () => {
    const { walletId, playerId } = await openWalletInDb(orm, '1000.00');
    await submit.execute(command(walletId, playerId, 'msg-1', { externalTransactionId: 'ext-a' }));

    const other = command(walletId, playerId, 'msg-1', {
      externalTransactionId: 'ext-b',
      money: { amount: '30.00', currency: 'BRL' },
    });
    await expect(submit.execute(other)).rejects.toBeInstanceOf(InboxPayloadMismatchError);

    expect(
      await count('select count(*)::int as n from wager_transactions where external_transaction_id = ?', [
        'ext-b',
      ]),
    ).toBe(0);
    const ledger = await ledgerSummary(orm, walletId);
    expect(ledger.consistent).toBe(true);
    expect(ledger.debits).toBe(1);
    expect(ledger.balance.amount).toBe('975.00');
  });

  test('rejeição de negócio também entra no inbox e a redelivery devolve o mesmo resultado', async () => {
    const { walletId, playerId } = await openWalletInDb(orm, '10.00');
    const cmd = command(walletId, playerId, 'msg-rej'); // aposta de 25.00 com saldo de 10.00

    const first = await submit.execute(cmd);
    expect(first.status).toBe(Status.Rejected);
    expect(first.failureCode).toBe(FailureCode.InsufficientFunds);

    const again = await submit.execute(cmd);
    expect(again.idempotentReplay).toBe(true);
    expect(again.status).toBe(Status.Rejected);
    expect(await inboxCount('msg-rej')).toBe(1);

    const ledger = await ledgerSummary(orm, walletId);
    expect(ledger.consistent).toBe(true);
    expect(ledger.balance.amount).toBe('10.00');
  });

  test('mesmo messageId em carteiras diferentes ao mesmo tempo: só uma é processada', async () => {
    const a = await openWalletInDb(orm, '1000.00');
    const b = await openWalletInDb(orm, '1000.00');

    const results = await Promise.allSettled([
      submit.execute(command(a.walletId, a.playerId, 'msg-shared')),
      submit.execute(command(b.walletId, b.playerId, 'msg-shared')),
    ]);

    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(InboxPayloadMismatchError);
    expect(await inboxCount('msg-shared')).toBe(1);

    const [ledgerA, ledgerB] = await Promise.all([
      ledgerSummary(orm, a.walletId),
      ledgerSummary(orm, b.walletId),
    ]);
    expect(ledgerA.consistent && ledgerB.consistent).toBe(true);
    expect(ledgerA.debits + ledgerB.debits).toBe(1);
  });

  test('transação criada antes por HTTP: a mensagem vira replay e registra o inbox', async () => {
    const { walletId, playerId } = await openWalletInDb(orm, '1000.00');
    const viaHttp = command(walletId, playerId, 'unused', {
      externalTransactionId: 'ext-http',
      inbox: undefined,
    });
    const created = await submit.execute(viaHttp);

    const viaQueue = { ...viaHttp, inbox: { consumerName: CONSUMER, messageId: 'msg-late' } };
    const replayed = await submit.execute(viaQueue);
    const again = await submit.execute(viaQueue);

    expect(replayed.idempotentReplay).toBe(true);
    expect(replayed.transactionId).toBe(created.transactionId);
    expect(again.idempotentReplay).toBe(true);
    expect(await inboxCount('msg-late')).toBe(1);

    const ledger = await ledgerSummary(orm, walletId);
    expect(ledger.consistent).toBe(true);
    expect(ledger.debits).toBe(1);
  });
});