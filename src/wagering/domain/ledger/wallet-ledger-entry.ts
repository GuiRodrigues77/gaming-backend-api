import { Money } from '../money/money';
import { LedgerDirection } from './ledger-direction';
import { InvalidLedgerEntryError } from './ledger.errors';

export interface LedgerEntryState {
  id: string;
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: Money;
  balanceBefore: Money;
  balanceAfter: Money;
  createdAt: Date;
}

export type CreateLedgerEntryProps = LedgerEntryState;

/** Imutável: só campos readonly e nenhum método de transição. */
export class WalletLedgerEntry {
  private constructor(
    public readonly id: string,
    public readonly walletId: string,
    public readonly transactionId: string,
    public readonly direction: LedgerDirection,
    public readonly money: Money,
    public readonly balanceBefore: Money,
    public readonly balanceAfter: Money,
    public readonly createdAt: Date,
  ) {}

  /** Valida a aritmética do lançamento: before ± money === after. */
  static create(props: CreateLedgerEntryProps): WalletLedgerEntry {
    for (const [name, value] of Object.entries({
      id: props.id,
      walletId: props.walletId,
      transactionId: props.transactionId,
    })) {
      if (typeof value !== 'string' || value.trim() === '') {
        throw new InvalidLedgerEntryError(`${name} must be a non-empty string`);
      }
    }
    const { money, balanceBefore, balanceAfter } = props;

    if (
      money.currency !== balanceBefore.currency ||
      money.currency !== balanceAfter.currency
    ) {
      throw new InvalidLedgerEntryError('money and balances must share the same currency');
    }
    if (!money.isPositive()) {
      throw new InvalidLedgerEntryError('ledger entry money must be positive');
    }
    if (balanceBefore.isNegative() || balanceAfter.isNegative()) {
      throw new InvalidLedgerEntryError('balances must not be negative');
    }

    const entry = WalletLedgerEntry.rehydrate(props);
    if (!entry.isBalanced()) {
      throw new InvalidLedgerEntryError('balanceBefore ± money must equal balanceAfter');
    }
    return entry;
  }

  /** Reconstrução a partir da persistência: não revalida. */
  static rehydrate(state: LedgerEntryState): WalletLedgerEntry {
    return new WalletLedgerEntry(
      state.id,
      state.walletId,
      state.transactionId,
      state.direction,
      state.money,
      state.balanceBefore,
      state.balanceAfter,
      state.createdAt,
    );
  }

  isBalanced(): boolean {
    const expected =
      this.direction === LedgerDirection.Credit
        ? this.balanceBefore.add(this.money)
        : this.balanceBefore.subtract(this.money);
    return expected.equals(this.balanceAfter);
  }
}