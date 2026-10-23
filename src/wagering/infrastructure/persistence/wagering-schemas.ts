import { OutboxMessageSchema } from './outbox-message.entity';
import { WagerTransactionSchema } from './wager-transaction.entity';
import { WalletLedgerEntrySchema } from './wallet-ledger-entry.entity';
import { WalletSchema } from './wallet.entity';
import { InboxMessageSchema } from './inbox-message.entity';

export const WAGERING_SCHEMAS = [
  WalletSchema,
  WagerTransactionSchema,
  WalletLedgerEntrySchema,
  OutboxMessageSchema,
  InboxMessageSchema,
];