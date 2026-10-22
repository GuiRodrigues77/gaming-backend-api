import type { LedgerDirection } from '../ledger/ledger-direction';
import type { WalletLedgerEntry } from '../ledger/wallet-ledger-entry';
import type { MoneyProps } from '../money/money';
import type { WagerTransaction } from '../transaction/wager-transaction';
import type { Wallet } from '../wallet/wallet';
import { IntegrationEvent, type EventContext } from './integration-event';

interface WagerTransactionEventData {
  transactionId: string;
  providerId: string;
  externalTransactionId: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: string;
  money: MoneyProps; // string decimal, nunca a instância de Money
}

function transactionData(tx: WagerTransaction): WagerTransactionEventData {
  return {
    transactionId: tx.id,
    providerId: tx.providerId,
    externalTransactionId: tx.externalTransactionId,
    walletId: tx.walletId,
    playerId: tx.playerId,
    roundId: tx.roundId,
    gameId: tx.gameId,
    kind: tx.kind,
    money: tx.money.toJSON(),
  };
}

// ---------------------------------------------------------------- Processed
export interface WagerTransactionProcessedData extends WagerTransactionEventData {
  referenceTransactionId: string | null;
  processedAt: string;
}

export class WagerTransactionProcessed extends IntegrationEvent<WagerTransactionProcessedData> {
  readonly eventType = 'WagerTransactionProcessed';
  readonly version = 1;

  static from(tx: WagerTransaction, ctx: EventContext): WagerTransactionProcessed {
    return new WagerTransactionProcessed({
      ...ctx,
      aggregateId: tx.id,
      data: {
        ...transactionData(tx),
        referenceTransactionId: tx.referenceTransactionId ?? null,
        processedAt: (tx.processedAt ?? ctx.occurredAt).toISOString(),
      },
    });
  }
}

// ----------------------------------------------------------------- Rejected
export interface WagerTransactionRejectedData extends WagerTransactionEventData {
  failureCode: string;
}

export class WagerTransactionRejected extends IntegrationEvent<WagerTransactionRejectedData> {
  readonly eventType = 'WagerTransactionRejected';
  readonly version = 1;

  static from(tx: WagerTransaction, ctx: EventContext): WagerTransactionRejected {
    if (tx.failureCode === undefined) {
      throw new Error('WagerTransactionRejected requires a failureCode');
    }
    return new WagerTransactionRejected({
      ...ctx,
      aggregateId: tx.id,
      data: { ...transactionData(tx), failureCode: tx.failureCode },
    });
  }
}

// ------------------------------------------------------------ BalanceChanged
export interface WalletBalanceChangedData {
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: MoneyProps;
  balanceBefore: MoneyProps;
  balanceAfter: MoneyProps;
  walletVersion: number;
}

export class WalletBalanceChanged extends IntegrationEvent<WalletBalanceChangedData> {
  readonly eventType = 'WalletBalanceChanged';
  readonly version = 1;

  /** Chamar logo depois do debit/credit: wallet.version já é a do lançamento. */
  static from(wallet: Wallet, entry: WalletLedgerEntry, ctx: EventContext): WalletBalanceChanged {
    return new WalletBalanceChanged({
      ...ctx,
      aggregateId: wallet.id,
      data: {
        walletId: wallet.id,
        transactionId: entry.transactionId,
        direction: entry.direction,
        money: entry.money.toJSON(),
        balanceBefore: entry.balanceBefore.toJSON(),
        balanceAfter: entry.balanceAfter.toJSON(),
        walletVersion: wallet.version,
      },
    });
  }
}

// ----------------------------------------------------------- PendingReference
export interface WagerTransactionPendingReferenceData extends WagerTransactionEventData {
  referenceExternalTransactionId: string;
}

export class WagerTransactionPendingReference extends IntegrationEvent<WagerTransactionPendingReferenceData> {
  readonly eventType = 'WagerTransactionPendingReference';
  readonly version = 1;

  static from(tx: WagerTransaction, ctx: EventContext): WagerTransactionPendingReference {
    if (tx.referenceExternalTransactionId === undefined) {
      throw new Error('WagerTransactionPendingReference requires a reference');
    }
    return new WagerTransactionPendingReference({
      ...ctx,
      aggregateId: tx.id,
      data: {
        ...transactionData(tx),
        referenceExternalTransactionId: tx.referenceExternalTransactionId,
      },
    });
  }
}