import { EntityManager, LockMode } from '@mikro-orm/core';
import { Inject, Injectable } from '@nestjs/common';
import type { OutboxBatch, OutboxStore } from '../../application/ports/outbox-store.port';
import { OutboxMessageMapper } from './mappers/outbox-message.mapper';
import { OutboxMessageRecord } from './outbox-message.record';

@Injectable()
export class MikroOrmOutboxStore implements OutboxStore {
  constructor(@Inject(EntityManager) private readonly em: EntityManager) {}

  async withDueBatch<T>(
    limit: number,
    now: Date,
    work: (batch: OutboxBatch) => Promise<T>,
  ): Promise<T> {
    return this.em.fork().transactional(async (em) => {
      // SELECT ... FOR UPDATE SKIP LOCKED: dois publishers nunca pegam a mesma linha.
      const records = await em.find(
        OutboxMessageRecord,
        {
          publishedAt: null,
          $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }],
        },
        {
          orderBy: { occurredAt: 'asc', id: 'asc' },
          limit,
          lockMode: LockMode.PESSIMISTIC_PARTIAL_WRITE,
        },
      );

      const byId = new Map(records.map((record) => [record.id, record]));
      return work({
        messages: records.map((record) => OutboxMessageMapper.toDomain(record)),
        save: (message) => {
          const record = byId.get(message.id);
          if (record === undefined) {
            throw new Error(`outbox message ${message.id} is not part of this batch`);
          }
          OutboxMessageMapper.applyToRecord(message, record); // UPDATE no commit do lote
        },
      });
    });
  }
}