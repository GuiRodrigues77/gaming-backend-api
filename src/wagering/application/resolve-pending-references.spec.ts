import { describe, expect, test } from 'bun:test';
import type { WalletLedgerEntry } from '../domain/ledger/wallet-ledger-entry';
import { Money } from '../domain/money/money';
import type { OutboxMessage } from '../domain/outbox/outbox-message';
import { FailureCode } from '../domain/transaction/failure-code';
import { WagerTransaction } from '../domain/transaction/wager-transaction';
import { WagerTransactionKind as Kind } from '../domain/transaction/wager-transaction-kind';
import { WagerTransactionStatus as Status } from '../domain/transaction/wager-transaction-status';
import { Wallet } from '../domain/wallet/wallet';
import { DEFAULT_PENDING_REFERENCE_POLICY } from './pending-reference-policy';
import type {
  DuePendingReference,
  PendingReferenceScope,
  PendingReferenceUnitOfWork,
  PendingResolution,
  PendingTransaction,
} from './ports/pending-reference.port';
import type { StoredTransaction } from './ports/wagering-unit-of-work.port';
import {
  ResolvePendingReferences,
  type ResolvePendingReferencesOptions,
} from './resolve-pending-references';

const NOW = new Date('2026-01-01T00:00:00.000Z');
const brl = (amount: string) => Money.from({ amount, currency: 'BRL' });
let seq = 0;
const newId = () => `id-${++seq}`;

const REF: DuePendingReference = { transactionId: 'tx-refund', walletId: 'wallet-1' };

const base = {
  providerId: 'provider-a',
  payloadHash: 'h',
  walletId: 'wallet-1',
  playerId: 'player-1',
  roundId: 'round-1',
  gameId: 'game-1',
  createdAt: NOW,
};

const bet = () =>
  WagerTransaction.create({
    ...base,
    id: 'tx-bet',
    externalTransactionId: 'bet-1',
    idempotencyKey: 'provider-a:bet-1',
    kind: Kind.Bet,
    money: brl('25.00'),
  });

const processedBet = () => {
  const tx = bet();
  tx.markProcessed(undefined, NOW);
  return tx;
};

const pendingRefund = () => {
  const tx = WagerTransaction.create({
    ...base,
    id: 'tx-refund',
    externalTransactionId: 'refund-1',
    idempotencyKey: 'provider-a:refund-1',
    kind: Kind.Refund,
    money: brl('25.00'),
    referenceExternalTransactionId: 'bet-1',
  });
  tx.markPendingReference();
  return tx;
};

const openWallet = () =>
  Wallet.open({
    id: 'wallet-1',
    playerId: 'player-1',
    initialBalance: brl('1000.00'),
    openingTransactionId: 'tx-open',
    openingLedgerEntryId: 'entry-open',
    now: NOW,
  }).wallet;

/** Wallet de quem já apostou 25 (saldo 975, versão 2). */
const walletAfterBet = () => {
  const wallet = openWallet();
  wallet.debit({ transactionId: 'tx-bet', ledgerEntryId: 'entry-bet', money: brl('25.00'), now: NOW });
  return wallet;
};

class FakeScope implements PendingReferenceScope {
  readonly saved: Array<{ transaction: WagerTransaction; resolution: PendingResolution }> = [];
  readonly ledger: Array<{ entry: WalletLedgerEntry; walletVersion: number }> = [];
  readonly outbox: OutboxMessage[] = [];
  walletSaves = 0;
  private readonly byExternal = new Map<string, StoredTransaction>();

  constructor(
    public pending: PendingTransaction | undefined,
    public wallet: Wallet | undefined,
  ) {}

  knows(tx: WagerTransaction): this {
    this.byExternal.set(`${tx.providerId}:${tx.externalTransactionId}`, {
      transaction: tx,
      observedBalance: undefined,
    });
    return this;
  }

  async lockWallet(): Promise<Wallet | undefined> {
    return this.wallet;
  }
  async lockDuePending(): Promise<PendingTransaction | undefined> {
    return this.pending;
  }
  savePending(transaction: WagerTransaction, resolution: PendingResolution): void {
    this.saved.push({ transaction, resolution });
  }
  saveWallet(): void {
    this.walletSaves += 1;
  }
  appendLedgerEntry(entry: WalletLedgerEntry, walletVersion: number): void {
    this.ledger.push({ entry, walletVersion });
  }
  enqueueOutbox(message: OutboxMessage): void {
    this.outbox.push(message);
  }
  async findTransactionByExternalId(providerId: string, externalTransactionId: string) {
    return this.byExternal.get(`${providerId}:${externalTransactionId}`);
  }
  async findProcessedReversalOf(): Promise<WagerTransaction | undefined> {
    return undefined;
  }
}

/** Falha na primeira vez que tenta travar a wallet (simula queda de conexão). */
class FlakyScope extends FakeScope {
  private calls = 0;

  override async lockWallet(): Promise<Wallet | undefined> {
    this.calls += 1;
    if (this.calls === 1) throw new Error('connection lost');
    return super.lockWallet();
  }
}

class FakeUow implements PendingReferenceUnitOfWork {
  constructor(
    private readonly due: DuePendingReference[],
    private readonly scope: PendingReferenceScope,
  ) {}

  async listDue(limit: number): Promise<DuePendingReference[]> {
    return this.due.slice(0, limit);
  }

  async run<T>(work: (scope: PendingReferenceScope) => Promise<T>): Promise<T> {
    return work(this.scope);
  }
}

const resolver = (
  scope: PendingReferenceScope,
  due: DuePendingReference[] = [REF],
  options: ResolvePendingReferencesOptions = {},
) => new ResolvePendingReferences(new FakeUow(due, scope), { now: () => NOW, newId, ...options });

