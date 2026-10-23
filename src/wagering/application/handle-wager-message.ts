import { DEFAULT_MAX_ATTEMPTS, classifyFailure, type MessageDisposition } from './message-disposition';
import type {
  SubmitWagerTransactionCommand,
  SubmitWagerTransactionResult,
} from './submit-wager-transaction';
import { parseWagerMessage } from './wager-message';

/** O SubmitWagerTransaction satisfaz esta interface: é o mesmo use case da API HTTP. */
export interface WagerMessageSubmitter {
  execute(command: SubmitWagerTransactionCommand): Promise<SubmitWagerTransactionResult>;
}

export interface HandleWagerMessageOptions {
  consumerName: string;
  maxAttempts?: number;
}

export interface WagerMessageContext {
  /** ApproximateReceiveCount da SQS (1 na primeira entrega). */
  receiveCount: number;
  correlationId?: string | undefined;
}

export class HandleWagerMessage {
  private readonly consumerName: string;
  private readonly maxAttempts: number;

  constructor(
    private readonly submitter: WagerMessageSubmitter,
    options: HandleWagerMessageOptions,
  ) {
    this.consumerName = options.consumerName;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  }

  /** Nunca lança: devolve o que fazer com a mensagem. O ack só acontece depois do commit. */
  async handle(body: string, context: WagerMessageContext): Promise<MessageDisposition> {
    try {
      const parsed = parseWagerMessage(body, {
        consumerName: this.consumerName,
        correlationId: context.correlationId,
      });
      const result = await this.submitter.execute(parsed.command);
      return {
        action: 'ACK',
        transactionId: result.transactionId,
        status: result.status,
        idempotentReplay: result.idempotentReplay,
      };
    } catch (error) {
      return classifyFailure(error, context.receiveCount, this.maxAttempts);
    }
  }
}