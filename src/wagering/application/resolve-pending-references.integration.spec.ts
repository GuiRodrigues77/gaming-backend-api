import { MikroORM } from '@mikro-orm/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import config from '../../../mikro-orm.config';
import { FailureCode } from '../domain/transaction/failure-code';
import { WagerTransactionStatus as Status } from '../domain/transaction/wager-transaction-status';
import { MikroOrmPendingReferenceUnitOfWork } from '../infrastructure/persistence/mikro-orm-pending-reference-unit-of-work';
import { MikroOrmWageringUnitOfWork } from '../infrastructure/persistence/mikro-orm-wagering-unit-of-work';
import { WAGERING_SCHEMAS } from '../infrastructure/persistence/wagering-schemas';
import { ledgerSummary } from '../testing/ledger-summary';
import { resetWageringTables } from '../testing/reset-tables';
import { openWalletInDb } from '../testing/wallet-fixture';
import {
  DEFAULT_PENDING_REFERENCE_POLICY,
  type PendingReferencePolicy,
} from './pending-reference-policy';
import type {
  PendingReferenceScope,
  PendingReferenceUnitOfWork,
} from './ports/pending-reference.port';
import {
  ResolvePendingReferences,
  type ResolvePendingReferencesOptions,
} from './resolve-pending-references';
import { SubmitWagerTransaction, type SubmitWagerTransactionCommand } from './submit-wager-transaction';
import { uuidv7 } from './uuid-v7';

const RUN = process.env.DATABASE_INTEGRATION?.trim() === '1';

/** Sem espera entre as tentativas e só 3 avaliações antes de desistir. */
const FAST: PendingReferencePolicy = { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0 };

/** Faz o enqueueOutbox falhar uma vez: simula o processo morrendo antes do commit. */
class FailOnceUow implements PendingReferenceUnitOfWork {
  private failed = false;

  constructor(private readonly inner: PendingReferenceUnitOfWork) {}

  listDue(limit: number, now: Date) {
    return this.inner.listDue(limit, now);
  }

  run<T>(work: (scope: PendingReferenceScope) => Promise<T>): Promise<T> {
    return this.inner.run((scope) =>
      work({
        lockWallet: (id) => scope.lockWallet(id),
        lockDuePending: (id, now) => scope.lockDuePending(id, now),
        savePending: (tx, resolution) => scope.savePending(tx, resolution),
        saveWallet: (wallet) => scope.saveWallet(wallet),
        appendLedgerEntry: (entry, version) => scope.appendLedgerEntry(entry, version),
        enqueueOutbox: (message) => {
          if (!this.failed) {
            this.failed = true;
            throw new Error('crash before commit');
          }
          scope.enqueueOutbox(message);
        },
        findTransactionByExternalId: (provider, external) =>
          scope.findTransactionByExternalId(provider, external),
        findProcessedReversalOf: (id) => scope.findProcessedReversalOf(id),
      }),
    );
  }
}

