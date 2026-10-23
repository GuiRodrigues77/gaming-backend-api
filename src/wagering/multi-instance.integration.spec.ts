import { GetQueueUrlCommand, SendMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';
import { MikroORM } from '@mikro-orm/postgresql';
import type { Subprocess } from 'bun';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import config from '../../mikro-orm.config';
import { createSqsClient, loadSqsConfig } from './infrastructure/messaging/sqs.config';
import { WAGERING_SCHEMAS } from './infrastructure/persistence/wagering-schemas';
import { ledgerSummary } from './testing/ledger-summary';
import { resetWageringTables } from './testing/reset-tables';
import { openWalletInDb } from './testing/wallet-fixture';

const RUN = process.env.MULTI_INSTANCE_INTEGRATION?.trim() === '1';
const PORTS = [3101, 3102, 3103] as const;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe.skipIf(!RUN)('3 instâncias reais (processos separados)', () => {
  let orm: MikroORM;
  let sqs: SQSClient;
  let queueUrl: string;
  let mainFile: string;
  let nodeBinary: string;
  const runId = randomUUID(); // ids únicos por execução: nada de limpar tabelas com as instâncias no ar
  const instances: Array<{ port: number; proc: Subprocess }> = [];

  // ---------------------------------------------------------------- instâncias
  async function waitReady(port: number, proc: Subprocess, timeoutMs = 45_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (proc.exitCode !== null) {
        throw new Error(`instância ${port} encerrou (código ${proc.exitCode}); rode "bun ${mainFile}" para ver o erro`);
      }
      try {
        const response = await fetch(`http://localhost:${port}/health/ready`);
        if (response.status === 200) return;
      } catch {
        // ainda subindo
      }
      await sleep(300);
    }
    throw new Error(`instância ${port} não ficou pronta a tempo`);
  }

  async function startInstance(port: number): Promise<{ port: number; proc: Subprocess }> {
    const proc = Bun.spawn([nodeBinary, mainFile], {
      env: { ...process.env, PORT: String(port), SQS_ENDPOINT: 'http://localhost:4566' },
      stdout: process.env.MULTI_INSTANCE_LOGS === '1' ? 'inherit' : 'ignore',
      stderr: 'inherit',
    });
    await waitReady(port, proc);
    return { port, proc };
  }

  beforeAll(async () => {
    const found = ['dist/main.js', 'dist/src/main.js'].find((candidate) => existsSync(candidate));
    if (found === undefined) throw new Error('dist não encontrado: rode "bun run build" antes');
    mainFile = found;

    const node = Bun.which('node');
    if (node === null) throw new Error('node não encontrado no PATH: o dist compilado roda em Node');
    nodeBinary = node;

    orm = await MikroORM.init({ ...config, entities: WAGERING_SCHEMAS, entitiesTs: WAGERING_SCHEMAS });
    const sqsConfig = loadSqsConfig({ SQS_ENDPOINT: 'http://localhost:4566' });
    sqs = createSqsClient(sqsConfig);
    const { QueueUrl } = await sqs.send(new GetQueueUrlCommand({ QueueName: sqsConfig.wagerQueueName }));
    if (!QueueUrl) throw new Error('fila de entrada sem URL');
    queueUrl = QueueUrl;

    await resetWageringTables(orm);

    instances.push(...(await Promise.all(PORTS.map((port) => startInstance(port)))));
  }, 120_000);

  afterAll(async () => {
    for (const instance of instances) instance.proc.kill();
    await Promise.all(instances.map((instance) => instance.proc.exited));
    await orm.close();
    sqs.destroy();
  });

  // ------------------------------------------------------------------- helpers
  const portOf = (index: number) => PORTS[index % PORTS.length]!;

  async function submitBet(
    port: number,
    input: { walletId: string; playerId: string; externalTransactionId: string; amount: string },
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await fetch(`http://localhost:${port}/wagering/transactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': `provider-a:${input.externalTransactionId}`,
      },
      body: JSON.stringify({
        providerId: 'provider-a',
        externalTransactionId: input.externalTransactionId,
        playerId: input.playerId,
        walletId: input.walletId,
        roundId: 'round-1',
        gameId: 'game-1',
        kind: 'BET',
        money: { amount: input.amount, currency: 'BRL' },
      }),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  async function count(sql: string, params: unknown[] = []): Promise<number> {
    const rows = (await orm.em.getConnection().execute(sql, params)) as unknown as Array<{ n: number }>;
    return rows[0]!.n;
  }

  async function until(condition: () => Promise<boolean>, timeoutMs: number, label: string): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await condition()) return;
      await sleep(250);
    }
    throw new Error(`timeout: ${label}`);
  }

  const inboxCount = (prefix: string) =>
    count('select count(*)::int as n from inbox_messages where message_id like ?', [`${prefix}%`]);

  const outboxPending = (walletIds: string[]) =>
    count(
      `select count(*)::int as n from outbox_messages
        where published_at is null
          and payload->'data'->>'walletId' in (${walletIds.map(() => '?').join(',')})`,
      walletIds,
    );

  const outboxTotal = (walletIds: string[]) =>
    count(
      `select count(*)::int as n from outbox_messages
        where payload->'data'->>'walletId' in (${walletIds.map(() => '?').join(',')})`,
      walletIds,
    );

  type Wallet = { walletId: string; playerId: string };

  /** Em ordem dentro de cada carteira; carteiras em paralelo. A 1ª mensagem de cada uma é entregue duas vezes. */
  async function sendBatch(prefix: string, wallets: Wallet[], perWallet: number): Promise<void> {
    await Promise.all(
      wallets.map(async (wallet) => {
        const bodies = Array.from({ length: perWallet }, (_, index) => {
          const externalTransactionId = `ext-${randomUUID()}`;
          return JSON.stringify({
            messageId: `${prefix}-${wallet.walletId}-${index}`,
            type: 'WagerTransactionRequested',
            occurredAt: new Date().toISOString(),
            data: {
              providerId: 'provider-a',
              externalTransactionId,
              idempotencyKey: `provider-a:${externalTransactionId}`,
              playerId: wallet.playerId,
              walletId: wallet.walletId,
              roundId: 'round-1',
              gameId: 'game-1',
              kind: 'BET',
              money: { amount: '25.00', currency: 'BRL' },
            },
          });
        });
        for (const body of [...bodies, bodies[0]!]) {
          await sqs.send(
            new SendMessageCommand({
              QueueUrl: queueUrl,
              MessageBody: body,
              MessageGroupId: wallet.walletId,
              MessageDeduplicationId: randomUUID(),
            }),
          );
        }
      }),
    );
  }

  async function expectFullySettled(wallets: Wallet[], perWallet: number): Promise<void> {
    const ids = wallets.map((wallet) => wallet.walletId);
    // todos os eventos publicados (por quem estiver vivo), sem perder nenhum
    await until(async () => (await outboxPending(ids)) === 0, 60_000, 'outbox esvaziar');
    expect(await outboxTotal(ids)).toBe(wallets.length * perWallet * 2); // Processed + BalanceChanged

    const expectedBalance = (1000 - 25 * perWallet).toFixed(2);
    for (const wallet of wallets) {
      const ledger = await ledgerSummary(orm, wallet.walletId);
      expect(ledger.consistent).toBe(true); // saldo == ledger
      expect(ledger.debits).toBe(perWallet); // nenhum débito duplicado ou perdido
      expect(ledger.balance.amount).toBe(expectedBalance);
    }
  }

  // -------------------------------------------------------------------- testes
  test('carteira quente: 3 apostas de 80 com saldo 100, cada uma numa instância => um 200 e dois 422', async () => {
    const { walletId, playerId } = await openWalletInDb(orm, '100.00');

    const responses = await Promise.all(
      PORTS.map((port, index) =>
        submitBet(port, { walletId, playerId, externalTransactionId: `ext-hot-${runId}-${index}`, amount: '80.00' }),
      ),
    );

    expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 422)).toHaveLength(2);
    const ledger = await ledgerSummary(orm, walletId);
    expect(ledger.consistent).toBe(true);
    expect(ledger.debits).toBe(1);
    expect(ledger.balance.amount).toBe('20.00');
  }, 60_000);

  test('a mesma aposta 60 vezes em paralelo, espalhada pelas 3 instâncias => um único débito', async () => {
    const { walletId, playerId } = await openWalletInDb(orm, '1000.00');
    const input = { walletId, playerId, externalTransactionId: `ext-same-${runId}`, amount: '25.00' };

    const responses = await Promise.all(Array.from({ length: 60 }, (_, index) => submitBet(portOf(index), input)));

    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(new Set(responses.map((response) => response.body.transactionId)).size).toBe(1);
    expect(responses.filter((response) => response.body.idempotentReplay === false)).toHaveLength(1);
    const ledger = await ledgerSummary(orm, walletId);
    expect(ledger.consistent).toBe(true);
    expect(ledger.debits).toBe(1);
  }, 60_000);

  test('fila consumida pelas 3 instâncias, com duplicatas: nada perdido nem duplicado', async () => {
    const prefix = `multi-${randomUUID()}`;
    const wallets = await Promise.all(Array.from({ length: 6 }, () => openWalletInDb(orm, '1000.00')));
    const perWallet = 5;

    await sendBatch(prefix, wallets, perWallet);
    await until(async () => (await inboxCount(prefix)) === wallets.length * perWallet, 60_000, 'fila ser consumida');

    await expectFullySettled(wallets, perWallet);
  }, 120_000);

  test('instância morta no meio do trabalho e reiniciada: a consistência final se mantém', async () => {
    const prefix = `kill-${randomUUID()}`;
    const wallets = await Promise.all(Array.from({ length: 12 }, () => openWalletInDb(orm, '1000.00')));
    const perWallet = 10;
    const total = wallets.length * perWallet;

    const sending = sendBatch(prefix, wallets, perWallet);
    await until(async () => (await inboxCount(prefix)) >= 1, 60_000, 'primeiras mensagens');

    // Morte abrupta de uma instância enquanto o trabalho está em andamento.
    instances[0]!.proc.kill();
    await instances[0]!.proc.exited;
    await sending;

    // As outras duas seguem sozinhas; a morta volta e passa a ajudar.
    instances[0] = await startInstance(PORTS[0]);

    // Mensagens que estavam com a instância morta voltam depois do timeout de visibilidade (30 s).
    await until(async () => (await inboxCount(prefix)) === total, 150_000, 'toda a fila ser processada');
    await expectFullySettled(wallets, perWallet);
  }, 240_000);
});