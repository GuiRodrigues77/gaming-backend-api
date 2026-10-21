import { WagerTransactionSchema } from './wager-transaction.entity';
import { WalletLedgerEntrySchema } from './wallet-ledger-entry.entity';
import { WalletSchema } from './wallet.entity';

export const WAGERING_SCHEMAS = [WalletSchema, WagerTransactionSchema, WalletLedgerEntrySchema];