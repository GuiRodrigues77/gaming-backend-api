import { EntityManager, LockMode } from '@mikro-orm/core';
import { Inject, Injectable } from '@nestjs/common';
import type {
  DuePendingReference,
  PendingReferenceScope,
  PendingReferenceUnitOfWork,
  PendingResolution,
  PendingTransaction,
} from '../../application/ports/pending-reference.port';
import type { StoredTransaction } from '../../application/ports/wagering-unit-of-work.port';
import type { WalletLedgerEntry } from '../../domain/ledger/wallet-ledger-entry';
import { Money } from '../../domain/money/money';
import type { OutboxMessage } from '../../domain/outbox/outbox-message';
import type { WagerTransaction } from '../../domain/transaction/wager-transaction';
import type { Wallet } from '../../domain/wallet/wallet';
import { LedgerEntryMapper } from './mappers/ledger-entry.mapper';
import { OutboxMessageMapper } from './mappers/outbox-message.mapper';
import { WagerTransactionMapper } from './mappers/wager-transaction.mapper';
import { WalletMapper } from './mappers/wallet.mapper';
import { WagerTransactionRecord } from './wager-transaction.record';
import { WalletRecord } from './wallet.record';

class MikroOrmPendingReferenceScope implements PendingReferenceScope {
  private readonly walletRecords = new Map<string, WalletRecord>();
  private readonly transactionRecords = new Map<string, WagerTransactionRecord>();

  constructor(private readonly em: EntityManager) {}

  async lockWallet(walletId: string): Promise<Wallet | undefined> {
    const record = await this.em.findOne(
      WalletRecord,
      { id: walletId },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    );
    if (record === null) return undefined;
    this.walletRecords.set(walletId, record);
    return WalletMapper.toDomain(record);
  }

  async lockDuePending(transactionId: string, now: Date): Promise<PendingTransaction | undefined> {
    // O filtro é reavaliado pelo banco depois de esperar o lock: se outra instância
    // decidiu a transação nesse meio tempo, a linha deixa de aparecer.
    const record = await this.em.findOne(
      WagerTransactionRecord,
      {
        id: transactionId,
        status: 'PENDING_REFERENCE',
        $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }],
      },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    );
    if (record === null) return undefined;
    this.transactionRecords.set(record.id, record);
    return {
      transaction: WagerTransactionMapper.toDomain(record),
      attempts: record.referenceAttempts,
    };
  }

  savePending(tx: WagerTransaction, resolution: PendingResolution): void {
    const record = this.transactionRecords.get(tx.id);
    if (record === undefined) {
      throw new Error(`transaction ${tx.id} was not locked in this unit of work`);
    }
    WagerTransactionMapper.applyToRecord(tx, record); // status, referência, falha, processedAt
    record.referenceAttempts = resolution.attempts;
    record.nextAttemptAt = resolution.nextAttemptAt ?? null;
    if (resolution.observedBalance !== undefined) {
      record.observedBalance = resolution.observedBalance.amount;
    }
  }

  saveWallet(wallet: Wallet): void {
    const record = this.walletRecords.get(wallet.id);
    if (record === undefined) {
      throw new Error(`wallet ${wallet.id} was not locked in this unit of work`);
    }
    WalletMapper.applyToRecord(wallet, record);
  }

  appendLedgerEntry(entry: WalletLedgerEntry, walletVersion: number): void {
    this.em.persist(LedgerEntryMapper.toRecord(entry, walletVersion)); // flush no commit
  }

  enqueueOutbox(message: OutboxMessage): void {
    this.em.persist(OutboxMessageMapper.toRecord(message)); // flush no commit
  }

  async findTransactionByExternalId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<StoredTransaction | undefined> {
    const record = await this.em.findOne(WagerTransactionRecord, {
      providerId,
      externalTransactionId,
    });
    return record === null ? undefined : this.toStored(record);
  }

  async findProcessedReversalOf(referenceTransactionId: string): Promise<WagerTransaction | undefined> {
    const record = await this.em.findOne(WagerTransactionRecord, {
      referenceTransactionId,
      kind: { $in: ['REFUND', 'ROLLBACK'] },
      status: 'PROCESSED',
    });
    return record === null ? undefined : WagerTransactionMapper.toDomain(record);
  }

  private toStored(record: WagerTransactionRecord): StoredTransaction {
    return {
      transaction: WagerTransactionMapper.toDomain(record),
      observedBalance:
        record.observedBalance === null
          ? undefined
          : Money.from({ amount: record.observedBalance, currency: record.currency }),
    };
  }
}

@Injectable()
export class MikroOrmPendingReferenceUnitOfWork implements PendingReferenceUnitOfWork {
  constructor(@Inject(EntityManager) private readonly em: EntityManager) {}

  async listDue(limit: number, now: Date): Promise<DuePendingReference[]> {
    const records = await this.em.fork().find(
      WagerTransactionRecord,
      {
        status: 'PENDING_REFERENCE',
        $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }],
      },
      { orderBy: { nextAttemptAt: 'asc', id: 'asc' }, limit },
    );
    return records.map((record) => ({ transactionId: record.id, walletId: record.walletId }));
  }

  async run<T>(work: (scope: PendingReferenceScope) => Promise<T>): Promise<T> {
    return this.em.fork().transactional(async (em) => work(new MikroOrmPendingReferenceScope(em)));
  }
}