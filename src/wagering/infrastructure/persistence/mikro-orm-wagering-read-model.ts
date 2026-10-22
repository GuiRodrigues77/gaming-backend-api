import { EntityManager } from '@mikro-orm/core';
import { Inject, Injectable } from '@nestjs/common';
import type {
  LedgerEntryView,
  LedgerPageView,
  ReconciliationSnapshot,
  WageringReadModel,
  WalletView,
} from '../../application/ports/wagering-read-model.port';
import type { StoredTransaction } from '../../application/ports/wagering-unit-of-work.port';
import type { LedgerDirection } from '../../domain/ledger/ledger-direction';
import { Money } from '../../domain/money/money';
import { WagerTransactionMapper } from './mappers/wager-transaction.mapper';
import { WagerTransactionRecord } from './wager-transaction.record';
import { WalletLedgerEntryRecord } from './wallet-ledger-entry.record';
import { WalletRecord } from './wallet.record';

/** O banco devolve numeric como texto; a soma do ledger pode ser negativa se houver corrupção. */
function signedMoney(amount: string, currency: string): Money {
  return amount.startsWith('-')
    ? Money.from({ amount: amount.slice(1), currency }).negate()
    : Money.from({ amount, currency });
}

@Injectable()
export class MikroOrmWageringReadModel implements WageringReadModel {
  constructor(@Inject(EntityManager) private readonly em: EntityManager) {}

  async findWallet(walletId: string): Promise<WalletView | undefined> {
    const record = await this.em.fork().findOne(WalletRecord, { id: walletId });
    if (record === null) return undefined;
    return {
      id: record.id,
      playerId: record.playerId,
      balance: Money.from({ amount: record.balance, currency: record.currency }),
      version: record.version,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  async findLedgerPage(
    walletId: string,
    limit: number,
    beforeWalletVersion: number | undefined,
  ): Promise<LedgerPageView> {
    const records = await this.em.fork().find(
      WalletLedgerEntryRecord,
      {
        walletId,
        ...(beforeWalletVersion !== undefined
          ? { walletVersion: { $lt: beforeWalletVersion } }
          : {}),
      },
      { orderBy: { walletVersion: 'desc' }, limit: limit + 1 }, // +1 só para saber se há próxima página
    );
    return {
      items: records.slice(0, limit).map((record) => this.toLedgerView(record)),
      hasMore: records.length > limit,
    };
  }

  async findTransaction(transactionId: string): Promise<StoredTransaction | undefined> {
    const record = await this.em.fork().findOne(WagerTransactionRecord, { id: transactionId });
    return record === null ? undefined : this.toStored(record);
  }

  async findTransactionByExternalId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<StoredTransaction | undefined> {
    const record = await this.em
      .fork()
      .findOne(WagerTransactionRecord, { providerId, externalTransactionId });
    return record === null ? undefined : this.toStored(record);
  }

  async reconciliationSnapshot(walletId: string): Promise<ReconciliationSnapshot | undefined> {
    // Um único SELECT: saldo guardado e soma do ledger no mesmo snapshot.
    const rows = (await this.em.fork().getConnection().execute(
      `select w.currency as currency,
              w.balance::text as stored,
              coalesce(sum(case l.direction when 'CREDIT' then l.amount else -l.amount end), 0)::text as calculated,
              count(l.id)::int as entries
         from wallets w
         left join wallet_ledger_entries l on l.wallet_id = w.id
        where w.id = ?
        group by w.id, w.currency, w.balance`,
      [walletId],
    )) as unknown as Array<{ currency: string; stored: string; calculated: string; entries: number }>;

    const row = rows[0];
    if (row === undefined) return undefined;
    return {
      storedBalance: signedMoney(String(row.stored), row.currency),
      calculatedBalance: signedMoney(String(row.calculated), row.currency),
      checkedEntries: Number(row.entries),
    };
  }

  private toLedgerView(record: WalletLedgerEntryRecord): LedgerEntryView {
    const money = (amount: string) => Money.from({ amount, currency: record.currency });
    return {
      id: record.id,
      transactionId: record.transactionId,
      walletVersion: record.walletVersion,
      direction: record.direction as LedgerDirection,
      money: money(record.amount),
      balanceBefore: money(record.balanceBefore),
      balanceAfter: money(record.balanceAfter),
      createdAt: record.createdAt,
    };
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