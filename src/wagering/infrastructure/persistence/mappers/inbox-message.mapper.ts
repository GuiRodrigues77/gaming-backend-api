import { InboxMessage } from '../../../domain/inbox/inbox-message';
import { InboxMessageRecord } from '../inbox-message.record';

export const InboxMessageMapper = {
  toDomain(record: InboxMessageRecord): InboxMessage {
    return InboxMessage.rehydrate({
      messageId: record.messageId,
      consumerName: record.consumerName,
      payloadHash: record.payloadHash,
      receivedAt: record.receivedAt,
      processedAt: record.processedAt ?? undefined,
    });
  },

  /** Mensagem nova (INSERT). */
  toRecord(message: InboxMessage): InboxMessageRecord {
    return Object.assign(new InboxMessageRecord(), {
      messageId: message.messageId,
      consumerName: message.consumerName,
      payloadHash: message.payloadHash,
      receivedAt: message.receivedAt,
      processedAt: message.processedAt ?? null,
    });
  },
};