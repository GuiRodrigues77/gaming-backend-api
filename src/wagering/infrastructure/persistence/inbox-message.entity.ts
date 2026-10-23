import { EntitySchema } from '@mikro-orm/core';
import { InboxMessageRecord } from './inbox-message.record';

export const InboxMessageSchema = new EntitySchema<InboxMessageRecord>({
  class: InboxMessageRecord,
  tableName: 'inbox_messages',
  properties: {
    consumerName: { type: 'string', columnType: 'text', primary: true },
    messageId: { type: 'string', columnType: 'text', primary: true },
    payloadHash: { type: 'string', columnType: 'text' },
    receivedAt: { type: 'Date', columnType: 'timestamptz' },
    processedAt: { type: 'Date', columnType: 'timestamptz', nullable: true },
  },
});