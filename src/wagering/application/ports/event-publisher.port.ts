import type { OutboxEnvelope } from '../../domain/outbox/outbox-message';

/** Quem de fato envia ao broker. Na etapa do SQS entra a implementação real. */
export interface EventPublisher {
  publish(event: OutboxEnvelope): Promise<void>;
}

export const EVENT_PUBLISHER = Symbol('EVENT_PUBLISHER');