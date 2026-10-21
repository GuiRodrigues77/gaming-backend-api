import {
  EntityManager,
  LockMode,
  UniqueConstraintViolationException,
} from '@mikro-orm/core';
import { Inject, Injectable } from '@nestjs/common';
import { UniqueViolationError } from '../../application/errors';
import type {
  NewTransactionExtras,
  StoredTransaction,
  WageringTransactionScope,
  WageringUnitOfWork,
} from '../../application/ports/wagering-unit-of-work.port';
import type { WalletLedgerEntry } from '../../domain/ledger/wallet-ledger-entry';
import { Money } from '../../domain/money/money';
import type { WagerTransaction } from '../../domain/transaction/wager-transaction';
import type { Wallet } from '../../domain/wallet/wallet';
import { LedgerEntryMapper } from './mappers/ledger-entry.mapper';
import { WagerTransactionMapper } from './mappers/wager-transaction.mapper';
import { WalletMapper } from './mappers/wallet.mapper';
import { WagerTransactionRecord } from './wager-transaction.record';
import { WalletRecord } from './wallet.record';

function isUniqueViolation(error: unknown): boolean {
  if (error instanceof UniqueConstraintViolationException) return true;
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505'
  );
}

class MikroOrmWageringScope implements WageringTransactionScope {
  private readonly walletRecords = new Map<string, WalletRecord>();

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

  async findTransactionByIdempotencyKey(key: string): Promise<StoredTransaction | undefined> {
    const record = await this.em.findOne(WagerTransactionRecord, { idempotencyKey: key });
    return record === null ? undefined : this.toStored(record);
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

  saveWallet(wallet: Wallet): void {
    const record = this.walletRecords.get(wallet.id);
    if (record === undefined) {
      throw new Error(`wallet ${wallet.id} was not locked in this unit of work`);
    }
    WalletMapper.applyToRecord(wallet, record); // UPDATE enviado no próximo flush
  }

  async saveNewTransaction(tx: WagerTransaction, extras: NewTransactionExtras): Promise<void> {
    this.em.persist(WagerTransactionMapper.toRecord(tx, extras));
    await this.em.flush();
  }

  appendLedgerEntry(entry: WalletLedgerEntry, walletVersion: number): void {
    this.em.persist(LedgerEntryMapper.toRecord(entry, walletVersion)); // flush no commit
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
export class MikroOrmWageringUnitOfWork implements WageringUnitOfWork {
  constructor(@Inject(EntityManager) private readonly em: EntityManager) {}

  async run<T>(work: (scope: WageringTransactionScope) => Promise<T>): Promise<T> {
    try {
      // fork() isola o identity map; transactional() abre BEGIN ... COMMIT (flush no fim).
      return await this.em
        .fork()
        .transactional(async (em) => work(new MikroOrmWageringScope(em)));
    } catch (error) {
      if (isUniqueViolation(error)) throw new UniqueViolationError(error);
      throw error;
    }
  }
}