const eventTypes = (scope: FakeScope) => scope.outbox.map((message) => message.eventType);

describe('ResolvePendingReferences', () => {
  test('referência ainda ausente: conta a tentativa e agenda a próxima com backoff', async () => {
    const scope = new FakeScope({ transaction: pendingRefund(), attempts: 0 }, openWallet());
    const result = await resolver(scope).runOnce();

    expect(result).toMatchObject({ claimed: 1, stillPending: 1, failed: 0 });
    const saved = scope.saved[0]!;
    expect(saved.resolution.attempts).toBe(1);
    expect(saved.resolution.nextAttemptAt).toEqual(new Date(NOW.getTime() + 2_000));
    expect(saved.transaction.status).toBe(Status.PendingReference);
    expect(scope.outbox).toHaveLength(0);
    expect(scope.ledger).toHaveLength(0);
  });

  test('o backoff cresce com as tentativas', async () => {
    const scope = new FakeScope({ transaction: pendingRefund(), attempts: 2 }, openWallet());
    await resolver(scope).runOnce();
    expect(scope.saved[0]!.resolution.attempts).toBe(3);
    expect(scope.saved[0]!.resolution.nextAttemptAt).toEqual(new Date(NOW.getTime() + 8_000));
  });

  test('esgotou as tentativas: REJECTED/REFERENCE_NOT_FOUND e evento Rejected', async () => {
    const wallet = openWallet();
    const scope = new FakeScope(
      { transaction: pendingRefund(), attempts: DEFAULT_PENDING_REFERENCE_POLICY.maxAttempts - 1 },
      wallet,
    );
    const result = await resolver(scope).runOnce();

    expect(result).toMatchObject({ expired: 1, stillPending: 0 });
    const saved = scope.saved[0]!;
    expect(saved.transaction.status).toBe(Status.Rejected);
    expect(saved.transaction.failureCode).toBe(FailureCode.ReferenceNotFound);
    expect(saved.resolution.nextAttemptAt).toBeUndefined();
    expect(eventTypes(scope)).toEqual(['WagerTransactionRejected']);
    expect(wallet.balance.amount).toBe('1000.00');
    expect(scope.walletSaves).toBe(0);
  });

  test('referência chegou: processa, credita e emite Processed + BalanceChanged', async () => {
    const wallet = walletAfterBet();
    const scope = new FakeScope({ transaction: pendingRefund(), attempts: 3 }, wallet).knows(
      processedBet(),
    );
    const result = await resolver(scope).runOnce();

    expect(result).toMatchObject({ resolved: 1 });
    const saved = scope.saved[0]!;
    expect(saved.transaction.status).toBe(Status.Processed);
    expect(saved.transaction.referenceTransactionId).toBe('tx-bet');
    expect(saved.resolution.observedBalance?.amount).toBe('1000.00');
    expect(saved.resolution.nextAttemptAt).toBeUndefined();
    expect(wallet.balance.amount).toBe('1000.00');
    expect(scope.walletSaves).toBe(1);
    expect(scope.ledger).toHaveLength(1);
    expect(scope.ledger[0]!.walletVersion).toBe(3); // abertura, débito da aposta, crédito do refund
    expect(eventTypes(scope)).toEqual(['WagerTransactionProcessed', 'WalletBalanceChanged']);
  });

  test('referência foi rejeitada: REFERENCE_NOT_PROCESSED, sem mexer no saldo', async () => {
    const rejectedBet = bet();
    rejectedBet.reject(FailureCode.InsufficientFunds);
    const wallet = openWallet();
    const scope = new FakeScope({ transaction: pendingRefund(), attempts: 0 }, wallet).knows(
      rejectedBet,
    );
    const result = await resolver(scope).runOnce();

    expect(result).toMatchObject({ rejected: 1 });
    expect(scope.saved[0]!.transaction.failureCode).toBe(FailureCode.ReferenceNotProcessed);
    expect(scope.ledger).toHaveLength(0);
    expect(wallet.balance.amount).toBe('1000.00');
    expect(eventTypes(scope)).toEqual(['WagerTransactionRejected']);
  });

  test('outra instância já decidiu: skipped e nada é gravado', async () => {
    const scope = new FakeScope(undefined, openWallet());
    const result = await resolver(scope).runOnce();

    expect(result).toMatchObject({ claimed: 1, skipped: 1, failed: 0 });
    expect(scope.saved).toHaveLength(0);
    expect(scope.outbox).toHaveLength(0);
  });

  test('erro em uma transação não impede as demais e vai para onError', async () => {
    const scope = new FlakyScope({ transaction: pendingRefund(), attempts: 0 }, openWallet());
    const due = [
      { transactionId: 'tx-a', walletId: 'wallet-1' },
      { transactionId: 'tx-b', walletId: 'wallet-1' },
    ];
    const failedOn: DuePendingReference[] = [];

    const result = await resolver(scope, due, {
      onError: (_error, reference) => failedOn.push(reference),
    }).runOnce();

    expect(result).toMatchObject({ claimed: 2, failed: 1, stillPending: 1 });
    expect(failedOn).toEqual([due[0]!]);
  });

  test('respeita o tamanho do lote', async () => {
    const due = [
      { transactionId: 'tx-a', walletId: 'wallet-1' },
      { transactionId: 'tx-b', walletId: 'wallet-1' },
    ];
    const scope = new FakeScope(undefined, openWallet());
    const result = await resolver(scope, due, { batchSize: 1 }).runOnce();
    expect(result.claimed).toBe(1);
  });
});