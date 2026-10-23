import type { EntityManager } from '@mikro-orm/core';
import { describe, expect, test } from 'bun:test';
import { PrometheusWageringMetrics } from './prometheus-wagering-metrics';

function fakeEm(execute: () => Promise<unknown>): EntityManager {
  return { fork: () => ({ getConnection: () => ({ execute }) }) } as unknown as EntityManager;
}

/** Linha do scrape que começa com o nome e contém todos os rótulos (a ordem dos rótulos não importa). */
function line(text: string, name: string, labels: string[] = []): string | undefined {
  return text
    .split('\n')
    .find((row) => row.startsWith(name) && labels.every((label) => row.includes(label)));
}

describe('PrometheusWageringMetrics', () => {
  test('contadores saem com os rótulos certos', async () => {
    const metrics = new PrometheusWageringMetrics(fakeEm(async () => []));
    metrics.transactionDecided('PROCESSED', 'BET');
    metrics.transactionDecided('PROCESSED', 'BET');
    metrics.transactionDecided('REJECTED', 'BET');
    metrics.duplicateDetected('replay');
    metrics.retried('outbox');
    metrics.deadLettered('INVALID_MESSAGE');
    metrics.lockConflict('unique_violation');
    metrics.pendingReferenceResolved('expired', 2);
    metrics.pendingReferenceResolved('processed', 0); // zero não cria série

    const text = await metrics.render();
    expect(line(text, 'wagering_transactions_total{', ['status="PROCESSED"', 'kind="BET"'])).toEndWith(' 2');
    expect(line(text, 'wagering_transactions_total{', ['status="REJECTED"'])).toEndWith(' 1');
    expect(line(text, 'wagering_duplicates_total{', ['reason="replay"'])).toEndWith(' 1');
    expect(line(text, 'wagering_retries_total{', ['component="outbox"'])).toEndWith(' 1');
    expect(line(text, 'wagering_dlq_messages_total{', ['reason="INVALID_MESSAGE"'])).toEndWith(' 1');
    expect(line(text, 'wagering_lock_conflicts_total{', ['type="unique_violation"'])).toEndWith(' 1');
    expect(line(text, 'wagering_pending_reference_resolutions_total{', ['outcome="expired"'])).toEndWith(' 2');
    expect(line(text, 'wagering_pending_reference_resolutions_total{', ['outcome="processed"'])).toBeUndefined();
  });

  test('histogramas registram contagem e soma', async () => {
    const metrics = new PrometheusWageringMetrics(fakeEm(async () => []));
    metrics.walletLockWaited(0.02);
    metrics.processingTime(0.1, 'processed');
    metrics.processingTime(0.3, 'processed');

    const text = await metrics.render();
    expect(line(text, 'wagering_wallet_lock_wait_seconds_count')).toEndWith(' 1');
    expect(line(text, 'wagering_transaction_processing_seconds_count{', ['outcome="processed"'])).toEndWith(' 2');
  });

  test('o lag da outbox vem do banco na hora do scrape', async () => {
    const metrics = new PrometheusWageringMetrics(
      fakeEm(async () => [{ pending: 3, oldest_age_seconds: 12.5 }]),
    );

    const text = await metrics.render();
    expect(line(text, 'wagering_outbox_pending_messages ')).toEndWith(' 3');
    expect(line(text, 'wagering_outbox_oldest_pending_age_seconds ')).toEndWith(' 12.5');
  });

  test('banco fora do ar não derruba o scrape', async () => {
    const metrics = new PrometheusWageringMetrics(
      fakeEm(async () => {
        throw new Error('connection refused');
      }),
    );
    metrics.transactionDecided('PROCESSED', 'BET');

    const text = await metrics.render();
    expect(line(text, 'wagering_transactions_total{')).toBeDefined();
    expect(line(text, 'wagering_outbox_pending_messages ')).toEndWith(' 0');
  });
});