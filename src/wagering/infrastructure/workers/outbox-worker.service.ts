import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { OutboxPublisher } from '../../application/outbox-publisher';
import { PollingWorker } from '../../application/polling-worker';

const POLL_INTERVAL_MS = 500;

/**
 * Cada instância da API roda o seu publisher. O FOR UPDATE SKIP LOCKED do OutboxStore
 * impede que duas instâncias peguem a mesma mensagem ao mesmo tempo.
 * WAGERING_WORKERS_ENABLED=false desliga (os testes de API usam isso).
 */
@Injectable()
export class OutboxWorkerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxWorkerService.name);
  private worker: PollingWorker | undefined;

  constructor(@Inject(OutboxPublisher) private readonly publisher: OutboxPublisher) {}

  onApplicationBootstrap(): void {
    if (process.env.WAGERING_WORKERS_ENABLED?.trim() === 'false') {
      this.logger.log('Outbox worker disabled (WAGERING_WORKERS_ENABLED=false)');
      return;
    }

    this.worker = new PollingWorker(
      async () => {
        const result = await this.publisher.publishDue();
        if (result.failed > 0) {
          this.logger.warn(
            `outbox: published=${result.published} failed=${result.failed} (retry com backoff)`,
          );
        }
        // Só conta o que foi publicado: evita laço apertado enquanto o broker estiver fora.
        return result.published;
      },
      POLL_INTERVAL_MS,
      (error) => this.logger.error(`outbox worker error: ${String(error)}`),
    );
    this.worker.start();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.stop();
  }
}