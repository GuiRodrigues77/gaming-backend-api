import { describe, expect, test } from 'bun:test';
import { LedgerDirection } from '../ledger/ledger-direction';
import { Money } from '../money/money';
import { FailureCode } from './failure-code';
import {
  InvalidTransactionStateError,
  InvalidWagerTransactionError,
} from './wager-transaction.errors';
import {
  WagerTransaction,
  type CreateWagerTransactionProps,
} from './wager-transaction';
import { WagerTransactionKind as Kind } from './wager-transaction-kind';
import { WagerTransactionStatus as Status } from './wager-transaction-status';

const brl = (amount: string) => Money.from({ amount, currency: 'BRL' });
const NOW = new Date('2026-01-01T00:00:00.000Z');

const makeTx = (overrides: Partial<CreateWagerTransactionProps> = {}) =>
  WagerTransaction.create({
    id: 'tx-1',
    providerId: 'provider-a',
    externalTransactionId: 'transaction-123',
    idempotencyKey: 'provider-a:transaction-123',
    payloadHash: 'hash-1',
    walletId: 'wallet-1',
    playerId: 'player-1',
    roundId: 'round-1',
    gameId: 'game-1',
    kind: Kind.Bet,
    money: brl('25.00'),
    createdAt: NOW,
    ...overrides,
  });

const bet = (amount = '25.00') =>
  makeTx({ id: 'tx-bet', externalTransactionId: 'bet-1', kind: Kind.Bet, money: brl(amount) });
const win = (amount = '50.00') =>
  makeTx({ id: 'tx-win', externalTransactionId: 'win-1', kind: Kind.Win, money: brl(amount) });
const refund = (amount = '25.00', ref = 'bet-1') =>
  makeTx({
    id: 'tx-refund',
    externalTransactionId: 'refund-1',
    kind: Kind.Refund,
    money: brl(amount),
    referenceExternalTransactionId: ref,
  });
const rollback = (ref: string, amount: string) =>
  makeTx({
    id: 'tx-rollback',
    externalTransactionId: 'rollback-1',
    kind: Kind.Rollback,
    money: brl(amount),
    referenceExternalTransactionId: ref,
  });

describe('WagerTransaction.create', () => {
  test('nasce PENDING', () => {
    const tx = makeTx();
    expect(tx.status).toBe(Status.Pending);
    expect(tx.isTerminal()).toBe(false);
    expect(tx.failureCode).toBeUndefined();
    expect(tx.processedAt).toBeUndefined();
  });

  test('OPENING não pode ser submetido', () => {
    expect(() => makeTx({ kind: Kind.Opening })).toThrow(InvalidWagerTransactionError);
  });

  test('REFUND e ROLLBACK exigem referência', () => {
    expect(() => makeTx({ kind: Kind.Refund })).toThrow(InvalidWagerTransactionError);
    expect(() => makeTx({ kind: Kind.Rollback })).toThrow(InvalidWagerTransactionError);
  });

  test('BET não pode ter referência; WIN e LOSS podem', () => {
    expect(() => makeTx({ kind: Kind.Bet, referenceExternalTransactionId: 'x' })).toThrow(
      InvalidWagerTransactionError,
    );
    expect(() => makeTx({ kind: Kind.Win, referenceExternalTransactionId: 'bet-1' })).not.toThrow();
    expect(() => makeTx({ kind: Kind.Loss, referenceExternalTransactionId: 'bet-1' })).not.toThrow();
  });

  test('auto-referência e referência vazia são inválidas', () => {
    expect(() =>
      makeTx({ kind: Kind.Refund, referenceExternalTransactionId: 'transaction-123' }),
    ).toThrow(InvalidWagerTransactionError);
    expect(() => makeTx({ kind: Kind.Refund, referenceExternalTransactionId: ' ' })).toThrow(
      InvalidWagerTransactionError,
    );
  });

  test('valor zero: rejeitado em BET, aceito em LOSS', () => {
    expect(() => makeTx({ kind: Kind.Bet, money: Money.zero('BRL') })).toThrow(
      InvalidWagerTransactionError,
    );
    expect(() => makeTx({ kind: Kind.Loss, money: Money.zero('BRL') })).not.toThrow();
  });

  test('campos obrigatórios vazios são rejeitados', () => {
    expect(() => makeTx({ roundId: '' })).toThrow(InvalidWagerTransactionError);
    expect(() => makeTx({ payloadHash: ' ' })).toThrow(InvalidWagerTransactionError);
  });
});

