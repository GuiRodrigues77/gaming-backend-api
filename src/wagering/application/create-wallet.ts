import { Money, type MoneyProps } from '../domain/money/money';
import { WagerTransaction } from '../domain/transaction/wager-transaction';
import { Wallet } from '../domain/wallet/wallet';
import { InvalidWalletOperationError } from '../domain/wallet/wallet.errors';
import { isUuid } from './is-uuid';
import type { WalletCreator } from './ports/wallet-creator.port';
import { uuidv7 } from './uuid-v7';

export interface CreateWalletCommand {
  playerId: string;
  initialBalance: MoneyProps;
}

export interface CreateWalletResult {
  id: string;
  playerId: string;
  balance: Money;
  version: number;
}

export interface CreateWalletOptions {
  now?: () => Date;
  newId?: () => string;
}

export class CreateWallet {
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(
    private readonly creator: WalletCreator,
    options: CreateWalletOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? (() => uuidv7());
  }

  async execute(command: CreateWalletCommand): Promise<CreateWalletResult> {
    if (!isUuid(command.playerId)) {
      throw new InvalidWalletOperationError('playerId must be a UUID');
    }
    const initialBalance = Money.from(command.initialBalance); // rejeita valor inválido ou negativo
    const now = this.now();

    const { wallet, openingEntry } = Wallet.open({
      id: this.newId(),
      playerId: command.playerId,
      initialBalance,
      openingTransactionId: this.newId(),
      openingLedgerEntryId: this.newId(),
      now,
    });

    // Saldo inicial maior que zero gera a transação interna OPENING.
    const opening =
      openingEntry === undefined
        ? undefined
        : {
            entry: openingEntry,
            transaction: WagerTransaction.createOpening({
              id: openingEntry.transactionId,
              walletId: wallet.id,
              playerId: wallet.playerId,
              money: wallet.balance,
              payloadHash: 'opening',
              createdAt: now,
            }),
          };

    await this.creator.create({ wallet, opening });

    return {
      id: wallet.id,
      playerId: wallet.playerId,
      balance: wallet.balance,
      version: wallet.version,
    };
  }
}