import { ArgumentsHost, Catch, ExceptionFilter, Injectable, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { mapError } from './error-mapper';

/** Converte qualquer erro no formato único { statusCode, error, message, details? }. */
@Injectable()
@Catch()
export class WageringExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(WageringExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const mapped = mapError(exception);

    if (mapped.statusCode >= 500) {
      this.logger.error(
        `${mapped.body.error}: ${exception instanceof Error ? exception.message : String(exception)}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    const response = host.switchToHttp().getResponse<Response>();
    if (mapped.retryAfterSeconds !== undefined) {
      response.setHeader('Retry-After', String(mapped.retryAfterSeconds));
    }
    response.status(mapped.statusCode).json(mapped.body);
  }
}