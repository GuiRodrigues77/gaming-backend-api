import Decimal from 'decimal.js';
import { CurrencyMismatchError, InvalidMoneyError } from './money.errors';

export interface MoneyProps {
  amount: string; // decimal string, ex.: "25.00"
  currency: string; // ISO-4217
}

const SCALE = 2;
const AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;
const NEGATIVE_PATTERN = /^-\d+(\.\d+)?$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

// Instância isolada: não afeta a config global do decimal.js
const D = Decimal.clone({ precision: 30, rounding: Decimal.ROUND_HALF_UP });

export class Money {
  private constructor(
    private readonly value: Decimal,
    public readonly currency: string,
  ) {}

  /** Contrato de entrada: somente valores >= 0, até 2 casas decimais. */
  static from(props: MoneyProps): Money {
    if (props === null || typeof props !== 'object') {
      throw new InvalidMoneyError('Money props must be an object');
    }
    const { amount, currency } = props;
    Money.assertCurrencyCode(currency);

    if (typeof amount !== 'string') {
      throw new InvalidMoneyError('amount must be a decimal string');
    }
    if (NEGATIVE_PATTERN.test(amount)) {
      throw new InvalidMoneyError('amount must not be negative');
    }
    if (!AMOUNT_PATTERN.test(amount)) {
      throw new InvalidMoneyError(
        'amount must be a decimal string with at most 2 fraction digits',
      );
    }
    return Money.of(new D(amount), currency);
  }

  static zero(currency: string): Money {
    Money.assertCurrencyCode(currency);
    return Money.of(new D(0), currency);
  }

  /** Único ponto de criação interna: normaliza escala e elimina -0. */
  private static of(value: Decimal, currency: string): Money {
    const rounded = value.toDecimalPlaces(SCALE, D.ROUND_HALF_UP);
    return new Money(rounded.isZero() ? new D(0) : rounded, currency);
  }

  private static assertCurrencyCode(currency: unknown): asserts currency is string {
    if (typeof currency !== 'string' || !CURRENCY_PATTERN.test(currency)) {
      throw new InvalidMoneyError('currency must be a 3-letter uppercase ISO-4217 code');
    }
  }

  get amount(): string {
    return this.value.toFixed(SCALE);
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.of(this.value.plus(other.value), this.currency);
  }

  /** Pode resultar em valor negativo (usado para detectar saldo insuficiente). */
  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.of(this.value.minus(other.value), this.currency);
  }

  negate(): Money {
    return Money.of(this.value.negated(), this.currency);
  }

  isZero(): boolean {
    return this.value.isZero();
  }

  isPositive(): boolean {
    return this.value.gt(0);
  }

  isNegative(): boolean {
    return this.value.lt(0);
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.lt(other.value);
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.value.eq(other.value);
  }

  toJSON(): MoneyProps {
    return { amount: this.amount, currency: this.currency };
  }

  toString(): string {
    return `${this.amount} ${this.currency}`;
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }
}