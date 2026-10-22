import { EntityManager } from '@mikro-orm/core';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import config from '../../../../mikro-orm.config';
import { WAGERING_SCHEMAS } from '../../infrastructure/persistence/wagering-schemas';
import { WageringModule } from '../../wagering.module';

const RUN = process.env.DATABASE_INTEGRATION?.trim() === '1';

describe.skipIf(!RUN)('API HTTP (PostgreSQL real)', () => {
  let app: INestApplication;
  let em: EntityManager;

  beforeAll(async () => {
    process.env.WAGERING_WORKERS_ENABLED = 'false';
    const moduleRef = await Test.createTestingModule({
      imports: [
        MikroOrmModule.forRoot({ ...config, entities: WAGERING_SCHEMAS, entitiesTs: WAGERING_SCHEMAS }),
        WageringModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    await app.listen(0); // escutando de verdade: requisições paralelas usam o mesmo servidor
    em = app.get(EntityManager);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await em
      .getConnection()
      .execute('TRUNCATE outbox_messages, wallet_ledger_entries, wager_transactions, wallets');
  });

  const server = () => app.getHttpServer();

  type Wallet = { id: string; playerId: string };

  const createWallet = async (balance = '1000.00'): Promise<Wallet> => {
    const res = await request(server())
      .post('/wallets')
      .send({ playerId: randomUUID(), initialBalance: { amount: balance, currency: 'BRL' } });
    expect(res.status).toBe(201);
    return res.body as Wallet;
  };

  const payload = (
    wallet: Wallet,
    externalTransactionId: string,
    overrides: Record<string, unknown> = {},
  ) => ({
    providerId: 'provider-a',
    externalTransactionId,
    playerId: wallet.playerId,
    walletId: wallet.id,
    roundId: 'round-1',
    gameId: 'game-1',
    kind: 'BET',
    money: { amount: '25.00', currency: 'BRL' },
    ...overrides,
  });

  const submit = (body: Record<string, unknown>, key: string) =>
    request(server()).post('/wagering/transactions').set('Idempotency-Key', key).send(body);

  const balanceOf = async (wallet: Wallet) =>
    ((await request(server()).get(`/wallets/${wallet.id}`)).body as { balance: { amount: string } })
      .balance.amount;

  // ------------------------------------------------------------------ wallets
  test('POST /wallets cria a wallet; duplicada => 409', async () => {
    const playerId = randomUUID();
    const body = { playerId, initialBalance: { amount: '1000.00', currency: 'BRL' } };

    const created = await request(server()).post('/wallets').send(body);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      playerId,
      balance: { amount: '1000.00', currency: 'BRL' },
      version: 1,
    });

    const duplicate = await request(server()).post('/wallets').send(body);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error).toBe('WALLET_ALREADY_EXISTS');
  });

  test('POST /wallets com saldo zero não gera lançamento', async () => {
    const wallet = await createWallet('0.00');
    const ledger = await request(server()).get(`/wallets/${wallet.id}/ledger`);
    expect(ledger.body.items).toHaveLength(0);
  });

  test.each([
    ['playerId inválido', { playerId: 'abc', initialBalance: { amount: '1.00', currency: 'BRL' } }],
    ['notação científica', { playerId: randomUUID(), initialBalance: { amount: '1e3', currency: 'BRL' } }],
    ['valor negativo', { playerId: randomUUID(), initialBalance: { amount: '-5.00', currency: 'BRL' } }],
    ['mais de 2 casas', { playerId: randomUUID(), initialBalance: { amount: '1.001', currency: 'BRL' } }],
    ['valor gigante', { playerId: randomUUID(), initialBalance: { amount: '1234567890123456.00', currency: 'BRL' } }],
    ['campo desconhecido', { playerId: randomUUID(), initialBalance: { amount: '1.00', currency: 'BRL' }, extra: 1 }],
  ])('POST /wallets rejeita %s com 400', async (_name, body) => {
    const res = await request(server()).post('/wallets').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  test('GET /wallets/:id: 200, 404 e 400', async () => {
    const wallet = await createWallet();
    const ok = await request(server()).get(`/wallets/${wallet.id}`);
    expect(ok.status).toBe(200);
    expect(ok.body.balance.amount).toBe('1000.00');

    expect((await request(server()).get(`/wallets/${randomUUID()}`)).status).toBe(404);
    expect((await request(server()).get('/wallets/not-a-uuid')).status).toBe(400);
  });

  // ------------------------------------------------------------- transações
  test('POST /wagering/transactions: BET processada e replay idêntico', async () => {
    const wallet = await createWallet();
    const body = payload(wallet, 'bet-1');

    const first = await submit(body, 'provider-a:bet-1');
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      status: 'PROCESSED',
      balance: { amount: '975.00', currency: 'BRL' },
      idempotentReplay: false,
    });

    const replay = await submit(body, 'provider-a:bet-1');
    expect(replay.status).toBe(200);
    expect(replay.body.idempotentReplay).toBe(true);
    expect(replay.body.transactionId).toBe(first.body.transactionId);
    expect(await balanceOf(wallet)).toBe('975.00');
  });

  test('mesma chave com payload diferente => 409', async () => {
    const wallet = await createWallet();
    await submit(payload(wallet, 'bet-1'), 'provider-a:bet-1');
    const conflict = await submit(
      payload(wallet, 'bet-1', { money: { amount: '30.00', currency: 'BRL' } }),
      'provider-a:bet-1',
    );
    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toBe('IDEMPOTENCY_CONFLICT');
  });

  test('sem Idempotency-Key => 400', async () => {
    const wallet = await createWallet();
    const res = await request(server()).post('/wagering/transactions').send(payload(wallet, 'bet-1'));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  test('kind OPENING não pode ser submetido => 400', async () => {
    const wallet = await createWallet();
    const res = await submit(payload(wallet, 'x', { kind: 'OPENING' }), 'provider-a:x');
    expect(res.status).toBe(400);
  });

  test('regra de negócio violada => 422 com failureCode; replay mantém o 422', async () => {
    const wallet = await createWallet('10.00');
    const body = payload(wallet, 'bet-1');
    const first = await submit(body, 'provider-a:bet-1');
    expect(first.status).toBe(422);
    expect(first.body).toMatchObject({ status: 'REJECTED', failureCode: 'INSUFFICIENT_FUNDS' });

    const replay = await submit(body, 'provider-a:bet-1');
    expect(replay.status).toBe(422);
    expect(replay.body.idempotentReplay).toBe(true);
    expect(await balanceOf(wallet)).toBe('10.00');
  });

  test('referência ausente => 202 PENDING_REFERENCE', async () => {
    const wallet = await createWallet();
    const res = await submit(
      payload(wallet, 'refund-1', { kind: 'REFUND', referenceExternalTransactionId: 'bet-not-yet' }),
      'provider-a:refund-1',
    );
    expect(res.status).toBe(202);
    expect(res.body.status).toBe('PENDING_REFERENCE');
    expect(await balanceOf(wallet)).toBe('1000.00');
  });

  test('50 requisições idênticas em paralelo: um único débito', async () => {
    const wallet = await createWallet();
    const body = payload(wallet, 'bet-parallel');
    const responses = await Promise.all(
      Array.from({ length: 50 }, () => submit(body, 'provider-a:bet-parallel')),
    );

    expect(responses.every((r) => r.status === 200)).toBe(true);
    expect(responses.filter((r) => r.body.idempotentReplay === false)).toHaveLength(1);
    expect(await balanceOf(wallet)).toBe('975.00');
  });

  test('cenário obrigatório: saldo 100, duas apostas de 80 simultâneas => um 200 e um 422', async () => {
    const wallet = await createWallet('100.00');
    const [a, b] = await Promise.all([
      submit(payload(wallet, 'a', { money: { amount: '80.00', currency: 'BRL' } }), 'k-a'),
      submit(payload(wallet, 'b', { money: { amount: '80.00', currency: 'BRL' } }), 'k-b'),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 422]);
    const rejected = a.status === 422 ? a : b;
    expect(rejected.body.failureCode).toBe('INSUFFICIENT_FUNDS');
    expect(await balanceOf(wallet)).toBe('20.00');
  });

  // --------------------------------------------------------------- consultas
  test('consulta por id interno e por (providerId, externalTransactionId)', async () => {
    const wallet = await createWallet();
    const created = await submit(payload(wallet, 'bet-1'), 'provider-a:bet-1');

    const byId = await request(server()).get(`/wagering/transactions/${created.body.transactionId}`);
    expect(byId.status).toBe(200);
    expect(byId.body).toMatchObject({ kind: 'BET', status: 'PROCESSED', externalTransactionId: 'bet-1' });

    const byExternal = await request(server()).get(
      '/providers/provider-a/wagering/transactions/bet-1',
    );
    expect(byExternal.status).toBe(200);
    expect(byExternal.body.transactionId).toBe(created.body.transactionId);

    expect((await request(server()).get(`/wagering/transactions/${randomUUID()}`)).status).toBe(404);
    expect((await request(server()).get('/wagering/transactions/abc')).status).toBe(400);
    expect(
      (await request(server()).get('/providers/provider-a/wagering/transactions/nope')).status,
    ).toBe(404);
  });

  test('ledger paginado: cursor estável, do mais novo para o mais antigo', async () => {
    const wallet = await createWallet();
    for (let i = 1; i <= 5; i += 1) {
      await submit(payload(wallet, `p${i}`), `provider-a:p${i}`);
    }

    const versions: number[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const query = cursor === undefined ? '?limit=2' : `?limit=2&cursor=${cursor}`;
      const res = await request(server()).get(`/wallets/${wallet.id}/ledger${query}`);
      expect(res.status).toBe(200);
      for (const item of res.body.items) versions.push(item.walletVersion);
      cursor = res.body.nextCursor ?? undefined;
      pages += 1;
    } while (cursor !== undefined);

    expect(versions).toEqual([6, 5, 4, 3, 2, 1]); // abertura + 5 apostas
    expect(pages).toBe(3);
  });

  test('ledger rejeita cursor e limit inválidos com 400', async () => {
    const wallet = await createWallet();
    for (const query of ['?cursor=@@@', '?limit=0', '?limit=101', '?limit=abc']) {
      const res = await request(server()).get(`/wallets/${wallet.id}/ledger${query}`);
      expect(res.status).toBe(400);
    }
  });

  // ----------------------------------------------------------- reconciliação
  test('reconciliação: consistente quando saldo e ledger batem', async () => {
    const wallet = await createWallet();
    await submit(payload(wallet, 'bet-1'), 'provider-a:bet-1');

    const res = await request(server()).post(`/wallets/${wallet.id}/reconciliation`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      walletId: wallet.id,
      storedBalance: { amount: '975.00', currency: 'BRL' },
      calculatedBalance: { amount: '975.00', currency: 'BRL' },
      difference: { amount: '0.00', currency: 'BRL' },
      consistent: true,
      checkedEntries: 2,
    });
  });

  test('reconciliação detecta divergência, sinaliza e NÃO corrige', async () => {
    const wallet = await createWallet('1000.00');
    const connection = em.getConnection();

    // Só para provocar a divergência: desliga a trava de consistência do banco por um instante.
    await connection.execute('ALTER TABLE wallets DISABLE TRIGGER wallets_ledger_consistency');
    try {
      await connection.execute(`UPDATE wallets SET balance = 990.00 WHERE id = '${wallet.id}'`);

      const res = await request(server()).post(`/wallets/${wallet.id}/reconciliation`);
      expect(res.status).toBe(200);
      expect(res.body.consistent).toBe(false);
      expect(res.body.difference).toEqual({ amount: '-10.00', currency: 'BRL' });
      expect(res.body.storedBalance.amount).toBe('990.00'); // continua como estava
    } finally {
      await connection.execute('ALTER TABLE wallets ENABLE TRIGGER wallets_ledger_consistency');
    }
  });

  test('reconciliação de wallet inexistente => 404', async () => {
    expect((await request(server()).post(`/wallets/${randomUUID()}/reconciliation`)).status).toBe(404);
  });

  // ------------------------------------------------------------------ health
  test('health live e ready respondem sem autenticação', async () => {
    expect((await request(server()).get('/health/live')).body).toEqual({ status: 'ok' });
    const ready = await request(server()).get('/health/ready');
    expect(ready.status).toBe(200);
    expect(ready.body).toEqual({ status: 'ok', checks: { postgres: 'up' } });
  });
});