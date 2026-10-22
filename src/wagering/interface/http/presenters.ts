import type { LedgerPage, ReconciliationReport } from '../../application/wagering-queries';
import type { CreateWalletResult } from '../../application/create-wallet';
import type { WalletView } from '../../application/ports/wagering-read-model.port';
import type { StoredTransaction } from '../../application/ports/wagering-unit-of-work.port';
import type { SubmitWagerTransactionResult } from '../../application/submit-wager-transaction';
import { WagerTransactionStatus } from '../../domain/transaction/wager-transaction-status';

/** Status HTTP de um comando de transação (ver tabela no ARCHITECTURE.md). */
export function httpStatusFor(status: WagerTransactionStatus): number {
  switch (status) {
    case WagerTransactionStatus.Processed:
      return 200;
    case WagerTransactionStatus.Rejected:
      return 422;
    case WagerTransactionStatus.Pending:
    case WagerTransactionStatus.PendingReference:
      return 202;
    case WagerTransactionStatus.Failed:
      return 500;
  }
}

export function presentSubmitResult(result: SubmitWagerTransactionResult) {
  return {
    transactionId: result.transactionId,
    status: result.status,
    failureCode: result.failureCode ?? null,
    balance: result.balance?.toJSON() ?? null,
    idempotentReplay: result.idempotentReplay,
  };
}

export function presentCreatedWallet(wallet: CreateWalletResult) {
  return {
    id: wallet.id,
    playerId: wallet.playerId,
    balance: wallet.balance.toJSON(),
    version: wallet.version,
  };
}

export function presentWallet(wallet: WalletView) {
  return {
    id: wallet.id,
    playerId: wallet.playerId,
    balance: wallet.balance.toJSON(),
    version: wallet.version,
    createdAt: wallet.createdAt.toISOString(),
    updatedAt: wallet.updatedAt.toISOString(),
  };
}

export function presentLedgerPage(page: LedgerPage) {
  return {
    items: page.items.map((entry) => ({
      id: entry.id,
      transactionId: entry.transactionId,
      walletVersion: entry.walletVersion,
      direction: entry.direction,
      money: entry.money.toJSON(),
      balanceBefore: entry.balanceBefore.toJSON(),
      balanceAfter: entry.balanceAfter.toJSON(),
      createdAt: entry.createdAt.toISOString(),
    })),
    nextCursor: page.nextCursor ?? null,
  };
}

export function presentStoredTransaction({ transaction: tx, observedBalance }: StoredTransaction) {
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
    status: tx.status,
    failureCode: tx.failureCode ?? null,
    referenceExternalTransactionId: tx.referenceExternalTransactionId ?? null,
    referenceTransactionId: tx.referenceTransactionId ?? null,
    balance: observedBalance?.toJSON() ?? null,
    createdAt: tx.createdAt.toISOString(),
    processedAt: tx.processedAt?.toISOString() ?? null,
  };
}

export function presentReconciliation(report: ReconciliationReport) {
  return {
    walletId: report.walletId,
    storedBalance: report.storedBalance.toJSON(),
    calculatedBalance: report.calculatedBalance.toJSON(),
    difference: report.difference.toJSON(),
    consistent: report.consistent,
    checkedEntries: report.checkedEntries,
  };
}