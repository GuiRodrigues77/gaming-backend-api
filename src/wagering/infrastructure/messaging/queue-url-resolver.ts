import { GetQueueUrlCommand, type SQSClient } from '@aws-sdk/client-sqs';

/** Resolve a URL da fila pelo nome, uma única vez, sem guardar falhas em cache. */
export class QueueUrlResolver {
  private url: Promise<string> | undefined;

  constructor(
    private readonly client: SQSClient,
    private readonly queueName: string,
  ) {}

  resolve(): Promise<string> {
    this.url ??= this.client
      .send(new GetQueueUrlCommand({ QueueName: this.queueName }))
      .then((result) => {
        if (!result.QueueUrl) throw new Error(`SQS queue ${this.queueName} has no URL`);
        return result.QueueUrl;
      })
      .catch((error: unknown) => {
        this.url = undefined;
        throw error;
      });
    return this.url;
  }
}