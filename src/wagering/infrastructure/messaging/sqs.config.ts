import { SQSClient } from '@aws-sdk/client-sqs';

export interface SqsConfig {
  region: string;
  /** Definido só com emulador (MiniStack/LocalStack). Sem ele, usa a AWS real. */
  endpoint: string | undefined;
  /** Fila de saída: onde a outbox publica os eventos. */
  eventsQueueName: string;
  /** Fila de entrada: pedidos de transação (WagerTransactionRequested). */
  wagerQueueName: string;
  wagerDeadLetterQueueName: string;
}

export const SQS_CONFIG = Symbol('SQS_CONFIG');
export const SQS_CLIENT = Symbol('SQS_CLIENT');

export function loadSqsConfig(env: NodeJS.ProcessEnv = process.env): SqsConfig {
  return {
    region: env.AWS_REGION?.trim() || 'us-east-1',
    endpoint: env.SQS_ENDPOINT?.trim() || undefined,
    eventsQueueName: env.SQS_EVENTS_QUEUE_NAME?.trim() || 'wager-events.fifo',
    wagerQueueName: env.SQS_WAGER_QUEUE_NAME?.trim() || 'wager-transactions.fifo',
    wagerDeadLetterQueueName: env.SQS_WAGER_DLQ_NAME?.trim() || 'wager-transactions-dlq.fifo',
  };
}

export function createSqsClient(config: SqsConfig): SQSClient {
  return new SQSClient({
    region: config.region,
    // Credenciais fictícias só quando há emulador; na AWS vale a cadeia padrão do SDK.
    ...(config.endpoint
      ? { endpoint: config.endpoint, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } }
      : {}),
  });
}