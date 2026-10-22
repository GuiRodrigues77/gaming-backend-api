import type { OutboxMessage } from '../../domain/outbox/outbox-message';

export interface OutboxBatch {
  readonly messages: OutboxMessage[];
  /** Marca a mensagem (já alterada no domínio) para ser gravada no commit do lote. */
  save(message: OutboxMessage): void;
}

export interface OutboxStore {
  /**
   * Abre uma transação SQL, trava as mensagens elegíveis com
   * FOR UPDATE SKIP LOCKED (outros publishers pulam as travadas) e entrega o lote.
   * Se o `work` lançar erro (ou o processo morrer), a transação é desfeita
   * e as mensagens voltam a ficar disponíveis.
   */
  withDueBatch<T>(limit: number, now: Date, work: (batch: OutboxBatch) => Promise<T>): Promise<T>;
}

export const OUTBOX_STORE = Symbol('OUTBOX_STORE');