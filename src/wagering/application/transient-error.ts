const TRANSIENT_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE',
  '57P01', '57P02', '57P03', // banco desligando/reiniciando
  '53300', // too many connections
  '08000', '08001', '08003', '08004', '08006', // problemas de conexão
  '40001', '40P01', // serialização e deadlock
]);
const TRANSIENT_MESSAGE = /connection (terminated|refused|reset)|timeout|too many clients/i;

/** Falha de infraestrutura que deve ser retentada (HTTP: 503; fila: retry com backoff). */
export function isTransientDatabaseError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && typeof current === 'object' && current !== null; depth += 1) {
    const { code, message, cause } = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (typeof code === 'string' && TRANSIENT_CODES.has(code)) return true;
    if (typeof message === 'string' && TRANSIENT_MESSAGE.test(message)) return true;
    current = cause;
  }
  return false;
}
export type DatabaseLockConflict = 'deadlock' | 'serialization_failure' | 'lock_not_available';

/** Contenção de lock vinda do PostgreSQL (procura também na cadeia de causas). */
export function databaseLockConflictType(error: unknown): DatabaseLockConflict | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && typeof current === 'object' && current !== null; depth += 1) {
    const { code, cause } = current as { code?: unknown; cause?: unknown };
    if (code === '40P01') return 'deadlock';
    if (code === '40001') return 'serialization_failure';
    if (code === '55P03') return 'lock_not_available';
    current = cause;
  }
  return undefined;
}