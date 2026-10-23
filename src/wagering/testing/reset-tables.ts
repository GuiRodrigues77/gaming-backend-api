import type { MikroORM } from '@mikro-orm/postgresql';

export async function resetWageringTables(orm: MikroORM): Promise<void> {
  await orm.em
    .getConnection()
    .execute(
      'TRUNCATE inbox_messages, outbox_messages, wallet_ledger_entries, wager_transactions, wallets',
    );
}