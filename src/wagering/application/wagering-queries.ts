import { InvalidQueryError, ResourceNotFoundError } from './errors';
import { isUuid } from './is-uuid';
import { decodeLedgerCursor, encodeLedgerCursor } from './ledger-cursor';
import type {
  LedgerEntryView,
  WageringReadModel,
  WalletView,
} from './ports/wagering-read-model.port';
import type { StoredTransaction } from './ports/wagering-unit-of-work.port';
import type { Money } from '../domain/money/money';

export const DEFAULT_LEDGER_LIMIT = 50;
export const MAX_LEDGER_LIMIT = 100;

export interface LedgerPage {
  items: LedgerEntryView[];
  nextCursor: string | undefined;
}

export interface ReconciliationReport {
  walletId: string;
  storedBalance: Money;
  calculatedBalance: Money;
  /** stored - calculated: zero quando está tudo certo. */
  difference: Money;
  consistent: boolean;
  checkedEntries: number;
}

function assertUuid(name: string, value: string): void {
  if (!isUuid(value)) throw new InvalidQueryError(`${name} must be a UUID`);
}

export class WageringQueries {
  constructor(private readonly readModel: WageringReadModel) {}

  async getWallet(walletId: string): Promise<WalletView> {
    assertUuid('walletId', walletId);
    const wallet = await this.readModel.findWallet(walletId);
    if (wallet === undefined) throw new ResourceNotFoundError('wallet', walletId);
    return wallet;
  }

  async getLedger(
    walletId: string,
    options: { limit?: number | undefined; cursor?: string | undefined } = {},
  ): Promise<LedgerPage> {
    assertUuid('walletId', walletId);
    const limit = options.limit ?? DEFAULT_LEDGER_LIMIT;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LEDGER_LIMIT) {
      throw new InvalidQueryError(`limit must be an integer between 1 and ${MAX_LEDGER_LIMIT}`);
    }
    const before = options.cursor === undefined ? undefined : decodeLedgerCursor(options.cursor);

    await this.getWallet(walletId); // 404 se a wallet não existir
    const page = await this.readModel.findLedgerPage(walletId, limit, before);
    const last = page.items[page.items.length - 1];
    return {
      items: page.items,
      nextCursor:
        page.hasMore && last !== undefined ? encodeLedgerCursor(last.walletVersion) : undefined,
    };
  }

  async getTransaction(transactionId: string): Promise<StoredTransaction> {
    assertUuid('transactionId', transactionId);
    const stored = await this.readModel.findTransaction(transactionId);
    if (stored === undefined) throw new ResourceNotFoundError('transaction', transactionId);
    return stored;
  }

  async getTransactionByExternalId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<StoredTransaction> {
    const stored = await this.readModel.findTransactionByExternalId(
      providerId,
      externalTransactionId,
    );
    if (stored === undefined) {
      throw new ResourceNotFoundError('transaction', `${providerId}/${externalTransactionId}`);
    }
    return stored;
  }

  /** Só compara e informa: divergência NUNCA é corrigida aqui. */
  async reconcile(walletId: string): Promise<ReconciliationReport> {
    assertUuid('walletId', walletId);
    const snapshot = await this.readModel.reconciliationSnapshot(walletId);
    if (snapshot === undefined) throw new ResourceNotFoundError('wallet', walletId);

    const difference = snapshot.storedBalance.subtract(snapshot.calculatedBalance);
    return {
      walletId,
      storedBalance: snapshot.storedBalance,
      calculatedBalance: snapshot.calculatedBalance,
      difference,
      consistent: difference.isZero(),
      checkedEntries: snapshot.checkedEntries,
    };
  }
}