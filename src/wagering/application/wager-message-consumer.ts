import type { WagerMessageContext } from './handle-wager-message';
import type { MessageDisposition } from './message-disposition';
import type { ReceivedMessage, WagerQueue } from './ports/wager-queue.port';

/** O HandleWagerMessage satisfaz esta interface. */
export interface WagerMessageProcessor {
  handle(body: string, context: WagerMessageContext): Promise<MessageDisposition>;
}

export interface WagerMessageConsumerOptions {
  /** Mensagens por recebimento (máximo da SQS: 10). */
  maxMessages?: number;
  /** Long polling. */
  waitSeconds?: number;
  /** Grupos (carteiras) processados em paralelo. */
  concurrency?: number;
  onSettled?: (message: ReceivedMessage, disposition: MessageDisposition) => void;
  onError?: (error: unknown, message: ReceivedMessage) => void;
}

/** Mensagens da mesma carteira ficam juntas e em ordem; mensagens sem grupo ficam sozinhas. */
function groupByWallet(messages: ReceivedMessage[]): ReceivedMessage[][] {
  const groups = new Map<string, ReceivedMessage[]>();
  for (const message of messages) {
    const key = message.groupId ?? `solo:${message.messageId}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [message]);
    else group.push(message);
  }
  return [...groups.values()];
}

export class WagerMessageConsumer {
  private readonly abort = new AbortController();
  private readonly maxMessages: number;
  private readonly waitSeconds: number;
  private readonly concurrency: number;

  constructor(
    private readonly queue: WagerQueue,
    private readonly processor: WagerMessageProcessor,
    private readonly options: WagerMessageConsumerOptions = {},
  ) {
    this.maxMessages = options.maxMessages ?? 10;
    this.waitSeconds = options.waitSeconds ?? 5;
    this.concurrency = Math.max(options.concurrency ?? 5, 1);
  }

  /**
   * Shutdown (SIGTERM): interrompe o long polling, deixa a mensagem em andamento terminar
   * (commit + ack) e devolve à fila, sem esperar, as que ainda não começaram.
   */
  stop(): void {
    this.abort.abort();
  }

  private get stopping(): boolean {
    return this.abort.signal.aborted;
  }

  /** Uma rodada. Devolve quantas mensagens foram concluídas (ack ou DLQ). */
  async runOnce(): Promise<number> {
    if (this.stopping) return 0;
    const batch = await this.queue.receive({
      maxMessages: this.maxMessages,
      waitSeconds: this.waitSeconds,
      signal: this.abort.signal,
    });

    const pending = groupByWallet(batch);
    let completed = 0;
    const lanes = Array.from({ length: Math.min(this.concurrency, pending.length) }, async () => {
      for (let group = pending.shift(); group !== undefined; group = pending.shift()) {
        const done = await this.processGroup(group);
        completed += done; // soma depois do await: evita perder atualização entre as faixas
      }
    });
    await Promise.all(lanes);
    return completed;
  }

  /**
   * Em ordem. Se uma mensagem não for concluída (retry ou falha de fila), as seguintes da
   * mesma carteira voltam à fila na hora: a ordem FIFO do grupo se mantém.
   */
  private async processGroup(messages: ReceivedMessage[]): Promise<number> {
    let done = 0;
    for (const [index, message] of messages.entries()) {
      if (this.stopping) {
        await this.releaseAll(messages.slice(index));
        return done;
      }
      const settled = await this.processMessage(message);
      if (!settled) {
        await this.releaseAll(messages.slice(index + 1));
        return done;
      }
      done += 1;
    }
    return done;
  }

  /** true se a mensagem foi concluída (ack ou DLQ). */
  private async processMessage(message: ReceivedMessage): Promise<boolean> {
    try {
      const disposition = await this.processor.handle(message.body, {
        receiveCount: message.receiveCount,
        correlationId: message.correlationId,
      });
      switch (disposition.action) {
        case 'ACK':
          await this.queue.acknowledge(message); // depois do commit do use case
          break;
        case 'DEAD_LETTER':
          await this.queue.deadLetter(message, {
            reason: disposition.reason,
            detail: disposition.detail,
          });
          break;
        case 'RETRY':
          await this.queue.release(message, disposition.visibilityTimeoutSeconds);
          break;
      }
      this.notify(message, disposition);
      return disposition.action !== 'RETRY';
    } catch (error) {
      // O commit pode já ter acontecido: a mensagem volta depois e o inbox a trata como replay.
      this.reportError(error, message);
      return false;
    }
  }

  private async releaseAll(messages: ReceivedMessage[]): Promise<void> {
    for (const message of messages) {
      try {
        await this.queue.release(message, 0);
      } catch (error) {
        this.reportError(error, message); // melhor esforço: vence o timeout de visibilidade
      }
    }
  }

  private notify(message: ReceivedMessage, disposition: MessageDisposition): void {
    try {
      this.options.onSettled?.(message, disposition);
    } catch {
      // um listener com defeito não pode derrubar o consumer
    }
  }

  private reportError(error: unknown, message: ReceivedMessage): void {
    try {
      this.options.onError?.(error, message);
    } catch {
      // idem
    }
  }
}