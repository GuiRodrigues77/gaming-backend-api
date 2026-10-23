import type { DeadLetterReason } from '../message-disposition';

export interface ReceivedMessage {
  /** Id da mensagem na SQS: estável entre as entregas da mesma mensagem. */
  messageId: string;
  body: string;
  /** Identifica esta entrega: usado no delete e no change visibility. */
  receiptHandle: string;
  /** ApproximateReceiveCount: 1 na primeira entrega. */
  receiveCount: number;
  /** MessageGroupId da fila FIFO (a carteira). */
  groupId: string | undefined;
  correlationId: string | undefined;
}

export interface DeadLetterInfo {
  reason: DeadLetterReason;
  detail: string;
}

export interface ReceiveOptions {
  maxMessages: number;
  waitSeconds: number;
  /** Interrompe o long polling no shutdown. */
  signal?: AbortSignal | undefined;
}

export interface WagerQueue {
  receive(options: ReceiveOptions): Promise<ReceivedMessage[]>;
  /** Remove a mensagem da fila. Só chamar depois do commit. */
  acknowledge(message: ReceivedMessage): Promise<void>;
  /** Devolve a mensagem à fila daqui a `seconds` (0 = imediatamente). */
  release(message: ReceivedMessage, seconds: number): Promise<void>;
  /** Envia para a DLQ e só então remove da fila principal. */
  deadLetter(message: ReceivedMessage, info: DeadLetterInfo): Promise<void>;
}

export const WAGER_QUEUE = Symbol('WAGER_QUEUE');