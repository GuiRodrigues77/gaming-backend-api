import type { WalletLedgerEntry } from '../../domain/ledger/wallet-ledger-entry';
import type { WagerTransaction } from '../../domain/transaction/wager-transaction';
import type { Wallet } from '../../domain/wallet/wallet';

export interface NewWallet {
  wallet: Wallet;
  /** Só existe quando o saldo inicial é maior que zero. */
  opening: { transaction: WagerTransaction; entry: WalletLedgerEntry } | undefined;
}

export interface WalletCreator {
  /**
   * Grava wallet, transação OPENING e lançamento no mesmo commit.
   * @throws WalletAlreadyExistsError se já existir wallet do jogador nessa moeda
   */
  create(newWallet: NewWallet): Promise<void>;
}

export const WALLET_CREATOR = Symbol('WALLET_CREATOR');