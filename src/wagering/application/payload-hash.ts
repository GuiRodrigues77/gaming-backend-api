import { createHash } from 'node:crypto';
import type { MoneyProps } from '../domain/money/money';

/**
 * Algoritmo (documentado para o ARCHITECTURE.md):
 *   SHA-256 (hex) do JSON canônico — chaves ordenadas, sem espaços, undefined omitido —
 *   do subconjunto de campos de negócio. O header Idempotency-Key e metadados de
 *   transporte NÃO entram no hash. O valor entra normalizado ("25" == "25.00").
 */
export interface PayloadHashInput {
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: string;
  money: MoneyProps;
  referenceExternalTransactionId?: string | undefined;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
  return `{${entries.join(',')}}`;
}

export function computePayloadHash(input: PayloadHashInput): string {
  const business = {
    providerId: input.providerId,
    externalTransactionId: input.externalTransactionId,
    playerId: input.playerId,
    walletId: input.walletId,
    roundId: input.roundId,
    gameId: input.gameId,
    kind: input.kind,
    money: { amount: input.money.amount, currency: input.money.currency },
    referenceExternalTransactionId: input.referenceExternalTransactionId,
  };
  return createHash('sha256').update(canonicalJson(business)).digest('hex');
}