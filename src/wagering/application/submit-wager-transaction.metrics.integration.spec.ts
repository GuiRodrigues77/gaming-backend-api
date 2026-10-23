import { MikroORM } from '@mikro-orm/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import config from '../../../mikro-orm.config';
import { WagerTransactionStatus as Status } from '../domain/transaction/wager-transaction-status';
import { MikroOrmWageringUnitOfWork } from '../infrastructure/persistence/mikro-orm-wagering-unit-of-work';
import { WAGERING_SCHEMAS } from '../infrastructure/persistence/wagering-schemas';
import { resetWageringTables } from '../testing/reset-tables';
import { openWalletInDb } from '../testing/wallet-fixture';
import type {
  DuplicateReason,
  LockConflictType,
  WageringMetrics,
} from './ports/wagering-metrics.port';
import { SubmitWagerTransaction, type SubmitWagerTransactionCommand } from './submit-wager-transaction';

const RUN = process.env.DATABASE_INTEGRATION?.trim() === '1';

class RecordingMetrics implements WageringMetrics {
  readonly decided: Array<[string, string]> = [];
  readonly duplicates: DuplicateReason[] = [];
  readonly conflicts: LockConflictType[] = [];
  readonly outcomes: string[] = [];
  lockWaits = 0;

  transactionDecided(status: string, kind: string): void {
    this.decided.push([status, kind]);
  }
  pendingReferenceResolved(): void {}
  duplicateDetected(reason: DuplicateReason): void {
    this.duplicates.push(reason);
  }
  retried(): void {}
  deadLettered(): void {}
  lockConflict(type: LockConflictType): void {
    this.conflicts.push(type);
  }
  walletLockWaited(): void {
    this.lockWaits += 1;
  }
  processingTime(_seconds: number, outcome: string): void {
    this.outcomes.push(outcome);
  }
}

describe.skipIf(!RUN)('SubmitWagerTransaction: métricas (PostgreSQL real)', () => {
  let orm: MikroORM;
  let metrics: RecordingMetrics;
  let submit: SubmitWagerTransaction;

  beforeAll(async () => {
    orm = await MikroORM.init({ ...config, entities: WAGERING_SCHEMAS, entitiesTs: WAGERING_SCHEMAS });
  });

  afterAll(async () => {
    await orm.close();
  });

  beforeEach(async () => {
    await resetWageringTables(orm);
    metrics = new RecordingMetrics();
    submit = new SubmitWagerTransaction(new MikroOrmWageringUnitOfWork(orm.em), { metrics });
  });

  const command = (
    walletId: string,
    playerId: string,
    overrides: Partial<SubmitWagerTransactionCommand> = {},
  ): SubmitWagerTransactionCommand => {
    const externalTransactionId = overrides.externalTransactionId ?? `ext-${randomUUID()}`;
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

  test('transação nova: conta o status, mede o lock e a latência', async () => {
    const { walletId, playerId } = await openWalletInDb(orm, '1000.00');
    await submit.execute(command(walletId, playerId));

    expect(metrics.decided).toEqual([[Status.Processed, 'BET']]);
    expect(metrics.outcomes).toEqual([Status.Processed.toLowerCase()]);
    expect(metrics.lockWaits).toBe(1);
    expect(metrics.duplicates).toEqual([]);
  });

  test('rejeição de negócio conta como REJECTED', async () => {
    const { walletId, playerId } = await openWalletInDb(orm, '10.00');
    await submit.execute(command(walletId, playerId));

    expect(metrics.decided).toEqual([[Status.Rejected, 'BET']]);
  });

  test('reenvio é replay: conta duplicata e não conta como transação nova', async () => {
    const { walletId, playerId } = await openWalletInDb(orm, '1000.00');
    const cmd = command(walletId, playerId);
    await submit.execute(cmd);
    await submit.execute(cmd);

    expect(metrics.decided).toHaveLength(1);
    expect(metrics.duplicates).toEqual(['replay']);
  });

  test('mesma chave com payload diferente conta payload_mismatch', async () => {
    const { walletId, playerId } = await openWalletInDb(orm, '1000.00');
    const original = command(walletId, playerId);
    await submit.execute(original);
    await expect(
      submit.execute({ ...original, money: { amount: '30.00', currency: 'BRL' } }),
    ).rejects.toThrow();

    expect(metrics.duplicates).toEqual(['payload_mismatch']);
    expect(metrics.outcomes.at(-1)).toBe('error');
  });

  test('50 envios idênticos em paralelo: uma decisão, 49 replays, 50 medições', async () => {
    const { walletId, playerId } = await openWalletInDb(orm, '1000.00');
    const cmd = command(walletId, playerId);
    await Promise.all(Array.from({ length: 50 }, () => submit.execute(cmd)));

    expect(metrics.decided).toHaveLength(1);
    expect(metrics.duplicates.filter((reason) => reason === 'replay')).toHaveLength(49);
    expect(metrics.outcomes).toHaveLength(50);
    expect(metrics.lockWaits).toBeGreaterThanOrEqual(50);
  });
});