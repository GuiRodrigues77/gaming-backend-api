import type { SQSClient } from '@aws-sdk/client-sqs';
import { Logger, Module } from '@nestjs/common';
import { CreateWallet } from './application/create-wallet';
import { OutboxPublisher } from './application/outbox-publisher';
import { EVENT_PUBLISHER, type EventPublisher } from './application/ports/event-publisher.port';
import { OUTBOX_STORE, type OutboxStore } from './application/ports/outbox-store.port';
import {
  PENDING_REFERENCE_UNIT_OF_WORK,
  type PendingReferenceUnitOfWork,
} from './application/ports/pending-reference.port';
import {
  WAGERING_READ_MODEL,
  type WageringReadModel,
} from './application/ports/wagering-read-model.port';
import {
  WAGERING_UNIT_OF_WORK,
  type WageringUnitOfWork,
} from './application/ports/wagering-unit-of-work.port';
import { WALLET_CREATOR, type WalletCreator } from './application/ports/wallet-creator.port';
import { ResolvePendingReferences } from './application/resolve-pending-references';
import { SubmitWagerTransaction } from './application/submit-wager-transaction';
import { WageringQueries } from './application/wagering-queries';
import { SqsEventPublisher } from './infrastructure/messaging/sqs-event-publisher';
import {
  SQS_CLIENT,
  SQS_CONFIG,
  createSqsClient,
  loadSqsConfig,
  type SqsConfig,
} from './infrastructure/messaging/sqs.config';
import { MikroOrmOutboxStore } from './infrastructure/persistence/mikro-orm-outbox-store';
import { MikroOrmPendingReferenceUnitOfWork } from './infrastructure/persistence/mikro-orm-pending-reference-unit-of-work';
import { MikroOrmWageringReadModel } from './infrastructure/persistence/mikro-orm-wagering-read-model';
import { MikroOrmWageringUnitOfWork } from './infrastructure/persistence/mikro-orm-wagering-unit-of-work';
import { MikroOrmWalletCreator } from './infrastructure/persistence/mikro-orm-wallet-creator';
import { OutboxWorkerService } from './infrastructure/workers/outbox-worker.service';
import { PendingReferenceWorkerService } from './infrastructure/workers/pending-reference-worker.service';
import { HealthController } from './interface/http/health/health.controller';
import { PostgresReadinessCheck } from './interface/http/health/postgres-readiness.check';
import { READINESS_CHECKS } from './interface/http/health/readiness-check';
import { SqsReadinessCheck } from './interface/http/health/sqs-readiness.check';
import { WageringController } from './interface/http/wagering.controller';
import { WalletsController } from './interface/http/wallets.controller';
import { HandleWagerMessage } from './application/handle-wager-message';
import { WAGER_QUEUE, type WagerQueue } from './application/ports/wager-queue.port';
import {
  WagerMessageConsumer,
  type WagerMessageProcessor,
} from './application/wager-message-consumer';
import { SqsWagerQueue } from './infrastructure/messaging/sqs-wager-queue';
import { WagerConsumerWorkerService } from './infrastructure/workers/wager-consumer-worker.service';

// Importações de Métricas
import {
  METRICS_RENDERER,
  WAGERING_METRICS,
  type WageringMetrics,
} from './application/ports/wagering-metrics.port';
import { PrometheusWageringMetrics } from './infrastructure/observability/prometheus-wagering-metrics';
import { MetricsController } from './interface/http/metrics.controller';

const pendingReferencesLogger = new Logger('PendingReferences');
const WAGER_CONSUMER_NAME = 'wager-consumer';
const wagerConsumerLogger = new Logger('WagerConsumer');
const wageringLogger = new Logger('Wagering'); // NOVO

