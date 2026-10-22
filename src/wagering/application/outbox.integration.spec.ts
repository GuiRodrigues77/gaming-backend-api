import { MikroORM } from '@mikro-orm/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import config from '../../../mikro-orm.config';
import { IntegrationEvent } from '../domain/events/integration-event';
import { WagerTransactionProcessed } from '../domain/events/wagering-events';
import { OutboxMessage, type OutboxEnvelope } from '../domain/outbox/outbox-message';
import { Money } from '../domain/money/money';
import { WagerTransaction } from '../domain/transaction/wager-transaction';
import { WagerTransactionKind } from '../domain/transaction/wager-transaction-kind';
import { MikroOrmOutboxStore } from '../infrastructure/persistence/mikro-orm-outbox-store';
import { MikroOrmWageringUnitOfWork } from '../infrastructure/persistence/mikro-orm-wagering-unit-of-work';
import { OutboxMessageMapper } from '../infrastructure/persistence/mappers/outbox-message.mapper';
import { WAGERING_SCHEMAS } from '../infrastructure/persistence/wagering-schemas';
import { WalletRecord } from '../infrastructure/persistence/wallet.record';
import { resetWageringTables } from '../testing/reset-tables';
import { openWalletInDb } from '../testing/wallet-fixture';
import { OutboxPublisher } from './outbox-publisher';
import type { EventPublisher } from './ports/event-publisher.port';
import { SubmitWagerTransaction, type SubmitWagerTransactionCommand } from './submit-wager-transaction';
import { uuidv7 } from './uuid-v7';

const RUN = process.env.DATABASE_INTEGRATION?.trim() === '1';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class TestEvent extends IntegrationEvent<{ n: number }> {
  readonly eventType = 'TestEvent';
  readonly version = 1;

  static make(n: number): TestEvent {
    return new TestEvent({
      eventId: uuidv7(),
      aggregateId: `aggregate-${n}`,
      correlationId: uuidv7(),
      occurredAt: new Date(Date.now() + n), // ordem estável
      data: { n },
    });
  }
}

class RecordingPublisher implements EventPublisher {
  readonly published: string[] = [];
  private failures = 0;

  constructor(
    private readonly delayMs = 0,
    private readonly failTimes = 0,
  ) {}

  async publish(event: OutboxEnvelope): Promise<void> {
    if (this.delayMs > 0) await sleep(this.delayMs);
    if (this.failures < this.failTimes) {
      this.failures += 1;
      throw new Error('broker down');
    }
    this.published.push(event.eventId);
  }
}

