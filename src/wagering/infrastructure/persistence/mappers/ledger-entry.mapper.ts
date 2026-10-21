import { LedgerDirection } from '../../../domain/ledger/ledger-direction';
import { WalletLedgerEntry } from '../../../domain/ledger/wallet-ledger-entry';
import { Money } from '../../../domain/money/money';
import { WalletLedgerEntryRecord } from '../wallet-ledger-entry.record';

export const LedgerEntryMapper = {
  toDomain(record: WalletLedgerEntryRecord): WalletLedgerEntry {
    const money = (amount: string) => Money.from({ amount, currency: record.currency });
    return WalletLedgerEntry.rehydrate({
      id: record.id,
      walletId: record.walletId,
      transactionId: record.transactionId,
      direction: record.direction as LedgerDirection,
      money: money(record.amount),
      balanceBefore: money(record.balanceBefore),
      balanceAfter: money(record.balanceAfter),
      createdAt: record.createdAt,
    });
  },

  /**
   * walletVersion = wallet.version lida logo DEPOIS do debit/credit
   * (ou da abertura): é a posição do lançamento no ledger da wallet.
   */
  toRecord(entry: WalletLedgerEntry, walletVersion: number): WalletLedgerEntryRecord {
    return Object.assign(new WalletLedgerEntryRecord(), {
      id: entry.id,
      walletId: entry.walletId,
      transactionId: entry.transactionId,
      walletVersion,
      direction: entry.direction,
      amount: entry.money.amount,
      currency: entry.money.currency,
      balanceBefore: entry.balanceBefore.amount,
      balanceAfter: entry.balanceAfter.amount,
      createdAt: entry.createdAt,
    });
  },
};