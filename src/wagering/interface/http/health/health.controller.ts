import { Controller, Get, Inject, Logger, ServiceUnavailableException } from '@nestjs/common';
import { READINESS_CHECKS, type ReadinessCheck } from './readiness-check';

/** Sem autenticação, de propósito (README, seções 2 e 9). */
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(@Inject(READINESS_CHECKS) private readonly checks: ReadinessCheck[]) {}

  /** O processo está vivo (não consulta dependências). */
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  /** Dependências alcançáveis: PostgreSQL agora; o SQS entra na etapa da fila. */
  @Get('ready')
  async ready() {
    const results = await Promise.allSettled(this.checks.map((check) => check.check()));

    const checks: Record<string, 'up' | 'down'> = {};
    this.checks.forEach((check, index) => {
      const result = results[index]!;
      checks[check.name] = result.status === 'fulfilled' ? 'up' : 'down';
      if (result.status === 'rejected') {
        this.logger.warn(`Readiness check "${check.name}" failed: ${String(result.reason)}`);
      }
    });

    if (results.some((result) => result.status === 'rejected')) {
      throw new ServiceUnavailableException({ status: 'unavailable', checks });
    }
    return { status: 'ok', checks };
  }
}