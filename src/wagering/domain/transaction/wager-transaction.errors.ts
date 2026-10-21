import type { WagerTransactionStatus } from './wager-transaction-status';

/** Erro de programação: tentativa de transição inválida/saindo de estado terminal. */
export class InvalidTransactionStateError extends Error {
  constructor(
    public readonly from: WagerTransactionStatus,
    public readonly to: WagerTransactionStatus,
  ) {
    super(`Invalid transaction state transition: ${from} -> ${to}`);
    this.name = 'InvalidTransactionStateError';
  }
}

/** Payload/combinação de campos inválida na criação. */
export class InvalidWagerTransactionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidWagerTransactionError';
  }
}