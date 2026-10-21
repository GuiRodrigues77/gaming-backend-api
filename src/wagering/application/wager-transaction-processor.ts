import { LedgerDirection } from '../domain/ledger/ledger-direction';
import type { WalletLedgerEntry } from '../domain/ledger/wallet-ledger-entry';
import { FailureCode } from '../domain/transaction/failure-code';
import type { WagerTransaction } from '../domain/transaction/wager-transaction';
import { WagerTransactionStatus } from '../domain/transaction/wager-transaction-status';
import type { Wallet } from '../domain/wallet/wallet';
import { InsufficientFundsError } from '../domain/wallet/wallet.errors';
import type { ReferenceLookup } from './ports/wagering-unit-of-work.port';

export type ProcessOutcome = 'processed' | 'rejected' | 'pending_reference';

export interface ProcessResult {
  outcome: ProcessOutcome;
  ledgerEntry?: WalletLedgerEntry | undefined;
}

/**
 * Decide o destino de uma transação (PENDING ou PENDING_REFERENCE) contra a wallet
 * já travada. Muta apenas objetos de domínio em memória; quem persiste é o chamador
 * (use case de submissão e, depois, o worker de PENDING_REFERENCE).
 *
 * 'pending_reference' NÃO altera a transação: o chamador decide (primeira vez:
 * markPendingReference; worker: contar tentativa ou expirar).
 */
export class WagerTransactionProcessor {
  constructor(private readonly newId: () => string) {}

  async process(
    lookup: ReferenceLookup,
    tx: WagerTransaction,
    wallet: Wallet | undefined,
    now: Date,
  ): Promise<ProcessResult> {
    if (wallet === undefined) return this.reject(tx, FailureCode.WalletNotFound);
    if (wallet.playerId !== tx.playerId) return this.reject(tx, FailureCode.PlayerWalletMismatch);
    if (wallet.currency !== tx.money.currency) return this.reject(tx, FailureCode.CurrencyMismatch);

    let reference: WagerTransaction | undefined;
    if (tx.referenceExternalTransactionId !== undefined) {
      const stored = await lookup.findTransactionByExternalId(
        tx.providerId,
        tx.referenceExternalTransactionId,
      );
      if (stored === undefined || !stored.transaction.isTerminal()) {
        return { outcome: 'pending_reference' };
      }
      reference = stored.transaction;
      if (reference.status !== WagerTransactionStatus.Processed) {
        return this.reject(tx, FailureCode.ReferenceNotProcessed);
      }
      const violation = tx.checkReference(reference);
      if (violation !== undefined) return this.reject(tx, violation);
    }

    if (reference !== undefined && tx.requiresReference()) {
      const reversal = await lookup.findProcessedReversalOf(reference.id);
      if (reversal !== undefined) return this.reject(tx, FailureCode.AlreadyReversed);
    }

    if (!tx.affectsBalance()) {
      tx.markProcessed(reference?.id, now);
      return { outcome: 'processed' };
    }

    const direction = tx.ledgerDirectionFor(reference);
    const movement = {
      transactionId: tx.id,
      ledgerEntryId: this.newId(),
      money: tx.money,
      now,
    };
    try {
      const ledgerEntry =
        direction === LedgerDirection.Debit ? wallet.debit(movement) : wallet.credit(movement);
      tx.markProcessed(reference?.id, now);
      return { outcome: 'processed', ledgerEntry };
    } catch (error) {
      if (error instanceof InsufficientFundsError) {
        return this.reject(
          tx,
          tx.requiresReference() ? FailureCode.ReversalWouldOverdraw : FailureCode.InsufficientFunds,
        );
      }
      throw error;
    }
  }

  private reject(tx: WagerTransaction, code: FailureCode): ProcessResult {
    tx.reject(code);
    return { outcome: 'rejected' };
  }
}