import { EntitySchema } from '@mikro-orm/core';
import { OutboxMessageRecord } from './outbox-message.record';

export const OutboxMessageSchema = new EntitySchema<OutboxMessageRecord>({
  class: OutboxMessageRecord,
  tableName: 'outbox_messages',
  properties: {
    id: { type: 'string', columnType: 'uuid', primary: true },
    aggregateId: { type: 'string', columnType: 'text' },
    eventType: { type: 'string', columnType: 'text' },
    payload: { type: 'json', columnType: 'jsonb' },
    occurredAt: { type: 'Date', columnType: 'timestamptz' },
    attempts: { type: 'number', columnType: 'integer' },
    nextAttemptAt: { type: 'Date', columnType: 'timestamptz', nullable: true },
    publishedAt: { type: 'Date', columnType: 'timestamptz', nullable: true },
  },
});