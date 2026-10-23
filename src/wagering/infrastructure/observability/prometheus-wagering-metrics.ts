import { EntityManager } from '@mikro-orm/core';
import { Inject, Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry } from 'prom-client';
import type {
  DuplicateReason,
  LockConflictType,
  MetricsRenderer,
  PendingReferenceOutcome,
  RetryComponent,
  WageringMetrics,
} from '../../application/ports/wagering-metrics.port';

const LATENCY_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

@Injectable()
export class PrometheusWageringMetrics implements WageringMetrics, MetricsRenderer {
  private readonly registry = new Registry(); // registro próprio: nada de estado global
  readonly contentType = this.registry.contentType;

  private readonly transactions: Counter<'status' | 'kind'>;
  private readonly pendingResolutions: Counter<'outcome'>;
  private readonly duplicates: Counter<'reason'>;
  private readonly retries: Counter<'component'>;
  private readonly deadLetters: Counter<'reason'>;
  private readonly lockConflicts: Counter<'type'>;
  private readonly lockWait: Histogram;
  private readonly processing: Histogram<'outcome'>;

  constructor(@Inject(EntityManager) private readonly em: EntityManager) {
    const registers = [this.registry];

    this.transactions = new Counter({
      name: 'wagering_transactions_total',
      help: 'Transações novas decididas, por status e tipo (replays não entram)',
      labelNames: ['status', 'kind'] as const,
      registers,
    });
    this.pendingResolutions = new Counter({
      name: 'wagering_pending_reference_resolutions_total',
      help: 'Desfecho das transações PENDING_REFERENCE tratadas pelo worker',
      labelNames: ['outcome'] as const,
      registers,
    });
    this.duplicates = new Counter({
      name: 'wagering_duplicates_total',
      help: 'Duplicatas e conflitos de idempotência detectados',
      labelNames: ['reason'] as const,
      registers,
    });
    this.retries = new Counter({
      name: 'wagering_retries_total',
      help: 'Tentativas repetidas por componente',
      labelNames: ['component'] as const,
      registers,
    });
    this.deadLetters = new Counter({
      name: 'wagering_dlq_messages_total',
      help: 'Mensagens enviadas à DLQ, por motivo',
      labelNames: ['reason'] as const,
      registers,
    });
    this.lockConflicts = new Counter({
      name: 'wagering_lock_conflicts_total',
      help: 'Conflitos de concorrência no banco (corrida de unicidade, deadlock, serialização)',
      labelNames: ['type'] as const,
      registers,
    });
    this.lockWait = new Histogram({
      name: 'wagering_wallet_lock_wait_seconds',
      help: 'Tempo esperando o lock da wallet',
      buckets: LATENCY_BUCKETS,
      registers,
    });
    this.processing = new Histogram({
      name: 'wagering_transaction_processing_seconds',
      help: 'Latência do processamento de uma transação, por desfecho',
      labelNames: ['outcome'] as const,
      buckets: LATENCY_BUCKETS,
      registers,
    });

    // Outbox lag: calculado na hora do scrape, direto do banco (vale para qualquer instância).
    const readLag = () => this.readOutboxLag();
    new Gauge({
      name: 'wagering_outbox_pending_messages',
      help: 'Eventos da outbox ainda não publicados',
      registers,
      async collect() {
        this.set((await readLag()).pending);
      },
    });
    new Gauge({
      name: 'wagering_outbox_oldest_pending_age_seconds',
      help: 'Idade do evento pendente mais antigo da outbox (o lag)',
      registers,
      async collect() {
        this.set((await readLag()).oldestAgeSeconds);
      },
    });
  }

  transactionDecided(status: string, kind: string): void {
    this.transactions.inc({ status, kind });
  }

  pendingReferenceResolved(outcome: PendingReferenceOutcome, count: number): void {
    if (count > 0) this.pendingResolutions.inc({ outcome }, count);
  }

  duplicateDetected(reason: DuplicateReason): void {
    this.duplicates.inc({ reason });
  }

  retried(component: RetryComponent): void {
    this.retries.inc({ component });
  }

  deadLettered(reason: string): void {
    this.deadLetters.inc({ reason });
  }

  lockConflict(type: LockConflictType): void {
    this.lockConflicts.inc({ type });
  }

  walletLockWaited(seconds: number): void {
    this.lockWait.observe(seconds);
  }

  processingTime(seconds: number, outcome: string): void {
    this.processing.observe({ outcome }, seconds);
  }

  render(): Promise<string> {
    return this.registry.metrics();
  }

  private async readOutboxLag(): Promise<{ pending: number; oldestAgeSeconds: number }> {
    try {
      const rows = (await this.em.fork().getConnection().execute(
        `select count(*)::int as pending,
                coalesce(extract(epoch from (now() - min(occurred_at))), 0)::float8 as oldest_age_seconds
           from outbox_messages
          where published_at is null`,
      )) as unknown as Array<{ pending: number; oldest_age_seconds: number }>;
      return {
        pending: Number(rows[0]?.pending ?? 0),
        oldestAgeSeconds: Number(rows[0]?.oldest_age_seconds ?? 0),
      };
    } catch {
      // Banco fora do ar não pode derrubar o scrape: as demais métricas continuam saindo.
      return { pending: 0, oldestAgeSeconds: 0 };
    }
  }
}