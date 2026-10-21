import { LedgerDirection, oppositeDirection } from '../ledger/ledger-direction';
import type { Money } from '../money/money';
import { FailureCode } from './failure-code';
import {
  InvalidTransactionStateError,
  InvalidWagerTransactionError,
} from './wager-transaction.errors';
import { WagerTransactionKind as Kind } from './wager-transaction-kind';
import { WagerTransactionStatus as Status } from './wager-transaction-status';

export const OPENING_PROVIDER_ID = 'internal';

export interface WagerTransactionState {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: Kind;
  money: Money;
  /** id no provedor, não o id interno */
  referenceExternalTransactionId?: string | undefined;
  createdAt: Date;
  status: Status;
  referenceTransactionId?: string | undefined;
  failureCode?: FailureCode | undefined;
  processedAt?: Date | undefined;
}

export type CreateWagerTransactionProps = Omit<
  WagerTransactionState,
  'status' | 'referenceTransactionId' | 'failureCode' | 'processedAt'
>;

export interface CreateOpeningTransactionProps {
  id: string;
  walletId: string;
  playerId: string;
  money: Money;
  payloadHash: string;
  createdAt: Date;
}

const SUBMITTABLE_KINDS: ReadonlySet<Kind> = new Set([
  Kind.Bet,
  Kind.Win,
  Kind.Loss,
  Kind.Refund,
  Kind.Rollback,
]);
const REQUIRES_REFERENCE: ReadonlySet<Kind> = new Set([Kind.Refund, Kind.Rollback]);
const FORBIDS_REFERENCE: ReadonlySet<Kind> = new Set([Kind.Bet, Kind.Opening]);

/** Quais tipos cada operação pode referenciar. */
const REFERENCEABLE_KINDS: Partial<Record<Kind, readonly Kind[]>> = {
  [Kind.Win]: [Kind.Bet],
  [Kind.Loss]: [Kind.Bet],
  [Kind.Refund]: [Kind.Bet],
  [Kind.Rollback]: [Kind.Bet, Kind.Win, Kind.Refund],
};

const ALLOWED_TRANSITIONS: Readonly<Record<Status, readonly Status[]>> = {
  [Status.Pending]: [Status.PendingReference, Status.Processed, Status.Rejected, Status.Failed],
  [Status.PendingReference]: [Status.Processed, Status.Rejected, Status.Failed],
  [Status.Processed]: [],
  [Status.Rejected]: [],
  [Status.Failed]: [],
};

export class WagerTransaction {
  public readonly id: string;
  public readonly providerId: string;
  public readonly externalTransactionId: string;
  public readonly idempotencyKey: string;
  public readonly payloadHash: string;
  public readonly walletId: string;
  public readonly playerId: string;
  public readonly roundId: string;
  public readonly gameId: string;
  public readonly kind: Kind;
  public readonly money: Money;
  public readonly referenceExternalTransactionId: string | undefined;
  public readonly createdAt: Date;
  private _status: Status;
  private _referenceTransactionId: string | undefined;
  private _failureCode: FailureCode | undefined;
  private _processedAt: Date | undefined;

  private constructor(state: WagerTransactionState) {
    this.id = state.id;
    this.providerId = state.providerId;
    this.externalTransactionId = state.externalTransactionId;
    this.idempotencyKey = state.idempotencyKey;
    this.payloadHash = state.payloadHash;
    this.walletId = state.walletId;
    this.playerId = state.playerId;
    this.roundId = state.roundId;
    this.gameId = state.gameId;
    this.kind = state.kind;
    this.money = state.money;
    this.referenceExternalTransactionId = state.referenceExternalTransactionId;
    this.createdAt = state.createdAt;
    this._status = state.status;
    this._referenceTransactionId = state.referenceTransactionId;
    this._failureCode = state.failureCode;
    this._processedAt = state.processedAt;
  }

  /** Entrada externa (API/fila). Nasce PENDING. OPENING é interno e é rejeitado aqui. */
  static create(props: CreateWagerTransactionProps): WagerTransaction {
    if (!SUBMITTABLE_KINDS.has(props.kind)) {
      throw new InvalidWagerTransactionError(`kind ${props.kind} cannot be submitted`);
    }
    return WagerTransaction.build(props);
  }

  /** Transação interna de abertura da wallet: já nasce PROCESSED. */
  static createOpening(props: CreateOpeningTransactionProps): WagerTransaction {
    const externalId = `opening:${props.walletId}`;
    const tx = WagerTransaction.build({
      id: props.id,
      providerId: OPENING_PROVIDER_ID,
      externalTransactionId: externalId,
      idempotencyKey: externalId,
      payloadHash: props.payloadHash,
      walletId: props.walletId,
      playerId: props.playerId,
      roundId: 'opening',
      gameId: 'opening',
      kind: Kind.Opening,
      money: props.money,
      createdAt: props.createdAt,
    });
    tx.markProcessed(undefined, props.createdAt);
    return tx;
  }

  /** Reconstrução a partir da persistência: não revalida regras de transição. */
  static rehydrate(state: WagerTransactionState): WagerTransaction {
    return new WagerTransaction(state);
  }

