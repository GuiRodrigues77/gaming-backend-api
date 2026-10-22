import { OutboxMessage } from '../../../domain/outbox/outbox-message';
import { OutboxMessageRecord } from '../outbox-message.record';

export const OutboxMessageMapper = {
  toDomain(record: OutboxMessageRecord): OutboxMessage {
    return OutboxMessage.rehydrate({
      id: record.id,
      aggregateId: record.aggregateId,
      eventType: record.eventType,
      payload: record.payload,
      occurredAt: record.occurredAt,
      attempts: record.attempts,
      nextAttemptAt: record.nextAttemptAt ?? undefined,
      publishedAt: record.publishedAt ?? undefined,
    });
  },

  /** Mensagem nova (INSERT). */
  toRecord(message: OutboxMessage): OutboxMessageRecord {
    return Object.assign(new OutboxMessageRecord(), {
      id: message.id,
      aggregateId: message.aggregateId,
      eventType: message.eventType,
      payload: message.payload as Record<string, unknown>,
      occurredAt: message.occurredAt,
      attempts: message.attempts,
      nextAttemptAt: message.nextAttemptAt ?? null,
      publishedAt: message.publishedAt ?? null,
    });
  },

  /** Mensagem existente (UPDATE): só o que muda no ciclo de publicação. */
  applyToRecord(message: OutboxMessage, record: OutboxMessageRecord): void {
    record.attempts = message.attempts;
    record.nextAttemptAt = message.nextAttemptAt ?? null;
    record.publishedAt = message.publishedAt ?? null;
  },
};