import { describe, expect, test } from 'bun:test';
import { Money } from '../domain/money/money';
import { FailureCode } from '../domain/transaction/failure-code';
import { WagerTransaction } from '../domain/transaction/wager-transaction';
import { WagerTransactionKind as Kind } from '../domain/transaction/wager-transaction-kind';
import { Wallet } from '../domain/wallet/wallet';
import { buildWagerEvents } from './wager-events';

const NOW = new Date('2026-01-01T00:00:00.000Z');
const brl = (amount: string) => Money.from({ amount, currency: 'BRL' });
let seq = 0;
const newId = () => `id-${++seq}`;

const make = (kind: Kind, reference?: string) =>
  WagerTransaction.create({
    id: newId(),
    providerId: 'provider-a',
    externalTransactionId: `ext-${seq}`,
    idempotencyKey: `key-${seq}`,
    payloadHash: 'h',
    walletId: 'wallet-1',
    playerId: 'player-1',
    roundId: 'round-1',
    gameId: 'game-1',
    kind,
    money: brl('25.00'),
    referenceExternalTransactionId: reference,
    createdAt: NOW,
  });

const openWallet = () =>
  Wallet.open({
    id: 'wallet-1',
    playerId: 'player-1',
    initialBalance: brl('100.00'),
    openingTransactionId: 'tx-open',
    openingLedgerEntryId: 'entry-open',
    now: NOW,
  }).wallet;

const types = (events: Array<{ eventType: string }>) => events.map((e) => e.eventType);

describe('buildWagerEvents', () => {
  test('transação que mexe no saldo: Processed + BalanceChanged, encadeados por causationId', () => {
    const wallet = openWallet();
    const tx = make(Kind.Bet);
    const entry = wallet.debit({ transactionId: tx.id, ledgerEntryId: newId(), money: tx.money, now: NOW });
    tx.markProcessed(undefined, NOW);

    const events = buildWagerEvents({
      transaction: tx, outcome: 'processed', wallet, ledgerEntry: entry,
      correlationId: 'corr-1', newId, now: NOW,
    });
    expect(types(events)).toEqual(['WagerTransactionProcessed', 'WalletBalanceChanged']);
    expect(events[1]!.causationId).toBe(events[0]!.eventId);
    expect(events.every((e) => e.correlationId === 'corr-1')).toBe(true);
    expect(events[1]!.aggregateId).toBe('wallet-1');
  });

  test('LOSS: só Processed (o saldo não mudou)', () => {
    const tx = make(Kind.Loss);
    tx.markProcessed(undefined, NOW);
    const events = buildWagerEvents({
      transaction: tx, outcome: 'processed', wallet: openWallet(), ledgerEntry: undefined,
      correlationId: 'c', newId, now: NOW,
    });
    expect(types(events)).toEqual(['WagerTransactionProcessed']);
  });

  test('rejeitada: só Rejected, com o failureCode', () => {
    const tx = make(Kind.Bet);
    tx.reject(FailureCode.InsufficientFunds);
    const events = buildWagerEvents({
      transaction: tx, outcome: 'rejected', wallet: undefined, ledgerEntry: undefined,
      correlationId: 'c', newId, now: NOW,
    });
    expect(types(events)).toEqual(['WagerTransactionRejected']);
    expect(events[0]!.data).toMatchObject({ failureCode: 'INSUFFICIENT_FUNDS' });
  });

  test('referência ausente: só PendingReference', () => {
    const tx = make(Kind.Refund, 'bet-1');
    tx.markPendingReference();
    const events = buildWagerEvents({
      transaction: tx, outcome: 'pending_reference', wallet: openWallet(), ledgerEntry: undefined,
      correlationId: 'c', newId, now: NOW,
    });
    expect(types(events)).toEqual(['WagerTransactionPendingReference']);
    expect(events[0]!.data).toMatchObject({ referenceExternalTransactionId: 'bet-1' });
  });
});