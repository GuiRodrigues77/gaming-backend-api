import type { WalletLedgerEntry } from '../../domain/ledger/wallet-ledger-entry';
import type { Money } from '../../domain/money/money';
import type { OutboxMessage } from '../../domain/outbox/outbox-message';
import type { WagerTransaction } from '../../domain/transaction/wager-transaction';
import type { Wallet } from '../../domain/wallet/wallet';
import type { ReferenceLookup } from './wagering-unit-of-work.port';

export interface DuePendingReference {
  transactionId: string;
  walletId: string;
}

export interface PendingTransaction {
  transaction: WagerTransaction;
  /** Quantas vezes a referência já foi procurada sem sucesso. */
  attempts: number;
}

export interface PendingResolution {
  attempts: number;
  /** undefined = não há próxima tentativa (a transação foi decidida). */
  nextAttemptAt: Date | undefined;
  /** Só informado quando a transação foi decidida; se ausente, o valor gravado é mantido. */
  observedBalance?: Money | undefined;
}

/** Tudo o que roda dentro de UMA transação SQL do worker. */
export interface PendingReferenceScope extends ReferenceLookup {
  lockWallet(walletId: string): Promise<Wallet | undefined>;
  /**
   * Relê a transação travando a linha (FOR UPDATE). Devolve undefined se ela já
   * não estiver pendente ou ainda não estiver na hora (outra instância cuidou dela).
   */
  lockDuePending(transactionId: string, now: Date): Promise<PendingTransaction | undefined>;
  savePending(transaction: WagerTransaction, resolution: PendingResolution): void;
  saveWallet(wallet: Wallet): void;
  appendLedgerEntry(entry: WalletLedgerEntry, walletVersion: number): void;
  enqueueOutbox(message: OutboxMessage): void;
}

export interface PendingReferenceUnitOfWork {
  /** Candidatas, sem travar nada: a decisão real acontece sob lock, dentro do `run`. */
  listDue(limit: number, now: Date): Promise<DuePendingReference[]>;
  run<T>(work: (scope: PendingReferenceScope) => Promise<T>): Promise<T>;
}

export const PENDING_REFERENCE_UNIT_OF_WORK = Symbol('PENDING_REFERENCE_UNIT_OF_WORK');