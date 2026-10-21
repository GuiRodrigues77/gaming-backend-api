import type { NewTransactionExtras } from '../../../application/ports/wagering-unit-of-work.port';
import { Money } from '../../../domain/money/money';
import { FailureCode } from '../../../domain/transaction/failure-code';
import { WagerTransaction } from '../../../domain/transaction/wager-transaction';
import { WagerTransactionKind } from '../../../domain/transaction/wager-transaction-kind';
import { WagerTransactionStatus } from '../../../domain/transaction/wager-transaction-status';
import { WagerTransactionRecord } from '../wager-transaction.record';

export const WagerTransactionMapper = {
  toDomain(record: WagerTransactionRecord): WagerTransaction {
    return WagerTransaction.rehydrate({
      id: record.id,
      providerId: record.providerId,
      externalTransactionId: record.externalTransactionId,
      idempotencyKey: record.idempotencyKey,
      payloadHash: record.payloadHash,
      walletId: record.walletId,
      playerId: record.playerId,
      roundId: record.roundId,
      gameId: record.gameId,
      kind: record.kind as WagerTransactionKind,
      money: Money.from({ amount: record.amount, currency: record.currency }),
      referenceExternalTransactionId: record.referenceExternalTransactionId ?? undefined,
      createdAt: record.createdAt,
      status: record.status as WagerTransactionStatus,
      referenceTransactionId: record.referenceTransactionId ?? undefined,
      failureCode: (record.failureCode ?? undefined) as FailureCode | undefined,
      processedAt: record.processedAt ?? undefined,
    });
  },

  /** Transação nova (INSERT). */
  toRecord(tx: WagerTransaction, extras: NewTransactionExtras = {}): WagerTransactionRecord {
    return Object.assign(new WagerTransactionRecord(), {
      id: tx.id,
      providerId: tx.providerId,
      externalTransactionId: tx.externalTransactionId,
      idempotencyKey: tx.idempotencyKey,
      payloadHash: tx.payloadHash,
      walletId: tx.walletId,
      playerId: tx.playerId,
      roundId: tx.roundId,
      gameId: tx.gameId,
      kind: tx.kind,
      status: tx.status,
      amount: tx.money.amount,
      currency: tx.money.currency,
      referenceExternalTransactionId: tx.referenceExternalTransactionId ?? null,
      referenceTransactionId: tx.referenceTransactionId ?? null,
      failureCode: tx.failureCode ?? null,
      referenceAttempts: 0,
      nextAttemptAt: extras.nextAttemptAt ?? null,
      observedBalance: extras.observedBalance?.amount ?? null,
      createdAt: tx.createdAt,
      processedAt: tx.processedAt ?? null,
    });
  },

  /** Transação existente (UPDATE): só os campos de estado. O banco bloqueia o resto. */
  applyToRecord(tx: WagerTransaction, record: WagerTransactionRecord): void {
    record.status = tx.status;
    record.referenceTransactionId = tx.referenceTransactionId ?? null;
    record.failureCode = tx.failureCode ?? null;
    record.processedAt = tx.processedAt ?? null;
  },
};  