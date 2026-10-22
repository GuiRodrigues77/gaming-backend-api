/**
 * Laço de polling genérico. `task` devolve quanto trabalho fez: se foi mais que zero,
 * roda de novo sem esperar. stop() espera a execução em andamento terminar (shutdown limpo).
 */
export class PollingWorker {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight: Promise<void> = Promise.resolve();
  private stopped = true;

  constructor(
    private readonly task: () => Promise<number>,
    private readonly intervalMs: number,
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
      const done = await this.task();
      if (done > 0) nextDelay = 0; // havia trabalho: já tenta o próximo lote
    } catch (error) {
      this.onError(error);
    }
    this.schedule(nextDelay);
  }
}