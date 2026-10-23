import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { METRICS_RENDERER, type MetricsRenderer } from '../../application/ports/wagering-metrics.port';

/** Sem autenticação, como os health checks: é lido pelo coletor de métricas. */
@Controller('metrics')
export class MetricsController {
  constructor(@Inject(METRICS_RENDERER) private readonly renderer: MetricsRenderer) {}

  @Get()
  async scrape(@Res({ passthrough: true }) response: Response): Promise<string> {
    response.type(this.renderer.contentType);
    return this.renderer.render();
  }
}