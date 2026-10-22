import { describe, expect, test } from 'bun:test';
import { PollingWorker } from './polling-worker';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('PollingWorker', () => {
  test('repete a tarefa até parar', async () => {
    let calls = 0;
    const worker = new PollingWorker(async () => {
      calls += 1;
      return 0;
    }, 5);

    worker.start();
    await sleep(60);
    await worker.stop();

    const callsAtStop = calls;
    expect(callsAtStop).toBeGreaterThanOrEqual(2);
    await sleep(30);
    expect(calls).toBe(callsAtStop);
  });

  test('stop espera a execução em andamento terminar', async () => {
    let finished = false;
    const worker = new PollingWorker(async () => {
      await sleep(40);
      finished = true;
      return 0;
    }, 5);

    worker.start();
    await sleep(15); // a tarefa já está rodando
    await worker.stop();
    expect(finished).toBe(true);
  });

  test('erro da tarefa vai para onError e o laço continua', async () => {
    const errors: unknown[] = [];
    let calls = 0;
    const worker = new PollingWorker(
      async () => {
        calls += 1;
        throw new Error('boom');
      },
      5,
      (error) => errors.push(error),
    );

    worker.start();
    await sleep(40);
    await worker.stop();

    expect(errors.length).toBeGreaterThanOrEqual(2);
    expect(errors).toHaveLength(calls);
  });

  test('com trabalho feito, roda de novo sem esperar o intervalo', async () => {
    let calls = 0;
    const worker = new PollingWorker(async () => {
      calls += 1;
      return calls <= 3 ? 1 : 0;
    }, 1_000);

    worker.start();
    await sleep(60);
    await worker.stop();

    expect(calls).toBe(4); // 3 com trabalho + 1 vazia, que então espera 1s
  });
});