describe('WagerTransaction.createOpening', () => {
  test('nasce PROCESSED, kind OPENING, provider interno', () => {
    const tx = WagerTransaction.createOpening({
      id: 'tx-open',
      walletId: 'wallet-1',
      playerId: 'player-1',
      money: brl('1000.00'),
      payloadHash: 'h',
      createdAt: NOW,
    });
    expect(tx.kind).toBe(Kind.Opening);
    expect(tx.status).toBe(Status.Processed);
    expect(tx.processedAt).toEqual(NOW);
    expect(tx.providerId).toBe('internal');
    expect(tx.ledgerDirectionFor()).toBe(LedgerDirection.Credit);
  });
});

describe('WagerTransaction transições', () => {
  test('PENDING -> PROCESSED', () => {
    const tx = makeTx();
    tx.markProcessed(undefined, NOW);
    expect(tx.status).toBe(Status.Processed);
    expect(tx.processedAt).toEqual(NOW);
    expect(tx.isTerminal()).toBe(true);
  });

  test('PENDING -> PENDING_REFERENCE -> PROCESSED com referência resolvida', () => {
    const tx = refund();
    tx.markPendingReference();
    expect(tx.status).toBe(Status.PendingReference);
    expect(tx.isTerminal()).toBe(false);
    tx.markProcessed('tx-bet', NOW);
    expect(tx.status).toBe(Status.Processed);
    expect(tx.referenceTransactionId).toBe('tx-bet');
  });

  test('REFUND/ROLLBACK não podem ser PROCESSED sem referência resolvida', () => {
    expect(() => refund().markProcessed(undefined, NOW)).toThrow(InvalidWagerTransactionError);
  });

  test('PENDING_REFERENCE -> REJECTED com ReferenceNotFound', () => {
    const tx = refund();
    tx.markPendingReference();
    tx.reject(FailureCode.ReferenceNotFound);
    expect(tx.status).toBe(Status.Rejected);
    expect(tx.failureCode).toBe(FailureCode.ReferenceNotFound);
  });

  test('PENDING_REFERENCE não volta para PENDING_REFERENCE', () => {
    const tx = refund();
    tx.markPendingReference();
    expect(() => tx.markPendingReference()).toThrow(InvalidTransactionStateError);
  });

  const reachTerminal: Array<[string, (tx: WagerTransaction) => void]> = [
    ['PROCESSED', (tx) => tx.markProcessed(undefined, NOW)],
    ['REJECTED', (tx) => tx.reject(FailureCode.InsufficientFunds)],
    ['FAILED', (tx) => tx.fail(FailureCode.InternalError)],
  ];

  test.each(reachTerminal)('%s é terminal: nenhuma transição é aceita', (_name, reach) => {
    const tx = makeTx();
    reach(tx);
    expect(tx.isTerminal()).toBe(true);
    expect(() => tx.markProcessed(undefined, NOW)).toThrow(InvalidTransactionStateError);
    expect(() => tx.markPendingReference()).toThrow(InvalidTransactionStateError);
    expect(() => tx.reject(FailureCode.InsufficientFunds)).toThrow(InvalidTransactionStateError);
    expect(() => tx.fail(FailureCode.InternalError)).toThrow(InvalidTransactionStateError);
  });
});

describe('WagerTransaction consultas', () => {
  test('matchesPayload', () => {
    const tx = makeTx({ payloadHash: 'abc' });
    expect(tx.matchesPayload('abc')).toBe(true);
    expect(tx.matchesPayload('different')).toBe(false);
  });

  test('affectsBalance: false somente para LOSS', () => {
    expect(makeTx({ kind: Kind.Loss }).affectsBalance()).toBe(false);
    expect(bet().affectsBalance()).toBe(true);
    expect(win().affectsBalance()).toBe(true);
    expect(refund().affectsBalance()).toBe(true);
  });

  test('requiresReference: true para REFUND e ROLLBACK', () => {
    expect(refund().requiresReference()).toBe(true);
    expect(rollback('bet-1', '25.00').requiresReference()).toBe(true);
    expect(bet().requiresReference()).toBe(false);
  });
});

