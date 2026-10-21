import { LedgerDirection } from '../ledger/ledger-direction';
import { WalletLedgerEntry } from '../ledger/wallet-ledger-entry';
import { CurrencyMismatchError } from '../money/money.errors';
import { Money } from '../money/money';
import { InsufficientFundsError, InvalidWalletOperationError } from './wallet.errors';

export interface WalletState {
  id: string;
  playerId: string;
  currency: string;
  balance: Money; 
  version: number;  
  createdAt: Date;  
  updatedAt: Date;  
} 
  
export interface OpenWalletProps {  
  id: string;
  playerId: string;
  initialBalance: Money;
  openingTransactionId: string;
  openingLedgerEntryId: string;
  now: Date;
}

export interface OpenedWallet {
  wallet: Wallet;
  /** undefined quando o saldo inicial é zero. */
  openingEntry: WalletLedgerEntry | undefined;
}

export interface WalletMovement {
  transactionId: string;
  ledgerEntryId: string;
  money: Money;
  now: Date;
}

export class Wallet {
  public readonly id: string;
  public readonly playerId: string;
  public readonly currency: string;
  public readonly createdAt: Date;
  private _balance: Money;
  private _version: number;
  private _updatedAt: Date;

  private constructor(state: WalletState) {
    this.id = state.id;
    this.playerId = state.playerId;
    this.currency = state.currency;
    this._balance = state.balance;
    this._version = state.version;
    this.createdAt = state.createdAt;
    this._updatedAt = state.updatedAt;
  }

  static open(props: OpenWalletProps): OpenedWallet {
    if (props.id.trim() === '' || props.playerId.trim() === '') {
      throw new InvalidWalletOperationError('id and playerId must be non-empty');
    }
    if (props.initialBalance.isNegative()) {
      throw new InvalidWalletOperationError('initial balance must not be negative');
    }
    const currency = props.initialBalance.currency;
    const wallet = new Wallet({
      id: props.id,
      playerId: props.playerId,
      currency,
      balance: props.initialBalance,
      version: 1,
      createdAt: props.now,
      updatedAt: props.now,
    });

    const openingEntry = props.initialBalance.isPositive()
      ? WalletLedgerEntry.create({
          id: props.openingLedgerEntryId,
          walletId: props.id,
          transactionId: props.openingTransactionId,
          direction: LedgerDirection.Credit,
          money: props.initialBalance,
          balanceBefore: Money.zero(currency),
          balanceAfter: props.initialBalance,
          createdAt: props.now,
        })
      : undefined;

    return { wallet, openingEntry };
  }

  /** Reconstrução a partir da persistência: não revalida regras. */
  static rehydrate(state: WalletState): Wallet {
    return new Wallet(state);
  }

  get balance(): Money {
    return this._balance;
  }

  get version(): number {
    return this._version;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  /**
   * Debita e devolve o lançamento correspondente. O lançamento é criado antes
   * de qualquer mutação: se algo falhar, a wallet permanece intacta.
   * @throws InsufficientFundsError quando o saldo não cobre o valor
   */
  debit(movement: WalletMovement): WalletLedgerEntry {
    this.assertMovement(movement.money);
    const balanceAfter = this._balance.subtract(movement.money);
    if (balanceAfter.isNegative()) {
      throw new InsufficientFundsError(this._balance, movement.money);
    }
    return this.apply(LedgerDirection.Debit, movement, balanceAfter);
  }

  credit(movement: WalletMovement): WalletLedgerEntry {
    this.assertMovement(movement.money);
    return this.apply(
      LedgerDirection.Credit,
      movement,
      this._balance.add(movement.money),
    );
  }

  private apply(
    direction: LedgerDirection,
    movement: WalletMovement,
    balanceAfter: Money,
  ): WalletLedgerEntry {
    const entry = WalletLedgerEntry.create({
      id: movement.ledgerEntryId,
      walletId: this.id,
      transactionId: movement.transactionId,
      direction,
      money: movement.money,
      balanceBefore: this._balance,
      balanceAfter,
      createdAt: movement.now,
    });
    this._balance = balanceAfter;
    this._version += 1;
    this._updatedAt = movement.now;
    return entry;
  }

  private assertMovement(money: Money): void {
    this.assertSameCurrency(money);
    if (!money.isPositive()) {
      throw new InvalidWalletOperationError('movement amount must be positive');
    }
  }

  private assertSameCurrency(money: Money): void {
    if (money.currency !== this.currency) {
      throw new CurrencyMismatchError(this.currency, money.currency);
    }
  }
}