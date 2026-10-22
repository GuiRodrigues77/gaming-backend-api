import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { PollingWorker } from '../../application/polling-worker';
import { ResolvePendingReferences } from '../../application/resolve-pending-references';

const POLL_INTERVAL_MS = 1_000;

/**
 * Liga o worker junto com a aplicação e o desliga no shutdown (SIGTERM), esperando a
 * rodada em andamento terminar. Cada instância da API roda o seu; o lock por wallet
 * garante que cada transação pendente seja resolvida uma única vez.
 * WAGERING_WORKERS_ENABLED=false desliga (os testes de API usam isso).
 */
@Injectable()
export class PendingReferenceWorkerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PendingReferenceWorkerService.name);
  private worker: PollingWorker | undefined;

  constructor(@Inject(ResolvePendingReferences) private readonly resolver: ResolvePendingReferences) {}

  onApplicationBootstrap(): void {
    if (process.env.WAGERING_WORKERS_ENABLED?.trim() === 'false') {
      this.logger.log('Pending-reference worker disabled (WAGERING_WORKERS_ENABLED=false)');
      return;
    }

    this.worker = new PollingWorker(
      async () => {
        const result = await this.resolver.runOnce();
        if (result.resolved + result.rejected + result.expired > 0) {
          this.logger.log(
            `pending references: resolved=${result.resolved} rejected=${result.rejected} expired=${result.expired} still_pending=${result.stillPending}`,
          );
        }
        // Só conta como progresso o que não falhou: evita laço apertado numa transação com erro.
        return result.claimed - result.failed;
      },
      POLL_INTERVAL_MS,
      (error) => this.logger.error(`pending-reference worker error: ${String(error)}`),
    );
    this.worker.start();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.stop();
  }
}