import { describe, expect, test } from 'bun:test';
import {
  DeleteMessageCommand,
  GetQueueUrlCommand,
  ReceiveMessageCommand,
} from '@aws-sdk/client-sqs';
import { SqsEventPublisher } from './sqs-event-publisher';
import { createSqsClient, loadSqsConfig } from './sqs.config';

describe.skipIf(process.env.SQS_INTEGRATION !== '1')('SqsEventPublisher (MiniStack real)', () => {
  test(
    'entrega o evento na fila de eventos',
    async () => {
      const config = loadSqsConfig({ SQS_ENDPOINT: 'http://localhost:4566' });
      const client = createSqsClient(config);
      const eventId = crypto.randomUUID();
      const walletId = crypto.randomUUID();

      await new SqsEventPublisher(client, config.eventsQueueName).publish({
        eventId,
        eventType: 'WalletBalanceChanged',
        aggregateId: walletId,
        payload: { eventId, correlationId: 'corr-it', data: { walletId } },
      });

      const { QueueUrl } = await client.send(
        new GetQueueUrlCommand({ QueueName: config.eventsQueueName }),
      );
      if (!QueueUrl) throw new Error('queue url missing');

      const received = await client.send(
        new ReceiveMessageCommand({
          QueueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 2,
          MessageAttributeNames: ['All'],
        }),
      );
      const ours = received.Messages?.find((message) => message.Body?.includes(eventId));
      expect(ours).toBeDefined();
      expect(ours!.MessageAttributes?.eventType?.StringValue).toBe('WalletBalanceChanged');

      await client.send(new DeleteMessageCommand({ QueueUrl, ReceiptHandle: ours!.ReceiptHandle! }));
    },
    15_000,
  );
});