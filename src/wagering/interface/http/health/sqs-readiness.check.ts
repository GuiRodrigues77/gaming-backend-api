import { SQSClient, GetQueueUrlCommand } from '@aws-sdk/client-sqs';
import { Inject, Injectable } from '@nestjs/common';
import { SQS_CLIENT, SQS_CONFIG, type SqsConfig } from '../../../infrastructure/messaging/sqs.config';
import type { ReadinessCheck } from './readiness-check';
import { withTimeout } from './with-timeout';

@Injectable()
export class SqsReadinessCheck implements ReadinessCheck {
  readonly name = 'sqs';

  constructor(
    @Inject(SQS_CLIENT) private readonly client: SQSClient,
    @Inject(SQS_CONFIG) private readonly config: SqsConfig,
  ) {}

    async check(): Promise<void> {
    const queueNames = [
      this.config.eventsQueueName,
      this.config.wagerQueueName,
      this.config.wagerDeadLetterQueueName,
    ];
    await withTimeout(
      Promise.all(
        queueNames.map((QueueName) => this.client.send(new GetQueueUrlCommand({ QueueName }))),
      ),
      2_000,
      'sqs',
    );
  }
}