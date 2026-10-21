import { describe, expect, test } from 'bun:test';
import { LedgerDirection } from '../ledger/ledger-direction';
import type { WalletLedgerEntry } from '../ledger/wallet-ledger-entry';
import { Money } from '../money/money';
import { CurrencyMismatchError } from '../money/money.errors';
import { Wallet } from './wallet';
import { InsufficientFundsError, InvalidWalletOperationError } from './wallet.errors';

const brl = (amount: string) => Money.from({ amount, currency: 'BRL' });
const NOW = new Date('2026-01-01T00:00:00.000Z');

let seq = 0;
const move = (amount: string, currency = 'BRL') => ({
  transactionId: `tx-${++seq}`,
  ledgerEntryId: `entry-${seq}`,
  money: Money.from({ amount, currency }),
  now: NOW,
});

const openWallet = (initial = '100.00') =>
  Wallet.open({
    id: 'wallet-1',
    playerId: 'player-1',
    initialBalance: brl(initial),
    openingTransactionId: 'tx-opening',
    openingLedgerEntryId: 'entry-opening',
    now: NOW,
  });

describe('Wallet.open', () => {
  test('abre com saldo, version 1 e lançamento CREDIT de abertura', () => {
    const { wallet, openingEntry } = openWallet('1000.00');
    expect(wallet.balance.amount).toBe('1000.00');
    expect(wallet.version).toBe(1);
    expect(wallet.currency).toBe('BRL');
    expect(openingEntry?.direction).toBe(LedgerDirection.Credit);
    expect(openingEntry?.balanceBefore.amount).toBe('0.00');
    expect(openingEntry?.balanceAfter.amount).toBe('1000.00');
  });

  test('saldo inicial zero não gera lançamento', () => {
    const { wallet, openingEntry } = openWallet('0.00');
    expect(openingEntry).toBeUndefined();
    expect(wallet.version).toBe(1);
  });

  test('rejeita saldo inicial negativo', () => {
    expect(() =>
      Wallet.open({
        id: 'w',
        playerId: 'p',
        initialBalance: brl('1.00').negate(),
        openingTransactionId: 't',
        openingLedgerEntryId: 'e',
        now: NOW,
      }),
    ).toThrow(InvalidWalletOperationError);
  });
});

describe('Wallet.debit / credit', () => {
  test('debit reduz saldo, incrementa version e devolve lançamento', () => {
    const { wallet } = openWallet();
    const entry = wallet.debit(move('25.00'));
    expect(wallet.balance.amount).toBe('75.00');
    expect(wallet.version).toBe(2);
    expect(entry.direction).toBe(LedgerDirection.Debit);
    expect(entry.balanceBefore.amount).toBe('100.00');
    expect(entry.balanceAfter.amount).toBe('75.00');
    expect(entry.walletId).toBe('wallet-1');
  });

  test('credit aumenta saldo e incrementa version', () => {
    const { wallet } = openWallet();
    const entry = wallet.credit(move('50.50'));
    expect(wallet.balance.amount).toBe('150.50');
    expect(wallet.version).toBe(2);
    expect(entry.direction).toBe(LedgerDirection.Credit);
  });

  test('permite debitar exatamente o saldo (fica 0.00)', () => {
    const { wallet } = openWallet();
    wallet.debit(move('100.00'));
    expect(wallet.balance.amount).toBe('0.00');
  });

  test('saldo insuficiente lança erro e não altera nada', () => {
    const { wallet } = openWallet();
    expect(() => wallet.debit(move('100.01'))).toThrow(InsufficientFundsError);
    expect(wallet.balance.amount).toBe('100.00');
    expect(wallet.version).toBe(1);
  });

  test('moeda diferente lança CurrencyMismatchError', () => {
    const { wallet } = openWallet();
    expect(() => wallet.debit(move('1.00', 'USD'))).toThrow(CurrencyMismatchError);
    expect(() => wallet.credit(move('1.00', 'USD'))).toThrow(CurrencyMismatchError);
    expect(wallet.version).toBe(1);
  });

  test('valor zero é rejeitado', () => {
    const { wallet } = openWallet();
    expect(() => wallet.debit({ ...move('1.00'), money: Money.zero('BRL') })).toThrow(
      InvalidWalletOperationError,
    );
  });

  test('cenário do desafio: saldo 100, duas apostas de 80 (sequencial no domínio)', () => {
    const { wallet } = openWallet('100.00');
    wallet.debit(move('80.00'));
    expect(() => wallet.debit(move('80.00'))).toThrow(InsufficientFundsError);
    expect(wallet.balance.amount).toBe('20.00');
  });
});

describe('Wallet invariante saldo == ledger', () => {
  test('saldo final é igual ao saldo reconstruído pelo ledger', () => {
    const { wallet, openingEntry } = openWallet('100.00');
    const entries: WalletLedgerEntry[] = [openingEntry!];
    entries.push(wallet.debit(move('30.00')));
    entries.push(wallet.credit(move('12.34')));
    entries.push(wallet.debit(move('0.34')));

    const rebuilt = entries.reduce(
      (acc, e) => (e.direction === LedgerDirection.Credit ? acc.add(e.money) : acc.subtract(e.money)),
      Money.zero('BRL'),
    );
    expect(wallet.balance.equals(rebuilt)).toBe(true);
    expect(wallet.version).toBe(entries.length); // 1 (abertura) + 3 movimentos
    for (const e of entries) expect(e.isBalanced()).toBe(true);
  });
});

describe('Wallet.rehydrate', () => {
  test('reconstrói estado sem gerar lançamentos', () => {
    const wallet = Wallet.rehydrate({
      id: 'w',
      playerId: 'p',
      currency: 'BRL',
      balance: brl('42.00'),
      version: 7,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(wallet.balance.amount).toBe('42.00');
    expect(wallet.version).toBe(7);
  });
});