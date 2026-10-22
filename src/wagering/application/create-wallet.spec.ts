import { describe, expect, test } from 'bun:test';
import { LedgerDirection } from '../domain/ledger/ledger-direction';
import { InvalidMoneyError } from '../domain/money/money.errors';
import { WagerTransactionKind } from '../domain/transaction/wager-transaction-kind';
import { WagerTransactionStatus } from '../domain/transaction/wager-transaction-status';
import { InvalidWalletOperationError } from '../domain/wallet/wallet.errors';
import { CreateWallet } from './create-wallet';
import { WalletAlreadyExistsError } from './errors';
import type { NewWallet, WalletCreator } from './ports/wallet-creator.port';

const PLAYER_ID = '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1';

class FakeCreator implements WalletCreator {
  readonly created: NewWallet[] = [];

  constructor(private readonly error: Error | undefined = undefined) {}

  async create(newWallet: NewWallet): Promise<void> {
    if (this.error !== undefined) throw this.error;
    this.created.push(newWallet);
  }
}

const command = (amount: string) => ({
  playerId: PLAYER_ID,
  initialBalance: { amount, currency: 'BRL' },
});

describe('CreateWallet', () => {
  test('saldo inicial positivo gera wallet, transação OPENING e lançamento CREDIT', async () => {
    const creator = new FakeCreator();
    const result = await new CreateWallet(creator).execute(command('1000.00'));

    expect(result.balance.amount).toBe('1000.00');
    expect(result.version).toBe(1);

    const { opening } = creator.created[0]!;
    expect(opening?.transaction.kind).toBe(WagerTransactionKind.Opening);
    expect(opening?.transaction.status).toBe(WagerTransactionStatus.Processed);
    expect(opening?.entry.direction).toBe(LedgerDirection.Credit);
    expect(opening?.entry.transactionId).toBe(opening?.transaction.id);
  });

  test('saldo inicial zero cria só a wallet', async () => {
    const creator = new FakeCreator();
    const result = await new CreateWallet(creator).execute(command('0.00'));
    expect(result.balance.amount).toBe('0.00');
    expect(creator.created[0]!.opening).toBeUndefined();
  });

  test('valor inválido ou negativo é rejeitado antes de gravar', async () => {
    const creator = new FakeCreator();
    const useCase = new CreateWallet(creator);
    await expect(useCase.execute(command('-1.00'))).rejects.toBeInstanceOf(InvalidMoneyError);
    await expect(useCase.execute(command('1e3'))).rejects.toBeInstanceOf(InvalidMoneyError);
    expect(creator.created).toHaveLength(0);
  });

  test('playerId que não é UUID é rejeitado', async () => {
    await expect(
      new CreateWallet(new FakeCreator()).execute({ ...command('10.00'), playerId: 'abc' }),
    ).rejects.toBeInstanceOf(InvalidWalletOperationError);
  });

  test('wallet duplicada: o erro do repositório sobe sem ser engolido', async () => {
    const creator = new FakeCreator(new WalletAlreadyExistsError(PLAYER_ID, 'BRL'));
    await expect(new CreateWallet(creator).execute(command('10.00'))).rejects.toBeInstanceOf(
      WalletAlreadyExistsError,
    );
  });
});