describe('WagerTransaction.ledgerDirectionFor', () => {
  test('BET debita; WIN e REFUND creditam', () => {
    expect(bet().ledgerDirectionFor()).toBe(LedgerDirection.Debit);
    expect(win().ledgerDirectionFor()).toBe(LedgerDirection.Credit);
    expect(refund().ledgerDirectionFor()).toBe(LedgerDirection.Credit);
  });

  test('LOSS lança erro (sem lançamento)', () => {
    expect(() => makeTx({ kind: Kind.Loss }).ledgerDirectionFor()).toThrow(
      InvalidWagerTransactionError,
    );
  });

  test('ROLLBACK inverte a direção da referência', () => {
    expect(rollback('bet-1', '25.00').ledgerDirectionFor(bet())).toBe(LedgerDirection.Credit);
    expect(rollback('win-1', '50.00').ledgerDirectionFor(win())).toBe(LedgerDirection.Debit);
    expect(rollback('refund-1', '25.00').ledgerDirectionFor(refund())).toBe(LedgerDirection.Debit);
  });

  test('ROLLBACK sem referência ou de tipo inválido lança erro', () => {
    expect(() => rollback('bet-1', '25.00').ledgerDirectionFor()).toThrow(
      InvalidWagerTransactionError,
    );
    const otherRollback = rollback('bet-1', '25.00');
    expect(() => rollback('rollback-1', '25.00').ledgerDirectionFor(otherRollback)).toThrow(
      InvalidWagerTransactionError,
    );
    expect(() =>
      rollback('loss-1', '1.00').ledgerDirectionFor(makeTx({ kind: Kind.Loss })),
    ).toThrow(InvalidWagerTransactionError);
  });
});

describe('WagerTransaction.checkReference', () => {
  test('REFUND válido de uma BET', () => {
    expect(refund().checkReference(bet())).toBeUndefined();
  });

  test('REFUND só referencia BET', () => {
    expect(refund('50.00', 'win-1').checkReference(win())).toBe(FailureCode.InvalidReferenceKind);
  });

  test('ROLLBACK aceita BET, WIN e REFUND', () => {
    expect(rollback('bet-1', '25.00').checkReference(bet())).toBeUndefined();
    expect(rollback('win-1', '50.00').checkReference(win())).toBeUndefined();
    expect(rollback('refund-1', '25.00').checkReference(refund())).toBeUndefined();
  });

  test('ROLLBACK não referencia LOSS', () => {
    const loss = makeTx({ id: 'tx-loss', externalTransactionId: 'loss-1', kind: Kind.Loss });
    expect(rollback('loss-1', '25.00').checkReference(loss)).toBe(FailureCode.InvalidReferenceKind);
  });

  test('valor diferente da referência', () => {
    expect(refund('10.00').checkReference(bet('25.00'))).toBe(FailureCode.AmountMismatch);
  });

  test.each([
    ['player', { playerId: 'player-2' }],
    ['wallet', { walletId: 'wallet-2' }],
    ['round', { roundId: 'round-2' }],
    ['provider', { providerId: 'provider-b' }],
    ['moeda', { money: Money.from({ amount: '25.00', currency: 'USD' }) }],
  ] as const)('divergência de %s => ReferenceMismatch', (_name, override) => {
    const foreign = makeTx({
      id: 'tx-bet',
      externalTransactionId: 'bet-1',
      kind: Kind.Bet,
      ...override,
    });
    expect(refund().checkReference(foreign)).toBe(FailureCode.ReferenceMismatch);
  });

  test('BET não aceita referência (erro de programação)', () => {
    expect(() => bet().checkReference(bet())).toThrow(InvalidWagerTransactionError);
  });
});