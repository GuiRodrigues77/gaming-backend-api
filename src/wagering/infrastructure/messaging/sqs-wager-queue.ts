import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import type {
  DeadLetterInfo,
  ReceivedMessage,
  ReceiveOptions,
  WagerQueue,
} from '../../application/ports/wager-queue.port';
import { QueueUrlResolver } from './queue-url-resolver';

export interface SqsWagerQueueOptions {
  queueName: string;
  deadLetterQueueName: string;
}

const stringAttribute = (value: string) => ({ DataType: 'String', StringValue: value });

export class SqsWagerQueue implements WagerQueue {
  private readonly main: QueueUrlResolver;
  private readonly deadLetterQueue: QueueUrlResolver;

  constructor(
    private readonly client: SQSClient,
    options: SqsWagerQueueOptions,
  ) {
    this.main = new QueueUrlResolver(client, options.queueName);
    this.deadLetterQueue = new QueueUrlResolver(client, options.deadLetterQueueName);
  }

  async receive({ maxMessages, waitSeconds, signal }: ReceiveOptions): Promise<ReceivedMessage[]> {
    const queueUrl = await this.main.resolve();
    try {
      const output = await this.client.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: maxMessages,
          WaitTimeSeconds: waitSeconds,
          MessageSystemAttributeNames: ['ApproximateReceiveCount', 'MessageGroupId'],
          MessageAttributeNames: ['correlationId'],
        }),
        signal === undefined ? {} : { abortSignal: signal },
      );
      return (output.Messages ?? []).flatMap((message) => {
        if (
          message.MessageId === undefined ||
          message.Body === undefined ||
          message.ReceiptHandle === undefined
        ) {
          return [];
        }
        const receiveCount = Number.parseInt(message.Attributes?.ApproximateReceiveCount ?? '1', 10);
        return [
          {
            messageId: message.MessageId,
            body: message.Body,
            receiptHandle: message.ReceiptHandle,
            receiveCount: Number.isNaN(receiveCount) ? 1 : receiveCount,
            groupId: message.Attributes?.MessageGroupId,
            correlationId: message.MessageAttributes?.correlationId?.StringValue,
          },
        ];
      });
    } catch (error) {
      if (signal?.aborted) return []; // shutdown: long poll interrompido não é falha
      throw error;
    }
  }

  async acknowledge(message: ReceivedMessage): Promise<void> {
    await this.client.send(
      new DeleteMessageCommand({
        QueueUrl: await this.main.resolve(),
        ReceiptHandle: message.receiptHandle,
      }),
    );
  }

  async release(message: ReceivedMessage, seconds: number): Promise<void> {
    await this.client.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: await this.main.resolve(),
        ReceiptHandle: message.receiptHandle,
        VisibilityTimeout: seconds,
      }),
    );
  }

  async deadLetter(message: ReceivedMessage, info: DeadLetterInfo): Promise<void> {
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: await this.deadLetterQueue.resolve(),
        MessageBody: message.body,
        MessageGroupId: message.groupId ?? 'dead-letter',
        // Mesmo id da SQS em todas as entregas: reenviar após um delete que falhou não duplica.
        MessageDeduplicationId: message.messageId,
        MessageAttributes: {
          deadLetterReason: stringAttribute(info.reason),
          deadLetterDetail: stringAttribute(info.detail),
          receiveCount: { DataType: 'Number', StringValue: String(message.receiveCount) },
          ...(message.correlationId ? { correlationId: stringAttribute(message.correlationId) } : {}),
        },
      }),
    );
    await this.acknowledge(message); // só depois de a DLQ confirmar
  }
}