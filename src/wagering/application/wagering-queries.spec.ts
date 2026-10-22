import { describe, expect, test } from 'bun:test';
import { LedgerDirection } from '../domain/ledger/ledger-direction';
import { Money } from '../domain/money/money';
import { InvalidQueryError, ResourceNotFoundError } from './errors';
import type {
  LedgerEntryView,
  LedgerPageView,
  ReconciliationSnapshot,
  WageringReadModel,
  WalletView,
} from './ports/wagering-read-model.port';
import type { StoredTransaction } from './ports/wagering-unit-of-work.port';
import { WageringQueries } from './wagering-queries';

const WALLET_ID = '0192f291-27dd-7d3f-8071-5f8685deef37';
const NOW = new Date('2026-01-01T00:00:00.000Z');
const brl = (amount: string) => Money.from({ amount, currency: 'BRL' });

class FakeReadModel implements WageringReadModel {
  wallets = new Map<string, WalletView>();
  ledger: LedgerEntryView[] = [];
  snapshot: ReconciliationSnapshot | undefined = undefined;

  async findWallet(walletId: string) {
    return this.wallets.get(walletId);
  }

  async findLedgerPage(
    _walletId: string,
    limit: number,
    before: number | undefined,
  ): Promise<LedgerPageView> {
    const rows = this.ledger
      .filter((entry) => before === undefined || entry.walletVersion < before)
      .sort((a, b) => b.walletVersion - a.walletVersion);
    return { items: rows.slice(0, limit), hasMore: rows.length > limit };
  }

  async findTransaction(): Promise<StoredTransaction | undefined> {
    return undefined;
  }

  async findTransactionByExternalId(): Promise<StoredTransaction | undefined> {
    return undefined;
  }

  async reconciliationSnapshot() {
    return this.snapshot;
  }
}

const withWallet = (entries = 0) => {
  const readModel = new FakeReadModel();
  readModel.wallets.set(WALLET_ID, {
    id: WALLET_ID,
    playerId: 'player-1',
    balance: brl('100.00'),
    version: entries,
    createdAt: NOW,
    updatedAt: NOW,
  });
  readModel.ledger = Array.from({ length: entries }, (_, i) => ({
    id: `entry-${i + 1}`,
    transactionId: `tx-${i + 1}`,
    walletVersion: i + 1,
    direction: LedgerDirection.Credit,
    money: brl('1.00'),
    balanceBefore: brl('0.00'),
    balanceAfter: brl('1.00'),
    createdAt: NOW,
  }));
  return { readModel, queries: new WageringQueries(readModel) };
};

describe('WageringQueries.getLedger', () => {
  test('pagina do mais novo para o mais antigo, sem repetir nem perder lançamentos', async () => {
    const { queries } = withWallet(120);
    const versions: number[] = [];
    let cursor: string | undefined;
    let pages = 0;

    do {
      const page = await queries.getLedger(WALLET_ID, { cursor });
      versions.push(...page.items.map((item) => item.walletVersion));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor !== undefined);

    expect(pages).toBe(3); // 50 + 50 + 20
    expect(versions).toHaveLength(120);
    expect(new Set(versions).size).toBe(120);
    expect(versions[0]).toBe(120);
    expect(versions[119]).toBe(1);
  });

  test('sem próxima página não devolve cursor', async () => {
    const { queries } = withWallet(3);
    expect((await queries.getLedger(WALLET_ID, { limit: 3 })).nextCursor).toBeUndefined();
  });

  test.each([0, 101, 1.5, Number.NaN])('rejeita limit inválido: %p', async (limit) => {
    const { queries } = withWallet(1);
    await expect(queries.getLedger(WALLET_ID, { limit })).rejects.toBeInstanceOf(InvalidQueryError);
  });

  test('rejeita cursor inválido e id que não é UUID', async () => {
    const { queries } = withWallet(1);
    await expect(queries.getLedger(WALLET_ID, { cursor: '@@@' })).rejects.toBeInstanceOf(
      InvalidQueryError,
    );
    await expect(queries.getLedger('abc')).rejects.toBeInstanceOf(InvalidQueryError);
  });

  test('wallet inexistente é 404', async () => {
    const queries = new WageringQueries(new FakeReadModel());
    await expect(queries.getLedger(WALLET_ID)).rejects.toBeInstanceOf(ResourceNotFoundError);
  });
});

describe('WageringQueries.reconcile', () => {
  test('saldo guardado igual ao do ledger: consistente', async () => {
    const { readModel, queries } = withWallet();
    readModel.snapshot = {
      storedBalance: brl('975.00'),
      calculatedBalance: brl('975.00'),
      checkedEntries: 42,
    };
    const report = await queries.reconcile(WALLET_ID);
    expect(report.consistent).toBe(true);
    expect(report.difference.amount).toBe('0.00');
    expect(report.checkedEntries).toBe(42);
  });

  test('divergência é sinalizada com a diferença (guardado - calculado)', async () => {
    const { readModel, queries } = withWallet();
    readModel.snapshot = {
      storedBalance: brl('990.00'),
      calculatedBalance: brl('1000.00'),
      checkedEntries: 2,
    };
    const report = await queries.reconcile(WALLET_ID);
    expect(report.consistent).toBe(false);
    expect(report.difference.amount).toBe('-10.00');
    expect(report.storedBalance.amount).toBe('990.00'); // nada foi corrigido
  });

  test('wallet inexistente é 404', async () => {
    await expect(
      new WageringQueries(new FakeReadModel()).reconcile(WALLET_ID),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });
});