describe.skipIf(!RUN)('worker de PENDING_REFERENCE (PostgreSQL real)', () => {
  let orm: MikroORM;
  let pendingUow: MikroOrmPendingReferenceUnitOfWork;
  let submit: SubmitWagerTransaction;

  beforeAll(async () => {
    orm = await MikroORM.init({ ...config, entities: WAGERING_SCHEMAS, entitiesTs: WAGERING_SCHEMAS });
    pendingUow = new MikroOrmPendingReferenceUnitOfWork(orm.em);
    // backoff inicial 0: a transação pendente já nasce "na hora" de ser avaliada
    submit = new SubmitWagerTransaction(new MikroOrmWageringUnitOfWork(orm.em), {
      pendingReferenceBackoffMs: 0,
    });
  });

  afterAll(async () => {
    await orm.close();
  });

  beforeEach(async () => {
    await resetWageringTables(orm);
  });

  const makeWorker = (
    policy: PendingReferencePolicy = FAST,
    options: ResolvePendingReferencesOptions = {},
    uow: PendingReferenceUnitOfWork = pendingUow,
  ) => new ResolvePendingReferences(uow, { policy, ...options });

  const command = (
    walletId: string,
    playerId: string,
    overrides: Partial<SubmitWagerTransactionCommand> = {},
  ): SubmitWagerTransactionCommand => {
    const externalTransactionId = overrides.externalTransactionId ?? `ext-${uuidv7()}`;
    return {
      idempotencyKey: `provider-a:${externalTransactionId}`,
      providerId: 'provider-a',
      externalTransactionId,
      playerId,
      walletId,
      roundId: 'round-1',
      gameId: 'game-1',
      kind: 'BET',
      money: { amount: '25.00', currency: 'BRL' },
      ...overrides,
    };
  };

  type TxRow = {
    status: string;
    failure_code: string | null;
    reference_attempts: number;
    next_attempt_at: Date | null;
    observed_balance: string | null;
  };

  async function rowOf(externalTransactionId: string): Promise<TxRow> {
    const rows = (await orm.em.getConnection().execute(
      `select status, failure_code, reference_attempts, next_attempt_at,
              observed_balance::text as observed_balance
         from wager_transactions where external_transaction_id = ?`,
      [externalTransactionId],
    )) as unknown as TxRow[];
    return rows[0]!;
  }

  async function eventTypes(): Promise<string[]> {
    const rows = (await orm.em
      .getConnection()
      .execute('select event_type from outbox_messages')) as unknown as Array<{ event_type: string }>;
    return rows.map((row) => row.event_type).sort();
  }

  // ----------------------------------------------------- referência que chega depois
  test('REFUND que chegou antes da BET é resolvido pelo worker e o saldo volta', async () => {
    const { walletId, playerId } = await openWalletInDb(orm, '1000.00');
    const refundCmd = command(walletId, playerId, {
      externalTransactionId: 'refund-1',
      kind: 'REFUND',
      referenceExternalTransactionId: 'bet-1',
    });

    const first = await submit.execute(refundCmd);
    expect(first.status).toBe(Status.PendingReference);

    await submit.execute(command(walletId, playerId, { externalTransactionId: 'bet-1' }));
    expect((await ledgerSummary(orm, walletId)).balance.amount).toBe('975.00');

    const result = await makeWorker().runOnce();
    expect(result).toMatchObject({ claimed: 1, resolved: 1, failed: 0 });

    expect((await rowOf('refund-1')).status).toBe('PROCESSED');
    const summary = await ledgerSummary(orm, walletId);
    expect(summary.balance.amount).toBe('1000.00');
    expect(summary.entries).toBe(3); // abertura, débito da aposta, crédito do refund
    expect(summary.consistent).toBe(true);

    // quem reenviar o REFUND recebe o estado final, sem novo efeito
    const replay = await submit.execute(refundCmd);
    expect(replay).toMatchObject({ idempotentReplay: true, status: Status.Processed });
    expect(replay.balance?.amount).toBe('1000.00');

    expect(await eventTypes()).toEqual([
      'WagerTransactionPendingReference',
      'WagerTransactionProcessed', // BET
      'WagerTransactionProcessed', // REFUND (worker)
      'WalletBalanceChanged',
      'WalletBalanceChanged',
    ]);
  });

  test('ROLLBACK que chegou antes da WIN debita quando a WIN chega', async () => {
    const { walletId, playerId } = await openWalletInDb(orm, '1000.00');

    const rollback = await submit.execute(
      command(walletId, playerId, {
        externalTransactionId: 'rollback-1',
        kind: 'ROLLBACK',
        referenceExternalTransactionId: 'win-1',
        money: { amount: '50.00', currency: 'BRL' },
      }),
    );
    expect(rollback.status).toBe(Status.PendingReference);

    await submit.execute(
      command(walletId, playerId, {
        externalTransactionId: 'win-1',
        kind: 'WIN',
        money: { amount: '50.00', currency: 'BRL' },
      }),
    );
    expect((await ledgerSummary(orm, walletId)).balance.amount).toBe('1050.00');

    expect(await makeWorker().runOnce()).toMatchObject({ resolved: 1 });

    const summary = await ledgerSummary(orm, walletId);
    expect(summary.balance.amount).toBe('1000.00');
    expect(summary.entries).toBe(3); // abertura, crédito da WIN, débito do rollback
    expect(summary.debits).toBe(1);
    expect(summary.consistent).toBe(true);
  });

  // ------------------------------------------------------------ referência não chega
  test('referência nunca chega: esgota as tentativas e rejeita com REFERENCE_NOT_FOUND', async () => {
    const { walletId, playerId } = await openWalletInDb(orm, '1000.00');
    const refundCmd = command(walletId, playerId, {
      externalTransactionId: 'refund-1',
      kind: 'REFUND',
      referenceExternalTransactionId: 'bet-never-arrives',
    });
    await submit.execute(refundCmd);

    const worker = makeWorker(FAST);
    expect(await worker.runOnce()).toMatchObject({ stillPending: 1 });
    expect(await worker.runOnce()).toMatchObject({ stillPending: 1 });
    expect(await worker.runOnce()).toMatchObject({ expired: 1 });

    const row = await rowOf('refund-1');
    expect(row.status).toBe('REJECTED');
    expect(row.failure_code).toBe('REFERENCE_NOT_FOUND');
    expect(row.next_attempt_at).toBeNull();

    const summary = await ledgerSummary(orm, walletId);
    expect(summary.balance.amount).toBe('1000.00');
    expect(summary.entries).toBe(1); // só a abertura
    expect(await eventTypes()).toEqual([
      'WagerTransactionPendingReference',
      'WagerTransactionRejected',
    ]);

    // terminal: não volta para a fila
    expect((await worker.runOnce()).claimed).toBe(0);

    const replay = await submit.execute(refundCmd);
    expect(replay).toMatchObject({
      idempotentReplay: true,
      status: Status.Rejected,
      failureCode: FailureCode.ReferenceNotFound,
    });
  });

  test('backoff real: depois de uma tentativa a transação sai da fila até o próximo horário', async () => {
    const { walletId, playerId } = await openWalletInDb(orm, '1000.00');
    await submit.execute(
      command(walletId, playerId, {
        externalTransactionId: 'refund-1',
        kind: 'REFUND',
        referenceExternalTransactionId: 'bet-not-yet',
      }),
    );

    const worker = makeWorker(DEFAULT_PENDING_REFERENCE_POLICY);
    expect(await worker.runOnce()).toMatchObject({ claimed: 1, stillPending: 1 });

    const row = await rowOf('refund-1');
    expect(row.status).toBe('PENDING_REFERENCE');
    expect(row.reference_attempts).toBe(1);
    expect(new Date(row.next_attempt_at!).getTime() - Date.now()).toBeGreaterThan(1_000);

    expect((await worker.runOnce()).claimed).toBe(0); // ainda não está na hora
  });

  test('referência rejeitada: o REFUND vira REJECTED/REFERENCE_NOT_PROCESSED', async () => {
    const { walletId, playerId } = await openWalletInDb(orm, '10.00');
    await submit.execute(
      command(walletId, playerId, {
        externalTransactionId: 'refund-1',
        kind: 'REFUND',
        referenceExternalTransactionId: 'bet-1',
      }),
    );
    const bet = await submit.execute(command(walletId, playerId, { externalTransactionId: 'bet-1' }));
    expect(bet.status).toBe(Status.Rejected); // 25 > 10

    expect(await makeWorker().runOnce()).toMatchObject({ rejected: 1 });
    const row = await rowOf('refund-1');
    expect(row.status).toBe('REJECTED');
    expect(row.failure_code).toBe('REFERENCE_NOT_PROCESSED');
    expect((await ledgerSummary(orm, walletId)).balance.amount).toBe('10.00');
  });

  // ------------------------------------------------------------- várias instâncias
  test('4 workers em paralelo sobre 6 wallets: cada pendente é resolvida uma única vez, sem deadlock', async () => {
    const wallets = await Promise.all(
      Array.from({ length: 6 }, () => openWalletInDb(orm, '1000.00')),
    );

    await Promise.all(
      wallets.map((wallet, i) =>
        submit.execute(
          command(wallet.walletId, wallet.playerId, {
            externalTransactionId: `refund-${i}`,
            kind: 'REFUND',
            referenceExternalTransactionId: `bet-${i}`,
          }),
        ),
      ),
    );
    await Promise.all(
      wallets.map((wallet, i) =>
        submit.execute(
          command(wallet.walletId, wallet.playerId, { externalTransactionId: `bet-${i}` }),
        ),
      ),
    );

    const results = await Promise.all(Array.from({ length: 4 }, () => makeWorker().runOnce()));

    expect(results.reduce((sum, r) => sum + r.resolved, 0)).toBe(6);
    expect(results.every((r) => r.failed === 0)).toBe(true);

    for (const wallet of wallets) {
      const summary = await ledgerSummary(orm, wallet.walletId);
      expect(summary.balance.amount).toBe('1000.00');
      expect(summary.entries).toBe(3);
      expect(summary.credits).toBe(2); // abertura + refund, nunca em dobro
      expect(summary.consistent).toBe(true);
    }
    expect((await makeWorker().runOnce()).claimed).toBe(0);
  });

  test('5 workers disputando a MESMA transação: o crédito acontece uma única vez', async () => {
    const { walletId, playerId } = await openWalletInDb(orm, '1000.00');
    await submit.execute(
      command(walletId, playerId, {
        externalTransactionId: 'refund-1',
        kind: 'REFUND',
        referenceExternalTransactionId: 'bet-1',
      }),
    );
    await submit.execute(command(walletId, playerId, { externalTransactionId: 'bet-1' }));

    const results = await Promise.all(Array.from({ length: 5 }, () => makeWorker().runOnce()));

    expect(results.reduce((sum, r) => sum + r.resolved, 0)).toBe(1);
    expect(results.reduce((sum, r) => sum + r.skipped, 0)).toBeGreaterThanOrEqual(1);
    expect(results.every((r) => r.failed === 0)).toBe(true);

    const summary = await ledgerSummary(orm, walletId);
    expect(summary.balance.amount).toBe('1000.00');
    expect(summary.credits).toBe(2);
    expect(summary.consistent).toBe(true);
  });

  // ----------------------------------------------------------------- recuperação
  test('erro antes do commit: nada é gravado, a transação continua pendente e a próxima rodada resolve', async () => {
    const { walletId, playerId } = await openWalletInDb(orm, '1000.00');
    await submit.execute(
      command(walletId, playerId, {
        externalTransactionId: 'refund-1',
        kind: 'REFUND',
        referenceExternalTransactionId: 'bet-1',
      }),
    );
    await submit.execute(command(walletId, playerId, { externalTransactionId: 'bet-1' }));

    const errors: unknown[] = [];
    const worker = makeWorker(FAST, { onError: (error) => errors.push(error) }, new FailOnceUow(pendingUow));

    const crashed = await worker.runOnce();
    expect(crashed).toMatchObject({ claimed: 1, failed: 1, resolved: 0 });
    expect(errors).toHaveLength(1);

    expect((await rowOf('refund-1')).status).toBe('PENDING_REFERENCE');
    let summary = await ledgerSummary(orm, walletId);
    expect(summary.balance.amount).toBe('975.00');
    expect(summary.entries).toBe(2);

    const recovered = await worker.runOnce();
    expect(recovered).toMatchObject({ resolved: 1, failed: 0 });
    summary = await ledgerSummary(orm, walletId);
    expect(summary.balance.amount).toBe('1000.00');
    expect(summary.entries).toBe(3);
    expect(summary.consistent).toBe(true);
  });
});