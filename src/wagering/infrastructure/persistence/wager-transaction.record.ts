export class WagerTransactionRecord {
  id!: string;
  providerId!: string;
  externalTransactionId!: string;
  idempotencyKey!: string;
  payloadHash!: string;
  walletId!: string;
  playerId!: string;
  roundId!: string;
  gameId!: string;
  kind!: string;
  status!: string;
  amount!: string;
  currency!: string;
  referenceExternalTransactionId!: string | null;
  referenceTransactionId!: string | null;
  failureCode!: string | null;
  /** Só persistência: controle do worker de PENDING_REFERENCE (não faz parte do domínio). */
  referenceAttempts!: number;
  nextAttemptAt!: Date | null;
    /** Saldo da wallet logo após a decisão. Só persistência (resposta de replay). */
  observedBalance!: string | null;
  createdAt!: Date;
  processedAt!: Date | null;
}