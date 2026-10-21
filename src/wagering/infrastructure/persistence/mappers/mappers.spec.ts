import { describe, expect, test } from 'bun:test';
import { LedgerDirection } from '../../../domain/ledger/ledger-direction';
import { Money } from '../../../domain/money/money';
import { WagerTransaction } from '../../../domain/transaction/wager-transaction';
import { WagerTransactionKind } from '../../../domain/transaction/wager-transaction-kind';
import { WagerTransactionStatus } from '../../../domain/transaction/wager-transaction-status';
import { Wallet } from '../../../domain/wallet/wallet';
import { LedgerEntryMapper } from './ledger-entry.mapper';
import { WagerTransactionMapper } from './wager-transaction.mapper';
import { WalletMapper } from './wallet.mapper';

const brl = (amount: string) => Money.from({ amount, currency: 'BRL' });
const NOW = new Date('2026-01-01T00:00:00.000Z');

const openWallet = () =>
  Wallet.open({
    id: 'wallet-1',
    playerId: 'player-1',
    initialBalance: brl('100.00'),
    openingTransactionId: 'tx-open',
    openingLedgerEntryId: 'entry-open',
    now: NOW,
  });

describe('WalletMapper', () => {
  test('toRecord -> toDomain preserva o estado', () => {
    const { wallet } = openWallet();
    const restored = WalletMapper.toDomain(WalletMapper.toRecord(wallet));
    expect(restored.id).toBe(wallet.id);
    expect(restored.balance.equals(wallet.balance)).toBe(true);
    expect(restored.version).toBe(1);
  });

  test('applyToRecord copia saldo, version e updatedAt', () => {
    const { wallet } = openWallet();
    const record = WalletMapper.toRecord(wallet);
    const later = new Date('2026-01-02T00:00:00.000Z');
    wallet.debit({ transactionId: 't', ledgerEntryId: 'e', money: brl('30.00'), now: later });
    WalletMapper.applyToRecord(wallet, record);
    expect(record.balance).toBe('70.00');
    expect(record.version).toBe(2);
    expect(record.updatedAt).toEqual(later);
  });
});

describe('WagerTransactionMapper', () => {
  const makeBet = () =>
    WagerTransaction.create({
      id: 'tx-1',
      providerId: 'provider-a',
      externalTransactionId: 'ext-1',
      idempotencyKey: 'provider-a:ext-1',
      payloadHash: 'hash',
      walletId: 'wallet-1',
      playerId: 'player-1',
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.Bet,
      money: brl('25.00'),
      createdAt: NOW,
    });

  test('round-trip de transação PENDING (nulls viram undefined)', () => {
    const restored = WagerTransactionMapper.toDomain(WagerTransactionMapper.toRecord(makeBet()));
    expect(restored.status).toBe(WagerTransactionStatus.Pending);
    expect(restored.referenceExternalTransactionId).toBeUndefined();
    expect(restored.failureCode).toBeUndefined();
    expect(restored.processedAt).toBeUndefined();
    expect(restored.money.equals(brl('25.00'))).toBe(true);
  });

  test('applyToRecord grava a transição para PROCESSED', () => {
    const tx = makeBet();
    const record = WagerTransactionMapper.toRecord(tx);
    tx.markProcessed(undefined, NOW);
    WagerTransactionMapper.applyToRecord(tx, record);
    expect(record.status).toBe('PROCESSED');
    expect(record.processedAt).toEqual(NOW);
    expect(WagerTransactionMapper.toDomain(record).isTerminal()).toBe(true);
  });
});

describe('LedgerEntryMapper', () => {
  test('round-trip preserva lançamento e grava wallet_version', () => {
    const { wallet, openingEntry } = openWallet();
    const record = LedgerEntryMapper.toRecord(openingEntry!, wallet.version);
    expect(record.walletVersion).toBe(1);
    expect(record.direction).toBe('CREDIT');
    const restored = LedgerEntryMapper.toDomain(record);
    expect(restored.direction).toBe(LedgerDirection.Credit);
    expect(restored.isBalanced()).toBe(true);
  });
});