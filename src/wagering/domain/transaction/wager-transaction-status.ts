export enum WagerTransactionStatus {
  Pending = 'PENDING',
  PendingReference = 'PENDING_REFERENCE',
  Processed = 'PROCESSED', // terminal
  Rejected = 'REJECTED', // terminal: violação de regra de negócio
  Failed = 'FAILED', // terminal: erro permanente de infraestrutura
}