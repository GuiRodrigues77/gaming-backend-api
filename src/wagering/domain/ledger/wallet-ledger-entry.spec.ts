import { describe, expect, test } from 'bun:test';
import { Money } from '../money/money';
import { LedgerDirection } from './ledger-direction';
import { InvalidLedgerEntryError } from './ledger.errors';
import { WalletLedgerEntry, type CreateLedgerEntryProps } from './wallet-ledger-entry';

const brl = (amount: string) => Money.from({ amount, currency: 'BRL' });
const NOW = new Date('2026-01-01T00:00:00.000Z');

const props = (overrides: Partial<CreateLedgerEntryProps> = {}): CreateLedgerEntryProps => ({
  id: 'entry-1',
  walletId: 'wallet-1',
  transactionId: 'tx-1',
  direction: LedgerDirection.Debit,
  money: brl('25.00'),
  balanceBefore: brl('100.00'),
  balanceAfter: brl('75.00'),
  createdAt: NOW,
  ...overrides,
});

describe('WalletLedgerEntry.create', () => {
  test('cria lançamento de débito balanceado', () => {
    const entry = WalletLedgerEntry.create(props());
    expect(entry.isBalanced()).toBe(true);
    expect(entry.direction).toBe(LedgerDirection.Debit);
  });

  test('cria lançamento de crédito balanceado', () => {
    const entry = WalletLedgerEntry.create(
      props({
        direction: LedgerDirection.Credit,
        balanceBefore: brl('75.00'),
        balanceAfter: brl('100.00'),
      }),
    );
    expect(entry.isBalanced()).toBe(true);
  });

  test('rejeita aritmética inconsistente', () => {
    expect(() => WalletLedgerEntry.create(props({ balanceAfter: brl('80.00') }))).toThrow(
      InvalidLedgerEntryError,
    );
    expect(() =>
      WalletLedgerEntry.create(props({ direction: LedgerDirection.Credit })),
    ).toThrow(InvalidLedgerEntryError);
  });

  test('rejeita moedas diferentes', () => {
    expect(() =>
      WalletLedgerEntry.create(props({ money: Money.from({ amount: '25.00', currency: 'USD' }) })),
    ).toThrow(InvalidLedgerEntryError);
  });

  test('rejeita valor zero e saldos negativos', () => {
    expect(() =>
      WalletLedgerEntry.create(props({ money: Money.zero('BRL'), balanceAfter: brl('100.00') })),
    ).toThrow(InvalidLedgerEntryError);
    expect(() =>
      WalletLedgerEntry.create(props({ balanceBefore: brl('10.00'), balanceAfter: brl('10.00').subtract(brl('25.00')) })),
    ).toThrow(InvalidLedgerEntryError);
  });

  test('rejeita ids vazios', () => {
    expect(() => WalletLedgerEntry.create(props({ id: ' ' }))).toThrow(InvalidLedgerEntryError);
  });

  test('rehydrate não revalida (isBalanced detecta corrupção)', () => {
    const corrupted = WalletLedgerEntry.rehydrate(props({ balanceAfter: brl('1.00') }));
    expect(corrupted.isBalanced()).toBe(false);
  });
});