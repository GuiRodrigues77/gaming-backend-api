import type { WalletLedgerEntry } from '../../domain/ledger/wallet-ledger-entry';
import type { Money } from '../../domain/money/money';
import type { OutboxMessage } from '../../domain/outbox/outbox-message';
import type { WagerTransaction } from '../../domain/transaction/wager-transaction';
import type { Wallet } from '../../domain/wallet/wallet';
import type { InboxMessage } from '../../domain/inbox/inbox-message';

export interface StoredTransaction {
  transaction: WagerTransaction;
  /** Saldo da wallet logo após a decisão (usado no replay). */
  observedBalance: Money | undefined;
}

export interface NewTransactionExtras {
  observedBalance?: Money | undefined;
  nextAttemptAt?: Date | undefined;
}

export interface ReferenceLookup {
  findTransactionByExternalId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<StoredTransaction | undefined>;
  /** Reversão (REFUND/ROLLBACK) PROCESSED que aponta para esta transação. */
  findProcessedReversalOf(referenceTransactionId: string): Promise<WagerTransaction | undefined>;
}

/** Tudo o que roda dentro de UMA transação SQL. */
export interface WageringTransactionScope extends ReferenceLookup {
  /** SELECT ... FOR UPDATE da wallet. */
  lockWallet(walletId: string): Promise<Wallet | undefined>;
  findTransactionByIdempotencyKey(key: string): Promise<StoredTransaction | undefined>;
  saveWallet(wallet: Wallet): void;
  /** Persiste e faz flush (a transação precisa existir antes do ledger, por causa da FK). */
  saveNewTransaction(tx: WagerTransaction, extras: NewTransactionExtras): Promise<void>;
  appendLedgerEntry(entry: WalletLedgerEntry, walletVersion: number): void;
  /** Grava na mesma transação SQL do saldo/ledger (transactional outbox). */
  enqueueOutbox(message: OutboxMessage): void;
    /** Mensagem de inbox já recebida por este consumidor, se houver. */
  findInboxMessage(consumerName: string, messageId: string): Promise<InboxMessage | undefined>;
  /** INSERT na mesma transação SQL. A PK (consumer_name, message_id) garante a unicidade. */
  saveInboxMessage(message: InboxMessage): void;
}

export interface WageringUnitOfWork {
  run<T>(work: (scope: WageringTransactionScope) => Promise<T>): Promise<T>;
}

export const WAGERING_UNIT_OF_WORK = Symbol('WAGERING_UNIT_OF_WORK');