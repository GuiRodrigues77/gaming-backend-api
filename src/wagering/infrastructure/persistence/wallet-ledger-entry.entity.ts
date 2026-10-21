import { EntitySchema } from '@mikro-orm/core';
import { WalletLedgerEntryRecord } from './wallet-ledger-entry.record';

export const WalletLedgerEntrySchema = new EntitySchema<WalletLedgerEntryRecord>({
  class: WalletLedgerEntryRecord,
  tableName: 'wallet_ledger_entries',
  properties: {
    id: { type: 'string', columnType: 'uuid', primary: true },
    walletId: { type: 'string', columnType: 'uuid' },
    transactionId: { type: 'string', columnType: 'uuid' },
    walletVersion: { type: 'number', columnType: 'integer' },
    direction: { type: 'string', columnType: 'text' },
    amount: { type: 'string', columnType: 'numeric(20,2)' },
    currency: { type: 'string', columnType: 'char(3)' },
    balanceBefore: { type: 'string', columnType: 'numeric(20,2)' },
    balanceAfter: { type: 'string', columnType: 'numeric(20,2)' },
    createdAt: { type: 'Date', columnType: 'timestamptz' },
  },
});