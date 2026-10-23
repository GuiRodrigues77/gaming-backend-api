import { GetQueueUrlCommand, SendMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';
import type { EventPublisher } from '../../application/ports/event-publisher.port';
import type { OutboxEnvelope } from '../../domain/outbox/outbox-message';

function readString(source: unknown, ...path: string[]): string | undefined {
  let current: unknown = source;
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === 'string' && current.length > 0 ? current : undefined;
}

export class SqsEventPublisher implements EventPublisher {
  private queueUrl: Promise<string> | undefined;

  constructor(
    private readonly client: SQSClient,
    private readonly queueName: string,
  ) {}

  /** Falhas sobem como exceção: o OutboxPublisher já agenda o retry com backoff. */
  async publish(event: OutboxEnvelope): Promise<void> {
    const queueUrl = await this.resolveQueueUrl();
    const correlationId = readString(event.payload, 'correlationId');

    await this.client.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(event.payload),
        MessageGroupId: readString(event.payload, 'data', 'walletId') ?? event.aggregateId,
        MessageDeduplicationId: event.eventId,
        MessageAttributes: {
          eventType: { DataType: 'String', StringValue: event.eventType },
          ...(correlationId
            ? { correlationId: { DataType: 'String', StringValue: correlationId } }
            : {}),
        },
      }),
    );
  }

  private resolveQueueUrl(): Promise<string> {
    this.queueUrl ??= this.client
      .send(new GetQueueUrlCommand({ QueueName: this.queueName }))
      .then((result) => {
        if (!result.QueueUrl) throw new Error(`SQS queue ${this.queueName} has no URL`);
        return result.QueueUrl;
      })
      .catch((error: unknown) => {
        this.queueUrl = undefined; // não guarda falha em cache
        throw error;
      });
    return this.queueUrl;
  }
}