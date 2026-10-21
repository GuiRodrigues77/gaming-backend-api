import type { MikroORM } from '@mikro-orm/postgresql';
import { uuidv7 } from '../application/uuid-v7';
import { Money } from '../domain/money/money';
import { WagerTransaction } from '../domain/transaction/wager-transaction';
import { Wallet } from '../domain/wallet/wallet';
import { LedgerEntryMapper } from '../infrastructure/persistence/mappers/ledger-entry.mapper';
import { WagerTransactionMapper } from '../infrastructure/persistence/mappers/wager-transaction.mapper';
import { WalletMapper } from '../infrastructure/persistence/mappers/wallet.mapper';

/** Abre uma wallet como o futuro use case de criação fará: wallet + OPENING + ledger no mesmo commit. */
export async function openWalletInDb(
  orm: MikroORM,
  initial = '1000.00',
  playerId: string = uuidv7(),
): Promise<{ walletId: string; playerId: string }> {
  const now = new Date();
  const { wallet, openingEntry } = Wallet.open({
    id: uuidv7(),
    playerId,
    initialBalance: Money.from({ amount: initial, currency: 'BRL' }),
    openingTransactionId: uuidv7(),
    openingLedgerEntryId: uuidv7(),
    now,
  });
  const opening = WagerTransaction.createOpening({
    id: openingEntry!.transactionId,
    walletId: wallet.id,
    playerId,
    money: wallet.balance,
    payloadHash: 'opening',
    createdAt: now,
  });
  await orm.em.fork().transactional(async (em) => {
    em.persist(WalletMapper.toRecord(wallet));
    em.persist(WagerTransactionMapper.toRecord(opening));
    await em.flush();
    em.persist(LedgerEntryMapper.toRecord(openingEntry!, wallet.version));
  });
  return { walletId: wallet.id, playerId };
}