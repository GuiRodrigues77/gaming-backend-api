import { LockMode } from '@mikro-orm/core';
import { MikroORM } from '@mikro-orm/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import config from '../../../../mikro-orm.config';
import { Money } from '../../domain/money/money';
import { WagerTransaction } from '../../domain/transaction/wager-transaction';
import { WagerTransactionKind } from '../../domain/transaction/wager-transaction-kind';
import { Wallet } from '../../domain/wallet/wallet';
import { LedgerEntryMapper } from './mappers/ledger-entry.mapper';
import { WagerTransactionMapper } from './mappers/wager-transaction.mapper';
import { WalletMapper } from './mappers/wallet.mapper';
import { WagerTransactionRecord } from './wager-transaction.record';
import { WalletLedgerEntryRecord } from './wallet-ledger-entry.record';
import { WalletRecord } from './wallet.record';
import { WAGERING_SCHEMAS } from './wagering-schemas';

const RUN = process.env.DATABASE_INTEGRATION?.trim() === '1';
const brl = (amount: string) => Money.from({ amount, currency: 'BRL' });

describe.skipIf(!RUN)('persistência (PostgreSQL real)', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await MikroORM.init({
      ...config,
      entities: WAGERING_SCHEMAS,
      entitiesTs: WAGERING_SCHEMAS,
    });
  });

  afterAll(async () => {
    await orm.close();
  });

  beforeEach(async () => {
    await orm.em
      .getConnection()
      .execute('TRUNCATE wallet_ledger_entries, wager_transactions, wallets');
  });

  /** Abre uma wallet como o use case de criação fará: wallet + OPENING + ledger, na mesma transação. */
  async function openWalletInDb(initial = '1000.00') {
    const now = new Date();
    const walletId = randomUUID();
    const { wallet, openingEntry } = Wallet.open({
      id: walletId,
      playerId: randomUUID(),
      initialBalance: brl(initial),
      openingTransactionId: randomUUID(),
      openingLedgerEntryId: randomUUID(),
      now,
    });
    const opening = WagerTransaction.createOpening({
      id: openingEntry!.transactionId,
      walletId,
      playerId: wallet.playerId,
      money: wallet.balance,
      payloadHash: 'opening',
      createdAt: now,
    });
    await orm.em.fork().transactional(async (em) => {
      em.persist(WalletMapper.toRecord(wallet));
      em.persist(WagerTransactionMapper.toRecord(opening));
      await em.flush(); // transação antes do ledger (FK)
      em.persist(LedgerEntryMapper.toRecord(openingEntry!, wallet.version));
    });
    return { walletId, playerId: wallet.playerId };
  }

  const newBet = (walletId: string, playerId: string, externalId: string) =>
    WagerTransaction.create({
      id: randomUUID(),
      providerId: 'provider-a',
      externalTransactionId: externalId,
      idempotencyKey: `provider-a:${externalId}`,
      payloadHash: 'hash',
      walletId,
      playerId,
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.Bet,
      money: brl('25.00'),
      createdAt: new Date(),
    });

  test('abertura persiste wallet, OPENING e ledger e reidrata no domínio', async () => {
    const { walletId } = await openWalletInDb('1000.00');
    const em = orm.em.fork();
    const wallet = WalletMapper.toDomain(await em.findOneOrFail(WalletRecord, { id: walletId }));
    expect(wallet.balance.amount).toBe('1000.00');
    expect(wallet.version).toBe(1);
    expect(await em.count(WalletLedgerEntryRecord, { walletId })).toBe(1);
  });

  test('fluxo de débito: lock + domínio + wallet, transação e ledger juntos', async () => {
    const { walletId, playerId } = await openWalletInDb('1000.00');

    await orm.em.fork().transactional(async (em) => {
      const now = new Date();
      const record = await em.findOneOrFail(
        WalletRecord,
        { id: walletId },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      const wallet = WalletMapper.toDomain(record);
      const bet = newBet(walletId, playerId, 'bet-1');
      const entry = wallet.debit({
        transactionId: bet.id,
        ledgerEntryId: randomUUID(),
        money: bet.money,
        now,
      });
      bet.markProcessed(undefined, now);

      WalletMapper.applyToRecord(wallet, record);
      em.persist(WagerTransactionMapper.toRecord(bet));
      await em.flush();
      em.persist(LedgerEntryMapper.toRecord(entry, wallet.version));
    });

    const em = orm.em.fork();
    const record = await em.findOneOrFail(WalletRecord, { id: walletId });
    expect(record.balance).toBe('975.00');
    expect(record.version).toBe(2);
    expect(await em.count(WalletLedgerEntryRecord, { walletId })).toBe(2);
  });

  test('o banco recusa alterar saldo sem lançamento no ledger (falha no commit)', async () => {
    const { walletId } = await openWalletInDb('1000.00');

    await expect(
      orm.em.fork().transactional(async (em) => {
        const record = await em.findOneOrFail(WalletRecord, { id: walletId });
        record.balance = '900.00';
        record.version = 2;
      }),
    ).rejects.toThrow();

    const record = await orm.em.fork().findOneOrFail(WalletRecord, { id: walletId });
    expect(record.balance).toBe('1000.00');
  });

  test('o banco recusa saldo negativo', async () => {
    const { walletId } = await openWalletInDb('10.00');
    await expect(
      orm.em.getConnection().execute(`UPDATE wallets SET balance = -1 WHERE id = '${walletId}'`),
    ).rejects.toThrow();
  });

  test('o ledger é imutável (UPDATE e DELETE bloqueados)', async () => {
    await openWalletInDb('1000.00');
    const conn = orm.em.getConnection();
    await expect(conn.execute('UPDATE wallet_ledger_entries SET amount = 1')).rejects.toThrow();
    await expect(conn.execute('DELETE FROM wallet_ledger_entries')).rejects.toThrow();
  });

  test('idempotência no banco: (provider, externalTransactionId) é único', async () => {
    const { walletId, playerId } = await openWalletInDb('1000.00');
    const a = newBet(walletId, playerId, 'same-external-id');
    const b = WagerTransaction.create({
      id: randomUUID(),
      providerId: 'provider-a',
      externalTransactionId: 'same-external-id',
      idempotencyKey: 'other-key',
      payloadHash: 'hash',
      walletId,
      playerId,
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.Bet,
      money: brl('25.00'),
      createdAt: new Date(),
    });

    await expect(
      orm.em.fork().transactional(async (em) => {
        em.persist(WagerTransactionMapper.toRecord(a));
        em.persist(WagerTransactionMapper.toRecord(b));
      }),
    ).rejects.toThrow();
    expect(await orm.em.fork().count(WagerTransactionRecord, { externalTransactionId: 'same-external-id' })).toBe(0);
  });
});