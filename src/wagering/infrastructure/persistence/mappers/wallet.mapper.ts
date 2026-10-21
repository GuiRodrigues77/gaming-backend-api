import { Money } from '../../../domain/money/money';
import { Wallet } from '../../../domain/wallet/wallet';
import { WalletRecord } from '../wallet.record';

export const WalletMapper = {
  toDomain(record: WalletRecord): Wallet {
    return Wallet.rehydrate({
      id: record.id,
      playerId: record.playerId,
      currency: record.currency,
      balance: Money.from({ amount: record.balance, currency: record.currency }),
      version: record.version,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  },

  /** Wallet nova (INSERT). */
  toRecord(wallet: Wallet): WalletRecord {
    return Object.assign(new WalletRecord(), {
      id: wallet.id,
      playerId: wallet.playerId,
      currency: wallet.currency,
      balance: wallet.balance.amount,
      version: wallet.version,
      createdAt: wallet.createdAt,
      updatedAt: wallet.updatedAt,
    });
  },

  /** Wallet existente (UPDATE): copia só o que pode mudar. */
  applyToRecord(wallet: Wallet, record: WalletRecord): void {
    record.balance = wallet.balance.amount;
    record.version = wallet.version;
    record.updatedAt = wallet.updatedAt;
  },
};