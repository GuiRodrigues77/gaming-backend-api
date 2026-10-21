import { EntitySchema } from '@mikro-orm/core';
import { WagerTransactionRecord } from './wager-transaction.record';

export const WagerTransactionSchema = new EntitySchema<WagerTransactionRecord>({
  class: WagerTransactionRecord,
  tableName: 'wager_transactions',
  properties: {
    id: { type: 'string', columnType: 'uuid', primary: true },
    providerId: { type: 'string', columnType: 'text' },
    externalTransactionId: { type: 'string', columnType: 'text' },
    idempotencyKey: { type: 'string', columnType: 'text' },
    payloadHash: { type: 'string', columnType: 'text' },
    walletId: { type: 'string', columnType: 'uuid' },
    playerId: { type: 'string', columnType: 'uuid' },
    roundId: { type: 'string', columnType: 'text' },
    gameId: { type: 'string', columnType: 'text' },
    kind: { type: 'string', columnType: 'text' },
    status: { type: 'string', columnType: 'text' },
    amount: { type: 'string', columnType: 'numeric(20,2)' },
    currency: { type: 'string', columnType: 'char(3)' },
    referenceExternalTransactionId: { type: 'string', columnType: 'text', nullable: true },
    referenceTransactionId: { type: 'string', columnType: 'uuid', nullable: true },
    failureCode: { type: 'string', columnType: 'text', nullable: true },
    referenceAttempts: { type: 'number', columnType: 'integer' },
    nextAttemptAt: { type: 'Date', columnType: 'timestamptz', nullable: true },
    createdAt: { type: 'Date', columnType: 'timestamptz' },
    processedAt: { type: 'Date', columnType: 'timestamptz', nullable: true },
    observedBalance: { type: 'string', columnType: 'numeric(20,2)', nullable: true },
  },
});