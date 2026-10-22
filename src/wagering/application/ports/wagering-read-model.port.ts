import type { LedgerDirection } from '../../domain/ledger/ledger-direction';
import type { Money } from '../../domain/money/money';
import type { StoredTransaction } from './wagering-unit-of-work.port';

export interface WalletView {
  id: string;
  playerId: string;
  balance: Money;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface LedgerEntryView {
  id: string;
  transactionId: string;
  walletVersion: number;
  direction: LedgerDirection;
  money: Money;
  balanceBefore: Money;
  balanceAfter: Money;
  createdAt: Date;
}

export interface LedgerPageView {
  items: LedgerEntryView[];
  hasMore: boolean;
}

export interface ReconciliationSnapshot {
  storedBalance: Money;
  /** Soma do ledger: créditos menos débitos. */
  calculatedBalance: Money;
  checkedEntries: number;
}

/** Lado de leitura (consultas). Não altera nada. */
export interface WageringReadModel {
  findWallet(walletId: string): Promise<WalletView | undefined>;
  /** Do lançamento mais novo para o mais antigo; `beforeWalletVersion` é exclusivo. */
  findLedgerPage(
    walletId: string,
    limit: number,
    beforeWalletVersion: number | undefined,
  ): Promise<LedgerPageView>;
  findTransaction(transactionId: string): Promise<StoredTransaction | undefined>;
  findTransactionByExternalId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<StoredTransaction | undefined>;
  /** Saldo guardado e saldo recalculado lidos no mesmo instante (um único SELECT). */
  reconciliationSnapshot(walletId: string): Promise<ReconciliationSnapshot | undefined>;
}

export const WAGERING_READ_MODEL = Symbol('WAGERING_READ_MODEL');