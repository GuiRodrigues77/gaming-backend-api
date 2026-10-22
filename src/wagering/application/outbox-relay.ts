import type { OutboxPublisher } from './outbox-publisher';

/** Laço de polling. stop() espera o lote em andamento terminar (shutdown limpo). */
export class OutboxRelay {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight: Promise<void> = Promise.resolve();
  private stopped = true;

  constructor(
    private readonly publisher: OutboxPublisher,
    private readonly intervalMs = 500,
    private readonly onError: (error: unknown) => void = () => undefined,
  ) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.inFlight;
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.inFlight = this.tick();
    }, delayMs);
  }

  private async tick(): Promise<void> {
    let nextDelay = this.intervalMs;
    try {
      const result = await this.publisher.publishDue();
      if (result.claimed > 0) nextDelay = 0; // havia trabalho: já pega o próximo lote
    } catch (error) {
      this.onError(error);
    }
    this.schedule(nextDelay);
  }
}