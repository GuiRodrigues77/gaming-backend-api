import { describe, expect, test } from 'bun:test';
import { Money } from './money';
import { CurrencyMismatchError, InvalidMoneyError } from './money.errors';

const brl = (amount: string) => Money.from({ amount, currency: 'BRL' });
const usd = (amount: string) => Money.from({ amount, currency: 'USD' });

describe('Money.from', () => {
  test('normaliza para escala fixa de 2 casas', () => {
    expect(brl('25').amount).toBe('25.00');
    expect(brl('25.5').amount).toBe('25.50');
    expect(brl('25.00').amount).toBe('25.00');
    expect(brl('0').amount).toBe('0.00');
  });

  test.each([
    '', ' ', 'NaN', 'Infinity', '-Infinity', '1e3', '1E3', '25.001',
    '25.', '.5', 'abc', '+5.00', '1,000.00', '0x10', ' 25.00', '25.00 ',
  ])('rejeita amount inválido: "%s"', (amount) => {
    expect(() => brl(amount)).toThrow(InvalidMoneyError);
  });

  test('rejeita valores negativos na entrada (inclusive -0.00)', () => {
    expect(() => brl('-1.00')).toThrow(InvalidMoneyError);
    expect(() => brl('-0.00')).toThrow(InvalidMoneyError);
  });

  test('rejeita amount que não é string', () => {
    expect(() => Money.from({ amount: 25 as unknown as string, currency: 'BRL' })).toThrow(
      InvalidMoneyError,
    );
  });

  test.each(['', 'br', 'brl', 'BRLL', 'B1L'])('rejeita currency inválida: "%s"', (currency) => {
    expect(() => Money.from({ amount: '1.00', currency })).toThrow(InvalidMoneyError);
  });
});

describe('Money aritmética', () => {
  test('soma decimal exata (0.10 + 0.20 = 0.30)', () => {
    expect(brl('0.10').add(brl('0.20')).amount).toBe('0.30');
  });

  test('subtração pode resultar em negativo', () => {
    const result = brl('10.00').subtract(brl('25.00'));
    expect(result.amount).toBe('-15.00');
    expect(result.isNegative()).toBe(true);
  });

  test('negate inverte o sinal e zero permanece 0.00', () => {
    expect(brl('5.00').negate().amount).toBe('-5.00');
    expect(Money.zero('BRL').negate().amount).toBe('0.00');
    expect(brl('5.00').subtract(brl('5.00')).amount).toBe('0.00');
  });

  test('é imutável: operações retornam nova instância', () => {
    const a = brl('10.00');
    const b = a.add(brl('5.00'));
    expect(a.amount).toBe('10.00');
    expect(b.amount).toBe('15.00');
    expect(b).not.toBe(a);
  });

  test('não perde precisão com valores grandes', () => {
    expect(brl('99999999999999.99').add(brl('0.01')).amount).toBe('100000000000000.00');
  });
});

describe('Money predicados', () => {
  test('isZero / isPositive / isNegative', () => {
    expect(Money.zero('BRL').isZero()).toBe(true);
    expect(Money.zero('BRL').isPositive()).toBe(false);
    expect(brl('0.01').isPositive()).toBe(true);
    expect(brl('1.00').negate().isNegative()).toBe(true);
  });

  test('isLessThan', () => {
    expect(brl('10.00').isLessThan(brl('10.01'))).toBe(true);
    expect(brl('10.00').isLessThan(brl('10.00'))).toBe(false);
  });

  test('equals compara valor e moeda', () => {
    expect(brl('10').equals(brl('10.00'))).toBe(true);
    expect(brl('10.00').equals(brl('10.01'))).toBe(false);
    expect(brl('10.00').equals(usd('10.00'))).toBe(false);
  });
});

describe('Money conflito de moeda', () => {
  test('add, subtract e isLessThan lançam erro de domínio', () => {
    expect(() => brl('1.00').add(usd('1.00'))).toThrow(CurrencyMismatchError);
    expect(() => brl('1.00').subtract(usd('1.00'))).toThrow(CurrencyMismatchError);
    expect(() => brl('1.00').isLessThan(usd('1.00'))).toThrow(CurrencyMismatchError);
  });
});

describe('Money serialização', () => {
  test('toJSON gera MoneyProps com string decimal', () => {
    expect(brl('25').toJSON()).toEqual({ amount: '25.00', currency: 'BRL' });
    expect(JSON.stringify({ money: brl('25') })).toBe(
      '{"money":{"amount":"25.00","currency":"BRL"}}',
    );
  });

  test('toString', () => {
    expect(brl('25').toString()).toBe('25.00 BRL');
  });

  test('round-trip toJSON -> from', () => {
    const original = brl('123.45');
    expect(Money.from(original.toJSON()).equals(original)).toBe(true);
  });
});