import { Migration } from '@mikro-orm/migrations';

export class Migration20261021140000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`ALTER TABLE wager_transactions ADD COLUMN observed_balance numeric(20,2)`);
    this.addSql(`
      ALTER TABLE wager_transactions
        ADD CONSTRAINT wager_transactions_observed_balance_non_negative
        CHECK (observed_balance IS NULL OR observed_balance >= 0)
    `);

    // No máximo UMA reversão processada (REFUND ou ROLLBACK) por transação referenciada.
    this.addSql(`DROP INDEX wager_transactions_one_reversal_per_reference_idx`);
    this.addSql(`
      CREATE UNIQUE INDEX wager_transactions_one_reversal_per_reference_idx
        ON wager_transactions (reference_transaction_id)
        WHERE kind IN ('REFUND','ROLLBACK') AND status = 'PROCESSED'
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`DROP INDEX wager_transactions_one_reversal_per_reference_idx`);
    this.addSql(`
      CREATE UNIQUE INDEX wager_transactions_one_reversal_per_reference_idx
        ON wager_transactions (reference_transaction_id, kind)
        WHERE kind IN ('REFUND','ROLLBACK') AND status = 'PROCESSED'
    `);
    this.addSql(`
      ALTER TABLE wager_transactions
        DROP CONSTRAINT wager_transactions_observed_balance_non_negative
    `);
    this.addSql(`ALTER TABLE wager_transactions DROP COLUMN observed_balance`);
  }
}