describe.skipIf(!RUN)('outbox (PostgreSQL real)', () => {
  let orm: MikroORM;
  let uow: MikroOrmWageringUnitOfWork;
  let submit: SubmitWagerTransaction;
  let store: MikroOrmOutboxStore;

  beforeAll(async () => {
    orm = await MikroORM.init({ ...config, entities: WAGERING_SCHEMAS, entitiesTs: WAGERING_SCHEMAS });
    uow = new MikroOrmWageringUnitOfWork(orm.em);
    submit = new SubmitWagerTransaction(uow);
    store = new MikroOrmOutboxStore(orm.em);
  });

  afterAll(async () => {
    await orm.close();
  });

  beforeEach(async () => {
    await resetWageringTables(orm);
  });

  type OutboxRow = {
    id: string;
    event_type: string;
    attempts: number;
    next_attempt_at: Date | null;
    published_at: Date | null;
  };

  async function outboxRows(): Promise<OutboxRow[]> {
    return (await orm.em
      .getConnection()
      .execute(
        'select id, event_type, attempts, next_attempt_at, published_at from outbox_messages order by occurred_at, id',
      )) as unknown as OutboxRow[];
  }

  async function seedOutbox(count: number): Promise<TestEvent[]> {
    const events = Array.from({ length: count }, (_, i) => TestEvent.make(i + 1));
    await orm.em.fork().transactional(async (em) => {
      for (const event of events) em.persist(OutboxMessageMapper.toRecord(OutboxMessage.enqueue(event)));
    });
    return events;
  }

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

  const eventTypes = async () => (await outboxRows()).map((r) => r.event_type).sort();

  // ------------------------------------------------------- gravação na outbox
  test('BET processada grava Processed + BalanceChanged, ainda não publicados', async () => {
    const { walletId, playerId } = await openWalletInDb(orm, '1000.00');
    await submit.execute(command(walletId, playerId));

    expect(await eventTypes()).toEqual(['WagerTransactionProcessed', 'WalletBalanceChanged']);
    expect((await outboxRows()).every((r) => r.published_at === null)).toBe(true);
  });

  test('LOSS grava só Processed; aposta sem saldo grava só Rejected; REFUND sem referência grava PendingReference', async () => {
    const { walletId, playerId } = await openWalletInDb(orm, '10.00');

    await submit.execute(command(walletId, playerId, { kind: 'LOSS' }));
    expect(await eventTypes()).toEqual(['WagerTransactionProcessed']);

    await submit.execute(command(walletId, playerId, { money: { amount: '999.00', currency: 'BRL' } }));
    await submit.execute(
      command(walletId, playerId, {
        kind: 'REFUND',
        referenceExternalTransactionId: 'bet-that-never-came',
      }),
    );
    expect(await eventTypes()).toEqual([
      'WagerTransactionPendingReference',
      'WagerTransactionProcessed',
      'WagerTransactionRejected',
    ]);
  });

  test('50 envios idênticos em paralelo geram os eventos uma única vez', async () => {
    const { walletId, playerId } = await openWalletInDb(orm, '1000.00');
    const cmd = command(walletId, playerId);
    await Promise.all(Array.from({ length: 50 }, () => submit.execute(cmd)));

    expect(await outboxRows()).toHaveLength(2);
  });

  test('crash antes do commit: saldo, transação, ledger e outbox somem juntos', async () => {
    const { walletId, playerId } = await openWalletInDb(orm, '1000.00');

    await expect(
      uow.run(async (scope) => {
        const wallet = (await scope.lockWallet(walletId))!;
        const now = new Date();
        const tx = WagerTransaction.create({
          id: uuidv7(),
          providerId: 'provider-a',
          externalTransactionId: 'bet-crash',
          idempotencyKey: 'provider-a:bet-crash',
          payloadHash: 'h',
          walletId,
          playerId,
          roundId: 'round-1',
          gameId: 'game-1',
          kind: WagerTransactionKind.Bet,
          money: Money.from({ amount: '25.00', currency: 'BRL' }),
          createdAt: now,
        });
        const entry = wallet.debit({
          transactionId: tx.id,
          ledgerEntryId: uuidv7(),
          money: tx.money,
          now,
        });
        tx.markProcessed(undefined, now);
        scope.saveWallet(wallet);
        await scope.saveNewTransaction(tx, {});
        scope.appendLedgerEntry(entry, wallet.version);
        scope.enqueueOutbox(
          OutboxMessage.enqueue(
            WagerTransactionProcessed.from(tx, { eventId: uuidv7(), correlationId: uuidv7(), occurredAt: now }),
          ),
        );
        throw new Error('crash before commit');
      }),
    ).rejects.toThrow('crash before commit');

    expect(await outboxRows()).toHaveLength(0);
    const record = await orm.em.fork().findOneOrFail(WalletRecord, { id: walletId });
    expect(record.balance).toBe('1000.00');
    const rows = (await orm.em
      .getConnection()
      .execute(`select count(*)::int as n from wager_transactions where external_transaction_id = 'bet-crash'`)) as unknown as Array<{ n: number }>;
    expect(rows[0]!.n).toBe(0);
  });

  // ------------------------------------------------------------- publicação
  test('dois publishers sobre a mesma outbox: cada evento é publicado uma única vez', async () => {
    await seedOutbox(20);
    const broker = new RecordingPublisher(20); // 20ms por mensagem: força sobreposição
    const a = new OutboxPublisher(store, broker, { batchSize: 10 });
    const b = new OutboxPublisher(store, broker, { batchSize: 10 });

    await Promise.all([a.publishDue(), b.publishDue()]);

    expect(broker.published).toHaveLength(20);
    expect(new Set(broker.published).size).toBe(20);
    expect((await outboxRows()).every((r) => r.published_at !== null)).toBe(true);
  });

  test('processo morre depois de publicar e antes do commit: outra instância reassume (duplicata segura)', async () => {
    const events = await seedOutbox(3);
    const broker = new RecordingPublisher();

    // Instância 1 publica a primeira mensagem e "morre" antes do commit.
    await expect(
      store.withDueBatch(10, new Date(), async (batch) => {
        await broker.publish(batch.messages[0]!.toEnvelope());
        throw new Error('process died');
      }),
    ).rejects.toThrow('process died');

    // A transação foi desfeita: nada consta como publicado.
    expect((await outboxRows()).every((r) => r.published_at === null)).toBe(true);

    // Instância 2 assume e publica tudo.
    const result = await new OutboxPublisher(store, broker).publishDue();
    expect(result.published).toBe(3);
    expect((await outboxRows()).every((r) => r.published_at !== null)).toBe(true);

    // At-least-once: o primeiro evento foi entregue duas vezes, com o MESMO eventId.
    // É isso que permite ao consumidor deduplicar (inbox).
    const firstId = events[0]!.eventId;
    expect(broker.published.filter((id) => id === firstId)).toHaveLength(2);
    expect(new Set(broker.published).size).toBe(3);
  });

  test('falha do broker: a mensagem fica pendente com backoff e é publicada depois', async () => {
    await seedOutbox(1);
    const broker = new RecordingPublisher(0, 1); // falha uma vez
    let clock = new Date();
    const publisher = new OutboxPublisher(store, broker, { now: () => clock });

    const first = await publisher.publishDue();
    expect(first).toMatchObject({ published: 0, failed: 1 });
    const [row] = await outboxRows();
    expect(row!.attempts).toBe(1);
    expect(row!.published_at).toBeNull();
    expect(new Date(row!.next_attempt_at!).getTime()).toBeGreaterThan(clock.getTime());

    // Ainda em backoff: não é nem selecionada.
    expect((await publisher.publishDue()).claimed).toBe(0);

    // Passado o backoff, é publicada.
    clock = new Date(clock.getTime() + 61_000);
    const third = await publisher.publishDue();
    expect(third.published).toBe(1);
    expect(broker.published).toHaveLength(1);
    expect((await outboxRows())[0]!.published_at).not.toBeNull();
  });
});