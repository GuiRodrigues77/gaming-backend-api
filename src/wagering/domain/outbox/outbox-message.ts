import type { IntegrationEvent } from '../events/integration-event';

/** O que o publisher recebe: sem detalhes de persistência. */
export interface OutboxEnvelope {
  eventId: string;
  eventType: string;
  aggregateId: string;
  payload: Readonly<Record<string, unknown>>;
}

export interface OutboxMessageState {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: Readonly<Record<string, unknown>>;
  occurredAt: Date;
  attempts: number;
  nextAttemptAt?: Date | undefined;
  publishedAt?: Date | undefined;
}

export class OutboxAlreadyPublishedError extends Error {
  constructor(id: string) {
    super(`Outbox message ${id} was already published`);
    this.name = 'OutboxAlreadyPublishedError';
  }
}

const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 60_000;

/** Backoff exponencial: 1s, 2s, 4s... limitado a 60s. */
export function retryDelayMs(attempts: number): number {
  return Math.min(BASE_DELAY_MS * 2 ** Math.min(attempts - 1, 20), MAX_DELAY_MS);
}

export class OutboxMessage {
  private constructor(
    public readonly id: string,
    public readonly aggregateId: string,
    public readonly eventType: string,
    public readonly payload: Readonly<Record<string, unknown>>,
    public readonly occurredAt: Date,
    private _attempts: number,
    private _nextAttemptAt: Date | undefined,
    private _publishedAt: Date | undefined,
  ) {}

  /** O id da mensagem é o eventId: é o que o consumidor usa para deduplicar. */
  static enqueue(event: IntegrationEvent<unknown>): OutboxMessage {
    return new OutboxMessage(
      event.eventId,
      event.aggregateId,
      event.eventType,
      event.toJSON() as unknown as Record<string, unknown>,
      event.occurredAt,
      0,
      undefined,
      undefined,
    );
  }

  static rehydrate(state: OutboxMessageState): OutboxMessage {
    return new OutboxMessage(
      state.id,
      state.aggregateId,
      state.eventType,
      state.payload,
      state.occurredAt,
      state.attempts,
      state.nextAttemptAt,
      state.publishedAt,
    );
  }

  get attempts(): number {
    return this._attempts;
  }

  get nextAttemptAt(): Date | undefined {
    return this._nextAttemptAt;
  }

  get publishedAt(): Date | undefined {
    return this._publishedAt;
  }

  isPending(): boolean {
    return this._publishedAt === undefined;
  }

  isDue(now: Date): boolean {
    return (
      this.isPending() &&
      (this._nextAttemptAt === undefined || this._nextAttemptAt.getTime() <= now.getTime())
    );
  }

  markPublished(at: Date): void {
    if (!this.isPending()) throw new OutboxAlreadyPublishedError(this.id);
    this._publishedAt = at;
    this._nextAttemptAt = undefined;
  }

  /** Incrementa attempts e agenda a próxima tentativa com backoff. */
  scheduleRetry(now: Date): void {
    if (!this.isPending()) throw new OutboxAlreadyPublishedError(this.id);
    this._attempts += 1;
    this._nextAttemptAt = new Date(now.getTime() + retryDelayMs(this._attempts));
  }

  toEnvelope(): OutboxEnvelope {
    return {
      eventId: this.id,
      eventType: this.eventType,
      aggregateId: this.aggregateId,
      payload: this.payload,
    };
  }
}