import { Migration } from '@mikro-orm/migrations';

/**
 * Schema do módulo de wagering.
 * Tabelas: wallets, wager_transactions, wallet_ledger_entries,
 *          inbox_messages, outbox_messages.
 * As invariantes (unicidade, imutabilidade, não-negatividade, consistência
 * saldo x ledger) são garantidas aqui, no banco.
 *
 * Obs.: não usar o caractere de interrogação nos SQLs abaixo (placeholder de binding).
 */
export class Migration20261021120000 extends Migration {
  override async up(): Promise<void> {
    // ------------------------------------------------------------------ wallets
    this.addSql(`
      CREATE TABLE wallets (
        id          uuid          NOT NULL,
        player_id   uuid          NOT NULL,
        currency    char(3)       NOT NULL,
        balance     numeric(20,2) NOT NULL,
        version     integer       NOT NULL,
        created_at  timestamptz   NOT NULL,
        updated_at  timestamptz   NOT NULL,
        CONSTRAINT wallets_pkey PRIMARY KEY (id),
        CONSTRAINT wallets_player_currency_key UNIQUE (player_id, currency),
        CONSTRAINT wallets_id_currency_key UNIQUE (id, currency),
        CONSTRAINT wallets_balance_non_negative CHECK (balance >= 0),
        CONSTRAINT wallets_version_positive CHECK (version >= 1),
        CONSTRAINT wallets_currency_format CHECK (currency ~ '^[A-Z]{3}$')
      )
    `);

    // -------------------------------------------------------- wager_transactions
    // Sem FK para wallets: transações rejeitadas por WALLET_NOT_FOUND,
    // PLAYER_WALLET_MISMATCH ou CURRENCY_MISMATCH precisam continuar auditáveis.
    this.addSql(`
      CREATE TABLE wager_transactions (
        id                                uuid          NOT NULL,
        provider_id                       text          NOT NULL,
        external_transaction_id           text          NOT NULL,
        idempotency_key                   text          NOT NULL,
        payload_hash                      text          NOT NULL,
        wallet_id                         uuid          NOT NULL,
        player_id                         uuid          NOT NULL,
        round_id                          text          NOT NULL,
        game_id                           text          NOT NULL,
        kind                              text          NOT NULL,
        status                            text          NOT NULL,
        amount                            numeric(20,2) NOT NULL,
        currency                          char(3)       NOT NULL,
        reference_external_transaction_id text,
        reference_transaction_id          uuid,
        failure_code                      text,
        reference_attempts                integer       NOT NULL DEFAULT 0,
        next_attempt_at                   timestamptz,
        created_at                        timestamptz   NOT NULL,
        processed_at                      timestamptz,
        CONSTRAINT wager_transactions_pkey PRIMARY KEY (id),
        CONSTRAINT wager_transactions_provider_external_key
          UNIQUE (provider_id, external_transaction_id),
        CONSTRAINT wager_transactions_idempotency_key_key UNIQUE (idempotency_key),
        CONSTRAINT wager_transactions_reference_fkey
          FOREIGN KEY (reference_transaction_id) REFERENCES wager_transactions (id),
        CONSTRAINT wager_transactions_kind_check
          CHECK (kind IN ('OPENING','BET','WIN','LOSS','REFUND','ROLLBACK')),
        CONSTRAINT wager_transactions_status_check
          CHECK (status IN ('PENDING','PENDING_REFERENCE','PROCESSED','REJECTED','FAILED')),
        CONSTRAINT wager_transactions_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
        CONSTRAINT wager_transactions_amount_non_negative CHECK (amount >= 0),
        CONSTRAINT wager_transactions_amount_positive_unless_loss
          CHECK (amount > 0 OR kind = 'LOSS'),
        CONSTRAINT wager_transactions_reference_by_kind CHECK (
          (kind IN ('REFUND','ROLLBACK') AND reference_external_transaction_id IS NOT NULL)
          OR (kind IN ('BET','OPENING') AND reference_external_transaction_id IS NULL)
          OR kind IN ('WIN','LOSS')
        ),
        CONSTRAINT wager_transactions_no_self_reference
          CHECK (reference_external_transaction_id IS DISTINCT FROM external_transaction_id),
        CONSTRAINT wager_transactions_processed_at_check
          CHECK ((status = 'PROCESSED') = (processed_at IS NOT NULL)),
        CONSTRAINT wager_transactions_failure_code_check
          CHECK ((status IN ('REJECTED','FAILED')) = (failure_code IS NOT NULL)),
        CONSTRAINT wager_transactions_processed_reversal_has_reference CHECK (
          NOT (status = 'PROCESSED' AND kind IN ('REFUND','ROLLBACK'))
          OR reference_transaction_id IS NOT NULL
        ),
        CONSTRAINT wager_transactions_attempts_non_negative CHECK (reference_attempts >= 0)
      )
    `);

    // Uma referência só pode ser revertida uma vez por tipo de operação
    // (somente transações PROCESSED contam; as REJECTED ficam para auditoria).
    this.addSql(`
      CREATE UNIQUE INDEX wager_transactions_one_reversal_per_reference_idx
        ON wager_transactions (reference_transaction_id, kind)
        WHERE kind IN ('REFUND','ROLLBACK') AND status = 'PROCESSED'
    `);

    // Worker de PENDING_REFERENCE e resolução quando a referência chega.
    this.addSql(`
      CREATE INDEX wager_transactions_pending_due_idx
        ON wager_transactions (next_attempt_at)
        WHERE status = 'PENDING_REFERENCE'
    `);
    this.addSql(`
      CREATE INDEX wager_transactions_pending_by_reference_idx
        ON wager_transactions (provider_id, reference_external_transaction_id)
        WHERE status = 'PENDING_REFERENCE'
    `);
    this.addSql(`
      CREATE INDEX wager_transactions_reference_transaction_idx
        ON wager_transactions (reference_transaction_id)
        WHERE reference_transaction_id IS NOT NULL
    `);

    // ----------------------------------------------------- wallet_ledger_entries
    this.addSql(`
      CREATE TABLE wallet_ledger_entries (
        id              uuid          NOT NULL,
        wallet_id       uuid          NOT NULL,
        transaction_id  uuid          NOT NULL,
        wallet_version  integer       NOT NULL,
        direction       text          NOT NULL,
        amount          numeric(20,2) NOT NULL,
        currency        char(3)       NOT NULL,
        balance_before  numeric(20,2) NOT NULL,
        balance_after   numeric(20,2) NOT NULL,
        created_at      timestamptz   NOT NULL,
        CONSTRAINT wallet_ledger_entries_pkey PRIMARY KEY (id),
        CONSTRAINT wallet_ledger_entries_wallet_fkey
          FOREIGN KEY (wallet_id, currency) REFERENCES wallets (id, currency),
        CONSTRAINT wallet_ledger_entries_transaction_fkey
          FOREIGN KEY (transaction_id) REFERENCES wager_transactions (id),
        CONSTRAINT wallet_ledger_entries_wallet_version_key UNIQUE (wallet_id, wallet_version),
        CONSTRAINT wallet_ledger_entries_wallet_transaction_key UNIQUE (wallet_id, transaction_id),
        CONSTRAINT wallet_ledger_entries_direction_check CHECK (direction IN ('DEBIT','CREDIT')),
        CONSTRAINT wallet_ledger_entries_amount_positive CHECK (amount > 0),
        CONSTRAINT wallet_ledger_entries_version_positive CHECK (wallet_version >= 1),
        CONSTRAINT wallet_ledger_entries_balances_non_negative
          CHECK (balance_before >= 0 AND balance_after >= 0),
        CONSTRAINT wallet_ledger_entries_balanced CHECK (
          (direction = 'CREDIT' AND balance_after = balance_before + amount)
          OR (direction = 'DEBIT' AND balance_after = balance_before - amount)
        )
      )
    `);
    this.addSql(`
      CREATE INDEX wallet_ledger_entries_transaction_idx
        ON wallet_ledger_entries (transaction_id)
    `);

    // --------------------------------------------------------------------- inbox
    this.addSql(`
      CREATE TABLE inbox_messages (
        consumer_name  text         NOT NULL,
        message_id     text         NOT NULL,
        payload_hash   text         NOT NULL,
        received_at    timestamptz  NOT NULL,
        processed_at   timestamptz,
        CONSTRAINT inbox_messages_pkey PRIMARY KEY (consumer_name, message_id)
      )
    `);

    // -------------------------------------------------------------------- outbox
    this.addSql(`
      CREATE TABLE outbox_messages (
        id               uuid         NOT NULL,
        aggregate_id     text         NOT NULL,
        event_type       text         NOT NULL,
        payload          jsonb        NOT NULL,
        occurred_at      timestamptz  NOT NULL,
        attempts         integer      NOT NULL DEFAULT 0,
        next_attempt_at  timestamptz,
        published_at     timestamptz,
        CONSTRAINT outbox_messages_pkey PRIMARY KEY (id),
        CONSTRAINT outbox_messages_attempts_non_negative CHECK (attempts >= 0)
      )
    `);
    this.addSql(`
      CREATE INDEX outbox_messages_pending_idx
        ON outbox_messages (occurred_at)
        WHERE published_at IS NULL
    `);

    // ================================================================ triggers
    // Tabelas append-only / sem exclusão.
    this.addSql(`
      CREATE FUNCTION prevent_mutation() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION '% on % is not allowed', TG_OP, TG_TABLE_NAME
          USING ERRCODE = 'integrity_constraint_violation';
      END;
      $$ LANGUAGE plpgsql
    `);
    this.addSql(`
      CREATE TRIGGER wallet_ledger_entries_immutable
        BEFORE UPDATE OR DELETE ON wallet_ledger_entries
        FOR EACH ROW EXECUTE FUNCTION prevent_mutation()
    `);
    this.addSql(`
      CREATE TRIGGER wager_transactions_no_delete
        BEFORE DELETE ON wager_transactions
        FOR EACH ROW EXECUTE FUNCTION prevent_mutation()
    `);
    this.addSql(`
      CREATE TRIGGER wallets_no_delete
        BEFORE DELETE ON wallets
        FOR EACH ROW EXECUTE FUNCTION prevent_mutation()
    `);

    // Transação em estado terminal é imutável; campos de negócio nunca mudam;
    // nenhuma transição de volta para PENDING.
    this.addSql(`
      CREATE FUNCTION guard_wager_transaction_update() RETURNS trigger AS $$
      BEGIN
        IF OLD.status IN ('PROCESSED','REJECTED','FAILED') THEN
          RAISE EXCEPTION 'wager transaction % is terminal (%) and cannot be updated',
            OLD.id, OLD.status
            USING ERRCODE = 'integrity_constraint_violation';
        END IF;
        IF NEW.status = 'PENDING' AND OLD.status <> 'PENDING' THEN
          RAISE EXCEPTION 'wager transaction % cannot go back to PENDING', OLD.id
            USING ERRCODE = 'integrity_constraint_violation';
        END IF;
        IF NEW.id IS DISTINCT FROM OLD.id
          OR NEW.provider_id IS DISTINCT FROM OLD.provider_id
          OR NEW.external_transaction_id IS DISTINCT FROM OLD.external_transaction_id
          OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
          OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash
          OR NEW.wallet_id IS DISTINCT FROM OLD.wallet_id
          OR NEW.player_id IS DISTINCT FROM OLD.player_id
          OR NEW.round_id IS DISTINCT FROM OLD.round_id
          OR NEW.game_id IS DISTINCT FROM OLD.game_id
          OR NEW.kind IS DISTINCT FROM OLD.kind
          OR NEW.amount IS DISTINCT FROM OLD.amount
          OR NEW.currency IS DISTINCT FROM OLD.currency
          OR NEW.reference_external_transaction_id IS DISTINCT FROM OLD.reference_external_transaction_id
          OR NEW.created_at IS DISTINCT FROM OLD.created_at
        THEN
          RAISE EXCEPTION 'business fields of wager transaction % are immutable', OLD.id
            USING ERRCODE = 'integrity_constraint_violation';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    this.addSql(`
      CREATE TRIGGER wager_transactions_guard_update
        BEFORE UPDATE ON wager_transactions
        FOR EACH ROW EXECUTE FUNCTION guard_wager_transaction_update()
    `);

    // Identidade da wallet é imutável.
    this.addSql(`
      CREATE FUNCTION guard_wallet_update() RETURNS trigger AS $$
      BEGIN
        IF NEW.id IS DISTINCT FROM OLD.id
          OR NEW.player_id IS DISTINCT FROM OLD.player_id
          OR NEW.currency IS DISTINCT FROM OLD.currency
          OR NEW.created_at IS DISTINCT FROM OLD.created_at
        THEN
          RAISE EXCEPTION 'identity fields of wallet % are immutable', OLD.id
            USING ERRCODE = 'integrity_constraint_violation';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    this.addSql(`
      CREATE TRIGGER wallets_guard_update
        BEFORE UPDATE ON wallets
        FOR EACH ROW EXECUTE FUNCTION guard_wallet_update()
    `);

    // Consistência saldo x ledger, verificada no COMMIT (deferred):
    //  - sem lançamentos: saldo 0.00 e version 1;
    //  - com lançamentos: saldo e version da wallet == último lançamento.
    // Dispara na mudança da wallet E na inserção de lançamento, então não é
    // possível alterar saldo sem ledger, nem inserir ledger sem alterar saldo.
    this.addSql(`
      CREATE FUNCTION assert_wallet_ledger_consistent() RETURNS trigger AS $$
      DECLARE
        v_wallet_id     uuid;
        v_balance       numeric;
        v_version       integer;
        v_last_balance  numeric;
        v_last_version  integer;
      BEGIN
        IF TG_TABLE_NAME = 'wallets' THEN
          v_wallet_id := NEW.id;
        ELSE
          v_wallet_id := NEW.wallet_id;
        END IF;

        SELECT balance, version INTO v_balance, v_version
          FROM wallets WHERE id = v_wallet_id;

        SELECT balance_after, wallet_version INTO v_last_balance, v_last_version
          FROM wallet_ledger_entries
          WHERE wallet_id = v_wallet_id
          ORDER BY wallet_version DESC
          LIMIT 1;

        IF v_last_version IS NULL THEN
          IF v_balance <> 0 OR v_version <> 1 THEN
            RAISE EXCEPTION 'wallet % has no ledger entries but balance=% version=%',
              v_wallet_id, v_balance, v_version
              USING ERRCODE = 'check_violation';
          END IF;
        ELSIF v_balance <> v_last_balance OR v_version <> v_last_version THEN
          RAISE EXCEPTION 'wallet % (balance=%, version=%) diverges from ledger (balance=%, version=%)',
            v_wallet_id, v_balance, v_version, v_last_balance, v_last_version
            USING ERRCODE = 'check_violation';
        END IF;

        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql
    `);
    this.addSql(`
      CREATE CONSTRAINT TRIGGER wallets_ledger_consistency
        AFTER INSERT OR UPDATE ON wallets
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW EXECUTE FUNCTION assert_wallet_ledger_consistent()
    `);
    this.addSql(`
      CREATE CONSTRAINT TRIGGER wallet_ledger_entries_consistency
        AFTER INSERT ON wallet_ledger_entries
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW EXECUTE FUNCTION assert_wallet_ledger_consistent()
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS outbox_messages`);
    this.addSql(`DROP TABLE IF EXISTS inbox_messages`);
    this.addSql(`DROP TABLE IF EXISTS wallet_ledger_entries`);
    this.addSql(`DROP TABLE IF EXISTS wager_transactions`);
    this.addSql(`DROP TABLE IF EXISTS wallets`);
    this.addSql(`DROP FUNCTION IF EXISTS assert_wallet_ledger_consistent()`);
    this.addSql(`DROP FUNCTION IF EXISTS guard_wallet_update()`);
    this.addSql(`DROP FUNCTION IF EXISTS guard_wager_transaction_update()`);
    this.addSql(`DROP FUNCTION IF EXISTS prevent_mutation()`);
  }
}