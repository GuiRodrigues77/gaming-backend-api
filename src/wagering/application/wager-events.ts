import type { WalletLedgerEntry } from '../domain/ledger/wallet-ledger-entry';
import type { IntegrationEvent } from '../domain/events/integration-event';
import {
  WagerTransactionPendingReference,
  WagerTransactionProcessed,
  WagerTransactionRejected,
  WalletBalanceChanged,
} from '../domain/events/wagering-events';
import type { WagerTransaction } from '../domain/transaction/wager-transaction';
import type { Wallet } from '../domain/wallet/wallet';
import type { ProcessOutcome } from './wager-transaction-processor';

export interface BuildWagerEventsInput {
  transaction: WagerTransaction;
  outcome: ProcessOutcome;
  wallet: Wallet | undefined;
  ledgerEntry: WalletLedgerEntry | undefined;
  correlationId: string;
  newId: () => string;
  now: Date;
}

/**
 * Quais eventos nascem de cada decisão:
 *  - processada      -> WagerTransactionProcessed (+ WalletBalanceChanged se o saldo mudou; LOSS não muda)
 *  - rejeitada       -> WagerTransactionRejected
 *  - sem referência  -> WagerTransactionPendingReference
 */
export function buildWagerEvents(input: BuildWagerEventsInput): IntegrationEvent<unknown>[] {
  const { transaction: tx, outcome, wallet, ledgerEntry, correlationId, newId, now } = input;
  const context = (causationId?: string) => ({
    eventId: newId(),
    correlationId,
    causationId,
    occurredAt: now,
  });

  if (outcome === 'pending_reference') {
    return [WagerTransactionPendingReference.from(tx, context())];
  }
  if (outcome === 'rejected') {
    return [WagerTransactionRejected.from(tx, context())];
  }

  const processed = WagerTransactionProcessed.from(tx, context());
  const events: IntegrationEvent<unknown>[] = [processed];
  if (wallet !== undefined && ledgerEntry !== undefined) {
    events.push(WalletBalanceChanged.from(wallet, ledgerEntry, context(processed.eventId)));
  }
  return events;
}