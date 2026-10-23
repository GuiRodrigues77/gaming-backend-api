import {
  DeleteMessageCommand,
  GetQueueUrlCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import { MikroORM } from '@mikro-orm/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import config from '../../../../mikro-orm.config';
import { HandleWagerMessage } from '../../application/handle-wager-message';
import type { MessageDisposition } from '../../application/message-disposition';
import type { ReceivedMessage, WagerQueue } from '../../application/ports/wager-queue.port';
import { SubmitWagerTransaction } from '../../application/submit-wager-transaction';
import { WagerMessageConsumer } from '../../application/wager-message-consumer';
import { WagerTransactionStatus as Status } from '../../domain/transaction/wager-transaction-status';
import { ledgerSummary } from '../../testing/ledger-summary';
import { resetWageringTables } from '../../testing/reset-tables';
import { openWalletInDb } from '../../testing/wallet-fixture';
import { MikroOrmWageringUnitOfWork } from '../persistence/mikro-orm-wagering-unit-of-work';
import { WAGERING_SCHEMAS } from '../persistence/wagering-schemas';
import { SqsWagerQueue, type SqsWagerQueueOptions } from './sqs-wager-queue';
import { createSqsClient, loadSqsConfig } from './sqs.config';

const RUN =
  process.env.DATABASE_INTEGRATION?.trim() === '1' && process.env.SQS_INTEGRATION?.trim() === '1';
const CONSUMER = 'wager-consumer';

interface Settled {
  body: string;
  disposition: MessageDisposition;
}

/** Simula "o worker morreu depois do commit e antes do ack": o primeiro ack da mensagem falha. */
class CrashOnceAckQueue extends SqsWagerQueue {
  crashOnceFor: string | undefined;

  override async acknowledge(message: ReceivedMessage): Promise<void> {
    if (this.crashOnceFor !== undefined && message.body.includes(this.crashOnceFor)) {
      this.crashOnceFor = undefined;
      throw new Error('worker morreu depois do commit e antes do ack');
    }
    return super.acknowledge(message);
  }
}

describe.skipIf(!RUN)('consumer SQS (PostgreSQL e MiniStack reais)', () => {
  let orm: MikroORM;
  let client: SQSClient;
  let queueOptions: SqsWagerQueueOptions;
  let queue: SqsWagerQueue;
  let handler: HandleWagerMessage;
  let consumer: WagerMessageConsumer;
  let mainUrl: string;
  let dlqUrl: string;
  const settled: Settled[] = [];
  const failed: ReceivedMessage[] = [];

  async function urlOf(queueName: string): Promise<string> {
    const { QueueUrl } = await client.send(new GetQueueUrlCommand({ QueueName: queueName }));
    if (!QueueUrl) throw new Error(`queue ${queueName} has no URL`);
    return QueueUrl;
  }

  const newConsumer = (target: WagerQueue) =>
    new WagerMessageConsumer(target, handler, {
      waitSeconds: 1,
      onSettled: (message, disposition) => settled.push({ body: message.body, disposition }),
      onError: (_error, message) => failed.push(message),
    });

  beforeAll(async () => {
    orm = await MikroORM.init({ ...config, entities: WAGERING_SCHEMAS, entitiesTs: WAGERING_SCHEMAS });
    const sqsConfig = loadSqsConfig({
      SQS_ENDPOINT: process.env.SQS_ENDPOINT?.trim() || 'http://localhost:4566',
    });
    client = createSqsClient(sqsConfig);
    mainUrl = await urlOf(sqsConfig.wagerQueueName);
    dlqUrl = await urlOf(sqsConfig.wagerDeadLetterQueueName);
    queueOptions = {
      queueName: sqsConfig.wagerQueueName,
      deadLetterQueueName: sqsConfig.wagerDeadLetterQueueName,
    };
    queue = new SqsWagerQueue(client, queueOptions);
    handler = new HandleWagerMessage(new SubmitWagerTransaction(new MikroOrmWageringUnitOfWork(orm.em)), {
      consumerName: CONSUMER,
    });
    consumer = newConsumer(queue);
  });

  afterAll(async () => {
    await orm.close();
    client.destroy();
  });

  beforeEach(async () => {
    await resetWageringTables(orm);
    settled.length = 0;
    failed.length = 0;
  });

  // ------------------------------------------------------------------ helpers
  /** A mensagem do README (seção 10). `data` aceita sobrescritas. */
  function wagerMessage(
    messageId: string,
    walletId: string,
    playerId: string,
    data: Record<string, unknown> = {},
  ) {
    const externalTransactionId =
      typeof data.externalTransactionId === 'string' ? data.externalTransactionId : `ext-${randomUUID()}`;
    return {
      messageId,
      type: 'WagerTransactionRequested',
      occurredAt: new Date().toISOString(),
      data: {
        providerId: 'provider-a',
        externalTransactionId,
        idempotencyKey: `provider-a:${externalTransactionId}`,
        playerId,
        walletId,
        roundId: 'round-1',
        gameId: 'game-1',
        kind: 'BET',
        money: { amount: '25.00', currency: 'BRL' },
        ...data,
      },
    };
  }

  /** Dedup id aleatório: simula entregas distintas da mesma mensagem lógica. */
  async function send(body: unknown, groupId: string): Promise<void> {
    await client.send(
      new SendMessageCommand({
        QueueUrl: mainUrl,
        MessageBody: typeof body === 'string' ? body : JSON.stringify(body),
        MessageGroupId: groupId,
        MessageDeduplicationId: randomUUID(),
      }),
    );
  }

  /** O marcador (messageId) é único por teste: mensagens velhas na fila não atrapalham. */
  const settledFor = (marker: string) => settled.filter((entry) => entry.body.includes(marker));

  async function runUntil(
    consumers: WagerMessageConsumer | WagerMessageConsumer[],
    condition: () => boolean,
    timeoutMs = 25_000,
  ): Promise<void> {
    const list = Array.isArray(consumers) ? consumers : [consumers];
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await Promise.all(list.map((item) => item.runOnce()));
      if (condition()) return;
    }
    throw new Error('timeout esperando a condição do teste');
  }

  async function count(sql: string, params: unknown[]): Promise<number> {
    const rows = (await orm.em.getConnection().execute(sql, params)) as unknown as Array<{ n: number }>;
    return rows[0]!.n;
  }

  const inboxCount = (messageIdLike: string) =>
    count('select count(*)::int as n from inbox_messages where message_id like ?', [messageIdLike]);

  async function findInDlq(marker: string) {
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      const output = await client.send(
        new ReceiveMessageCommand({
          QueueUrl: dlqUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 1,
          MessageAttributeNames: ['All'],
        }),
      );
      const found = output.Messages?.find((message) => message.Body?.includes(marker));
      if (found) {
        await client.send(new DeleteMessageCommand({ QueueUrl: dlqUrl, ReceiptHandle: found.ReceiptHandle! }));
        return found;
      }
    }
    return undefined;
  }

  // -------------------------------------------------------------------- testes
  test('mensagem válida: débito, inbox e eventos da outbox no mesmo commit, e ack', async () => {
    const { walletId, playerId } = await openWalletInDb(orm, '1000.00');
    const messageId = `msg-${randomUUID()}`;
    await send(wagerMessage(messageId, walletId, playerId), walletId);

    await runUntil(consumer, () => settledFor(messageId).length >= 1);

    expect(settledFor(messageId)[0]!.disposition).toMatchObject({
      action: 'ACK',
      status: Status.Processed,
      idempotentReplay: false,
    });
    const ledger = await ledgerSummary(orm, walletId);
    expect(ledger.consistent).toBe(true);
    expect(ledger.debits).toBe(1);
    expect(ledger.balance.amount).toBe('975.00');
    expect(await inboxCount(messageId)).toBe(1);
    expect(
      await count(`select count(*)::int as n from outbox_messages where payload->'data'->>'walletId' = ?`, [
        walletId,
      ]),
    ).toBe(2); // Processed + BalanceChanged
  }, 30_000);

  test('saldo insuficiente é resultado de negócio: ack com REJECTED, não DLQ', async () => {
    const { walletId, playerId } = await openWalletInDb(orm, '10.00');
    const messageId = `msg-${randomUUID()}`;
    await send(wagerMessage(messageId, walletId, playerId), walletId);

    await runUntil(consumer, () => settledFor(messageId).length >= 1);

    expect(settledFor(messageId)[0]!.disposition).toMatchObject({ action: 'ACK', status: Status.Rejected });
    const ledger = await ledgerSummary(orm, walletId);
    expect(ledger.consistent).toBe(true);
    expect(ledger.balance.amount).toBe('10.00');
  }, 30_000);

  test('redelivery: a mesma mensagem entregue duas vezes debita uma única vez', async () => {
    const { walletId, playerId } = await openWalletInDb(orm, '1000.00');
    const messageId = `msg-${randomUUID()}`;
    const body = wagerMessage(messageId, walletId, playerId);
    await send(body, walletId);
    await send(body, walletId);

    await runUntil(consumer, () => settledFor(messageId).length >= 2);

    const [first, second] = settledFor(messageId);
    expect(first!.disposition).toMatchObject({ action: 'ACK', idempotentReplay: false });
    expect(second!.disposition).toMatchObject({ action: 'ACK', idempotentReplay: true });
    const ledger = await ledgerSummary(orm, walletId);
    expect(ledger.consistent).toBe(true);
    expect(ledger.debits).toBe(1);
    expect(await inboxCount(messageId)).toBe(1);
  }, 30_000);

  test('mensagem malformada vai para a DLQ com o motivo e não volta', async () => {
    const marker = `poison-${randomUUID()}`;
    await send(`{"marker":"${marker}"`, marker); // JSON truncado

    await runUntil(consumer, () => settledFor(marker).length >= 1);
    expect(settledFor(marker)[0]!.disposition).toMatchObject({
      action: 'DEAD_LETTER',
      reason: 'INVALID_MESSAGE',
    });

    const inDlq = await findInDlq(marker);
    expect(inDlq).toBeDefined();
    expect(inDlq!.MessageAttributes?.deadLetterReason?.StringValue).toBe('INVALID_MESSAGE');

    await consumer.runOnce();
    await consumer.runOnce();
    expect(settledFor(marker)).toHaveLength(1); // saiu da fila principal
  }, 40_000);

  test('mesmo messageId com payload diferente vai para a DLQ como CONFLICT e o saldo fica intacto', async () => {
    const { walletId, playerId } = await openWalletInDb(orm, '1000.00');
    const messageId = `msg-${randomUUID()}`;
    await send(wagerMessage(messageId, walletId, playerId, { externalTransactionId: 'ext-a' }), walletId);
    await send(
      wagerMessage(messageId, walletId, playerId, {
        externalTransactionId: 'ext-b',
        money: { amount: '30.00', currency: 'BRL' },
      }),
      walletId,
    );

    await runUntil(consumer, () => settledFor(messageId).length >= 2);

    const [first, second] = settledFor(messageId);
    expect(first!.disposition).toMatchObject({ action: 'ACK', status: Status.Processed });
    expect(second!.disposition).toMatchObject({ action: 'DEAD_LETTER', reason: 'CONFLICT' });
    const inDlq = await findInDlq(messageId);
    expect(inDlq!.MessageAttributes?.deadLetterReason?.StringValue).toBe('CONFLICT');

    const ledger = await ledgerSummary(orm, walletId);
    expect(ledger.consistent).toBe(true);
    expect(ledger.debits).toBe(1);
    expect(ledger.balance.amount).toBe('975.00');
  }, 40_000);

  test('worker morto depois do commit e antes do ack: a mensagem volta e vira replay', async () => {
    const { walletId, playerId } = await openWalletInDb(orm, '1000.00');
    const messageId = `msg-${randomUUID()}`;
    const crashQueue = new CrashOnceAckQueue(client, queueOptions);
    crashQueue.crashOnceFor = messageId;
    const crashConsumer = newConsumer(crashQueue);
    await send(wagerMessage(messageId, walletId, playerId), walletId);

    // 1ª entrega: o use case faz o commit, mas o ack "morre".
    await runUntil(crashConsumer, () => failed.some((message) => message.body.includes(messageId)));
    expect(settledFor(messageId)).toHaveLength(0);
    expect(await inboxCount(messageId)).toBe(1);
    expect((await ledgerSummary(orm, walletId)).debits).toBe(1);

    // O timeout de visibilidade (30 s) expira: aqui simulado devolvendo a mensagem na hora.
    const lost = failed.find((message) => message.body.includes(messageId))!;
    await queue.release(lost, 0);

    // 2ª entrega: o inbox reconhece e a mensagem recebe o ack sem novo efeito.
    await runUntil(crashConsumer, () => settledFor(messageId).length >= 1);
    expect(settledFor(messageId)[0]!.disposition).toMatchObject({ action: 'ACK', idempotentReplay: true });
    const ledger = await ledgerSummary(orm, walletId);
    expect(ledger.consistent).toBe(true);
    expect(ledger.debits).toBe(1);
    expect(ledger.balance.amount).toBe('975.00');
    expect(await inboxCount(messageId)).toBe(1);
  }, 40_000);

  test('3 consumers sobre 6 carteiras, com duplicatas: cada aposta debita uma única vez', async () => {
    const prefix = `run-${randomUUID()}`;
    const wallets = await Promise.all(Array.from({ length: 6 }, () => openWalletInDb(orm, '1000.00')));

    let sent = 0;
    for (const wallet of wallets) {
      const bodies = Array.from({ length: 5 }, (_, index) =>
        wagerMessage(`${prefix}-${wallet.walletId}-${index}`, wallet.walletId, wallet.playerId),
      );
      for (const body of [...bodies, bodies[0]!]) {
        // a primeira aposta de cada carteira é entregue duas vezes
        await send(body, wallet.walletId);
        sent += 1;
      }
    }

    const consumers = [consumer, newConsumer(queue), newConsumer(queue)];
    await runUntil(consumers, () => settledFor(prefix).length >= sent, 60_000);

    const replays = settledFor(prefix).filter(
      (entry) => entry.disposition.action === 'ACK' && entry.disposition.idempotentReplay,
    );
    expect(sent).toBe(36);
    expect(replays).toHaveLength(6);
    expect(await inboxCount(`${prefix}%`)).toBe(30);
    for (const wallet of wallets) {
      const ledger = await ledgerSummary(orm, wallet.walletId);
      expect(ledger.consistent).toBe(true);
      expect(ledger.debits).toBe(5);
      expect(ledger.balance.amount).toBe('875.00');
    }
  }, 90_000);
});