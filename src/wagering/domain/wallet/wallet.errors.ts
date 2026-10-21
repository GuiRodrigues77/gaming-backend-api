import type { Money } from '../money/money';

export class InsufficientFundsError extends Error {
  constructor(
    public readonly balance: Money,
    public readonly requested: Money,
  ) {
    super(`Insufficient funds: balance ${balance.toString()}, requested ${requested.toString()}`);
    this.name = 'InsufficientFundsError';
  }
}

export class InvalidWalletOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidWalletOperationError';
  }
}