import { EntityManager } from '@mikro-orm/core';
import { Inject, Injectable } from '@nestjs/common';
import { WalletAlreadyExistsError } from '../../application/errors';
import type { NewWallet, WalletCreator } from '../../application/ports/wallet-creator.port';
import { isUniqueViolation } from './is-unique-violation';
import { LedgerEntryMapper } from './mappers/ledger-entry.mapper';
import { WagerTransactionMapper } from './mappers/wager-transaction.mapper';
import { WalletMapper } from './mappers/wallet.mapper';

@Injectable()
export class MikroOrmWalletCreator implements WalletCreator {
  constructor(@Inject(EntityManager) private readonly em: EntityManager) {}

  async create({ wallet, opening }: NewWallet): Promise<void> {
    try {
      await this.em.fork().transactional(async (em) => {
        em.persist(WalletMapper.toRecord(wallet));
        if (opening !== undefined) {
          em.persist(
            WagerTransactionMapper.toRecord(opening.transaction, {
              observedBalance: wallet.balance,
            }),
          );
          await em.flush(); // a transação precisa existir antes do ledger (FK)
          em.persist(LedgerEntryMapper.toRecord(opening.entry, wallet.version));
        }
      });
    } catch (error) {
      // UNIQUE (player_id, currency): quem perde a corrida cai aqui.
      if (isUniqueViolation(error)) {
        throw new WalletAlreadyExistsError(wallet.playerId, wallet.currency);
      }
      throw error;
    }
  }
}