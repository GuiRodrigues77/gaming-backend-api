import type { EventPublisher } from './ports/event-publisher.port';
import type { OutboxStore } from './ports/outbox-store.port';

export interface OutboxPublisherOptions {
  batchSize?: number;
  now?: () => Date;
}

export interface OutboxPublishResult {
  /** Mensagens travadas neste lote. */
  claimed: number;
  published: number;
  /** Falhas: ficam pendentes e voltam depois, com backoff. */
  failed: number;
}

export class OutboxPublisher {
  private readonly batchSize: number;
  private readonly now: () => Date;

  constructor(
    private readonly store: OutboxStore,
    private readonly publisher: EventPublisher,
    options: OutboxPublisherOptions = {},
  ) {
    this.batchSize = options.batchSize ?? 20;
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Garantia: pelo menos uma vez. Se o processo morrer depois de publicar e antes
   * do commit, outra instância publica de novo; por isso o consumidor deduplica
   * pelo eventId (inbox).
   */
  async publishDue(): Promise<OutboxPublishResult> {
    return this.store.withDueBatch(this.batchSize, this.now(), async (batch) => {
      let published = 0;
      let failed = 0;
      for (const message of batch.messages) {
        try {
          await this.publisher.publish(message.toEnvelope());
          message.markPublished(this.now());
          published += 1;
        } catch {
          message.scheduleRetry(this.now());
          failed += 1;
        }
        batch.save(message);
      }
      return { claimed: batch.messages.length, published, failed };
    });
  }
}