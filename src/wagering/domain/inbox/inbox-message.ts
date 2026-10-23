export class InvalidInboxMessageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidInboxMessageError';
  }
}

export class InboxMessageAlreadyProcessedError extends Error {
  constructor(messageId: string) {
    super(`Inbox message ${messageId} was already processed`);
    this.name = 'InboxMessageAlreadyProcessedError';
  }
}

export interface ReceiveInboxProps {
  messageId: string;
  consumerName: string;
  payloadHash: string;
  receivedAt: Date;
}

export interface InboxMessageState extends ReceiveInboxProps {
  processedAt?: Date | undefined;
}

export class InboxMessage {
  private constructor(
    public readonly messageId: string,
    public readonly consumerName: string,
    public readonly payloadHash: string,
    public readonly receivedAt: Date,
    private _processedAt: Date | undefined,
  ) {}

  static receive(props: ReceiveInboxProps): InboxMessage {
    for (const field of ['messageId', 'consumerName', 'payloadHash'] as const) {
      if (props[field].trim() === '') {
        throw new InvalidInboxMessageError(`${field} must not be empty`);
      }
    }
    return new InboxMessage(
      props.messageId,
      props.consumerName,
      props.payloadHash,
      props.receivedAt,
      undefined,
    );
  }

  /** Reconstrução a partir da persistência: não revalida. */
  static rehydrate(state: InboxMessageState): InboxMessage {
    return new InboxMessage(
      state.messageId,
      state.consumerName,
      state.payloadHash,
      state.receivedAt,
      state.processedAt,
    );
  }

  get processedAt(): Date | undefined {
    return this._processedAt;
  }

  isProcessed(): boolean {
    return this._processedAt !== undefined;
  }

  markProcessed(at: Date): void {
    if (this.isProcessed()) throw new InboxMessageAlreadyProcessedError(this.messageId);
    this._processedAt = at;
  }

  /** Mesmo messageId com payload diferente é conflito, não redelivery. */
  matchesPayload(payloadHash: string): boolean {
    return this.payloadHash === payloadHash;
  }
}