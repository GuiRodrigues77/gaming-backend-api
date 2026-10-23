import type { LoggerService } from '@nestjs/common';

type Level = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/** Uma linha JSON por log. Objeto vira campos de primeiro nível; string vira "message". */
export class JsonLogger implements LoggerService {
  log(message: unknown, ...optional: unknown[]): void {
    this.write('info', message, optional);
  }
  error(message: unknown, ...optional: unknown[]): void {
    this.write('error', message, optional);
  }
  warn(message: unknown, ...optional: unknown[]): void {
    this.write('warn', message, optional);
  }
  debug(message: unknown, ...optional: unknown[]): void {
    this.write('debug', message, optional);
  }
  verbose(message: unknown, ...optional: unknown[]): void {
    this.write('debug', message, optional);
  }
  fatal(message: unknown, ...optional: unknown[]): void {
    this.write('fatal', message, optional);
  }

  private write(level: Level, message: unknown, optional: unknown[]): void {
    const isError = level === 'error' || level === 'fatal';
    // Nest: error(message, stack?, context?); os demais: (message, context?)
    const stack = isError && optional.length >= 2 ? optional[0] : undefined;
    const rawContext = optional.length > 0 ? optional[optional.length - 1] : undefined;
    const context = typeof rawContext === 'string' ? rawContext : undefined;

    const fields: Record<string, unknown> =
      message instanceof Error
        ? { message: message.message, errorName: message.name, stack: message.stack }
        : typeof message === 'object' && message !== null
          ? (message as Record<string, unknown>)
          : { message: String(message) };

    const line = {
      time: new Date().toISOString(),
      level,
      ...(context !== undefined ? { context } : {}),
      ...fields,
      ...(typeof stack === 'string' ? { stack } : {}),
    };
    try {
      process.stdout.write(`${JSON.stringify(line)}\n`);
    } catch {
      process.stdout.write(`${JSON.stringify({ time: line.time, level, message: 'unserializable log entry' })}\n`);
    }
  }
}