  private static build(props: CreateWagerTransactionProps): WagerTransaction {
    const required: Record<string, string> = {
      id: props.id,
      providerId: props.providerId,
      externalTransactionId: props.externalTransactionId,
      idempotencyKey: props.idempotencyKey,
      payloadHash: props.payloadHash,
      walletId: props.walletId,
      playerId: props.playerId,
      roundId: props.roundId,
      gameId: props.gameId,
    };
    for (const [name, value] of Object.entries(required)) {
      if (typeof value !== 'string' || value.trim() === '') {
        throw new InvalidWagerTransactionError(`${name} must be a non-empty string`);
      }
    }

    if (props.kind === Kind.Loss) {
      if (props.money.isNegative()) {
        throw new InvalidWagerTransactionError('amount must not be negative');
      }
    } else if (!props.money.isPositive()) {
      throw new InvalidWagerTransactionError(`${props.kind} amount must be positive`);
    }

    const ref = props.referenceExternalTransactionId;
    if (ref !== undefined && ref.trim() === '') {
      throw new InvalidWagerTransactionError('reference must be non-empty when provided');
    }
    if (REQUIRES_REFERENCE.has(props.kind) && ref === undefined) {
      throw new InvalidWagerTransactionError(`${props.kind} requires a reference`);
    }
    if (FORBIDS_REFERENCE.has(props.kind) && ref !== undefined) {
      throw new InvalidWagerTransactionError(`${props.kind} must not carry a reference`);
    }
    if (ref !== undefined && ref === props.externalTransactionId) {
      throw new InvalidWagerTransactionError('a transaction cannot reference itself');
    }

    return new WagerTransaction({ ...props, status: Status.Pending });
  }

  get status(): Status {
    return this._status;
  }

  get referenceTransactionId(): string | undefined {
    return this._referenceTransactionId;
  }

  get failureCode(): FailureCode | undefined {
    return this._failureCode;
  }

  get processedAt(): Date | undefined {
    return this._processedAt;
  }

  // ---- transições

  markProcessed(referenceTransactionId: string | undefined, at: Date): void {
    this.assertTransition(Status.Processed);
    if (this.requiresReference() && referenceTransactionId === undefined) {
      throw new InvalidWagerTransactionError(
        `${this.kind} cannot be processed without a resolved reference`,
      );
    }
    this._status = Status.Processed;
    this._referenceTransactionId = referenceTransactionId;
    this._processedAt = at;
  }

  markPendingReference(): void {
    this.assertTransition(Status.PendingReference);
    this._status = Status.PendingReference;
  }

  reject(code: FailureCode): void {
    this.assertTransition(Status.Rejected);
    this._status = Status.Rejected;
    this._failureCode = code;
  }

  fail(code: FailureCode): void {
    this.assertTransition(Status.Failed);
    this._status = Status.Failed;
    this._failureCode = code;
  }

  private assertTransition(to: Status): void {
    if (!ALLOWED_TRANSITIONS[this._status].includes(to)) {
      throw new InvalidTransactionStateError(this._status, to);
    }
  }

  // ---- consultas de domínio

  isTerminal(): boolean {
    return ALLOWED_TRANSITIONS[this._status].length === 0;
  }

  affectsBalance(): boolean {
    return this.kind !== Kind.Loss;
  }

  requiresReference(): boolean {
    return REQUIRES_REFERENCE.has(this.kind);
  }

  matchesPayload(payloadHash: string): boolean {
    return this.payloadHash === payloadHash;
  }

  /**
   * Valida as regras estruturais da referência já resolvida por
   * (providerId, referenceExternalTransactionId). Devolve o FailureCode da
   * violação, ou undefined se estiver tudo certo. Status da referência e
   * "já revertida" são verificados pelo use case contra o banco.
   */
  checkReference(reference: WagerTransaction): FailureCode | undefined {
    const allowedKinds = REFERENCEABLE_KINDS[this.kind];
    if (allowedKinds === undefined) {
      throw new InvalidWagerTransactionError(`${this.kind} does not take a reference`);
    }
    if (
      reference.providerId !== this.providerId ||
      reference.externalTransactionId !== this.referenceExternalTransactionId ||
      reference.playerId !== this.playerId ||
      reference.walletId !== this.walletId ||
      reference.roundId !== this.roundId ||
      reference.money.currency !== this.money.currency
    ) {
      return FailureCode.ReferenceMismatch;
    }
    if (!allowedKinds.includes(reference.kind)) {
      return FailureCode.InvalidReferenceKind;
    }
    if (this.requiresReference() && !reference.money.equals(this.money)) {
      return FailureCode.AmountMismatch;
    }
    return undefined;
  }

  /**
   * Direção do lançamento. ROLLBACK é o inverso da direção da referência.
   * LOSS não gera lançamento e lança erro.
   */
  ledgerDirectionFor(reference?: WagerTransaction): LedgerDirection {
    switch (this.kind) {
      case Kind.Bet:
        return LedgerDirection.Debit;
      case Kind.Win:
      case Kind.Refund:
      case Kind.Opening:
        return LedgerDirection.Credit;
      case Kind.Loss:
        throw new InvalidWagerTransactionError('LOSS does not affect balance');
      case Kind.Rollback: {
        if (reference === undefined) {
          throw new InvalidWagerTransactionError('ROLLBACK requires the reference transaction');
        }
        if (!REFERENCEABLE_KINDS[Kind.Rollback]!.includes(reference.kind)) {
          throw new InvalidWagerTransactionError(
            `ROLLBACK cannot reverse a ${reference.kind}`,
          );
        }
        return oppositeDirection(reference.ledgerDirectionFor());
      }
    }
  }
}