@Module({
  controllers: [
    WalletsController,
    WageringController,
    HealthController,
    MetricsController,
  ],
  providers: [
    // portas -> adaptadores MikroORM
    { provide: WAGERING_UNIT_OF_WORK, useClass: MikroOrmWageringUnitOfWork },
    { provide: WALLET_CREATOR, useClass: MikroOrmWalletCreator },
    { provide: WAGERING_READ_MODEL, useClass: MikroOrmWageringReadModel },
    { provide: PENDING_REFERENCE_UNIT_OF_WORK, useClass: MikroOrmPendingReferenceUnitOfWork },
    { provide: OUTBOX_STORE, useClass: MikroOrmOutboxStore },

    // SQS
    { provide: SQS_CONFIG, useFactory: () => loadSqsConfig() },
    {
      provide: SQS_CLIENT,
      useFactory: (config: SqsConfig) => createSqsClient(config),
      inject: [SQS_CONFIG],
    },
    {
      provide: EVENT_PUBLISHER,
      useFactory: (client: SQSClient, config: SqsConfig) =>
        new SqsEventPublisher(client, config.eventsQueueName),
      inject: [SQS_CLIENT, SQS_CONFIG],
    },
    {
      provide: WAGER_QUEUE,
      useFactory: (client: SQSClient, config: SqsConfig) =>
        new SqsWagerQueue(client, {
          queueName: config.wagerQueueName,
          deadLetterQueueName: config.wagerDeadLetterQueueName,
        }),
      inject: [SQS_CLIENT, SQS_CONFIG],
    },

    // métricas (Prometheus)
    PrometheusWageringMetrics,
    { provide: WAGERING_METRICS, useExisting: PrometheusWageringMetrics },
    { provide: METRICS_RENDERER, useExisting: PrometheusWageringMetrics },

    // casos de uso (classes puras, sem decorators do Nest)
    {
      provide: SubmitWagerTransaction,
      useFactory: (uow: WageringUnitOfWork, metrics: WageringMetrics) =>
        new SubmitWagerTransaction(uow, {
          metrics,
          onDecision: (decision) =>
            wageringLogger.log({ event: 'transaction_decided', ...decision }),
        }),
      inject: [WAGERING_UNIT_OF_WORK, WAGERING_METRICS],
    },
    {
      provide: CreateWallet,
      useFactory: (creator: WalletCreator) => new CreateWallet(creator),
      inject: [WALLET_CREATOR],
    },
    {
      provide: WageringQueries,
      useFactory: (readModel: WageringReadModel) => new WageringQueries(readModel),
      inject: [WAGERING_READ_MODEL],
    },
    {
      provide: ResolvePendingReferences,
      useFactory: (uow: PendingReferenceUnitOfWork) =>
        new ResolvePendingReferences(uow, {
          onError: (error, reference) =>
            pendingReferencesLogger.error(
              `failed to resolve transaction ${reference.transactionId}: ${String(error)}`,
            ),
        }),
      inject: [PENDING_REFERENCE_UNIT_OF_WORK],
    },
    {
      provide: OutboxPublisher,
      useFactory: (store: OutboxStore, publisher: EventPublisher, metrics: WageringMetrics) =>
        new OutboxPublisher(store, publisher, { metrics }),
      inject: [OUTBOX_STORE, EVENT_PUBLISHER, WAGERING_METRICS],
    },
    {
      provide: HandleWagerMessage,
      useFactory: (submit: SubmitWagerTransaction) =>
        new HandleWagerMessage(submit, { consumerName: WAGER_CONSUMER_NAME }),
      inject: [SubmitWagerTransaction],
    },
    {
      provide: WagerMessageConsumer,
      useFactory: (queue: WagerQueue, handler: WagerMessageProcessor, metrics: WageringMetrics) =>
        new WagerMessageConsumer(queue, handler, {
          onSettled: (message, disposition) => {
            if (disposition.action === 'DEAD_LETTER') {
              metrics.deadLettered(disposition.reason);
              wagerConsumerLogger.warn({
                event: 'message_dead_lettered',
                sqsMessageId: message.messageId,
                walletId: message.groupId,
                correlationId: message.correlationId,
                reason: disposition.reason,
                detail: disposition.detail,
              });
            } else if (disposition.action === 'RETRY') {
              metrics.retried('consumer');
              wagerConsumerLogger.warn({
                event: 'message_retry_scheduled',
                sqsMessageId: message.messageId,
                walletId: message.groupId,
                correlationId: message.correlationId,
                reason: disposition.reason,
                delaySeconds: disposition.visibilityTimeoutSeconds,
                delivery: message.receiveCount,
              });
            }
          },
          onError: (error, message) =>
            wagerConsumerLogger.error({
              event: 'message_settle_failed',
              sqsMessageId: message.messageId,
              walletId: message.groupId,
              error: String(error),
            }),
        }),
      inject: [WAGER_QUEUE, HandleWagerMessage, WAGERING_METRICS],
    },

    // workers em segundo plano (ligam no bootstrap, desligam no shutdown)
    PendingReferenceWorkerService,
    OutboxWorkerService,
    WagerConsumerWorkerService,

    // readiness: PostgreSQL e SQS
    PostgresReadinessCheck,
    SqsReadinessCheck,
    {
      provide: READINESS_CHECKS,
      useFactory: (postgres: PostgresReadinessCheck, sqs: SqsReadinessCheck) => [postgres, sqs],
      inject: [PostgresReadinessCheck, SqsReadinessCheck],
    },
  ],
})
export class WageringModule {}