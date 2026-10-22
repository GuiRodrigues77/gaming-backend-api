export interface PendingReferencePolicy {
  /** Quantas vezes a referência é procurada antes de desistir. */
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

/**
 * Esperas: 2s, 4s, 8s, 16s, 32s e depois 60s (até a 9ª tentativa).
 * Na 10ª avaliação sem referência a transação é rejeitada: cerca de 5 minutos no total.
 */
export const DEFAULT_PENDING_REFERENCE_POLICY: PendingReferencePolicy = {
  maxAttempts: 10,
  baseDelayMs: 2_000,
  maxDelayMs: 60_000,
};

/** Espera até a próxima avaliação, depois de `attempts` tentativas sem sucesso. */
export function pendingReferenceDelayMs(
  attempts: number,
  policy: PendingReferencePolicy = DEFAULT_PENDING_REFERENCE_POLICY,
): number {
  const exponent = Math.min(Math.max(attempts - 1, 0), 20);
  return Math.min(policy.baseDelayMs * 2 ** exponent, policy.maxDelayMs);
}