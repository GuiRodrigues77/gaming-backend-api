import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { PollingWorker } from '../../application/polling-worker';
import { WagerMessageConsumer } from '../../application/wager-message-consumer';

const POLL_INTERVAL_MS = 500;
const ERROR_LOG_INTERVAL_MS = 10_000;

/**
 * Cada instância da API consome a fila. A FIFO entrega uma carteira a um consumidor por vez,
 * e o inbox + o lock da wallet garantem a correção mesmo se uma mensagem for entregue de novo.
 * WAGERING_WORKERS_ENABLED=false desliga (os testes de API usam isso).
 */
@Injectable()
export class WagerConsumerWorkerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(WagerConsumerWorkerService.name);
  private worker: PollingWorker | undefined;
  private lastErrorLogAt = 0;

  constructor(@Inject(WagerMessageConsumer) private readonly consumer: WagerMessageConsumer) {}

  onApplicationBootstrap(): void {
    if (process.env.WAGERING_WORKERS_ENABLED?.trim() === 'false') {
      this.logger.log('Wager consumer disabled (WAGERING_WORKERS_ENABLED=false)');
      return;
    }
    this.worker = new PollingWorker(
      () => this.consumer.runOnce(),
      POLL_INTERVAL_MS,
      (error) => this.logThrottled(error),
    );
    this.worker.start();
  }

  async onApplicationShutdown(): Promise<void> {
    this.consumer.stop(); // aborta o long polling e devolve o que não começou
    await this.worker?.stop(); // espera a mensagem em andamento concluir
  }

  /** SQS fora do ar não pode inundar o log. */
  private logThrottled(error: unknown): void {
    const now = Date.now();
    if (now - this.lastErrorLogAt < ERROR_LOG_INTERVAL_MS) return;
    this.lastErrorLogAt = now;
    this.logger.error(`wager consumer error: ${String(error)}`);
  }
}