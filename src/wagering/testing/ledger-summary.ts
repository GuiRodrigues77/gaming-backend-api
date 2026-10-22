import type { MikroORM } from '@mikro-orm/postgresql';
import { Money } from '../domain/money/money';

export interface LedgerSummary {
  balance: Money;
  /** Saldo reconstruído pelo ledger: créditos menos débitos. */
  rebuilt: Money;
  /** A invariante final de todos os testes: wallet.balance == saldo do ledger. */
  consistent: boolean;
  entries: number;
  debits: number;
  credits: number;
}

export async function ledgerSummary(orm: MikroORM, walletId: string): Promise<LedgerSummary> {
  const rows = (await orm.em.getConnection().execute(
    `select w.balance::text as balance,
            coalesce(sum(case l.direction when 'CREDIT' then l.amount else -l.amount end), 0)::text as ledger,
            count(l.id)::int as entries,
            (count(l.id) filter (where l.direction = 'DEBIT'))::int as debits,
            (count(l.id) filter (where l.direction = 'CREDIT'))::int as credits
       from wallets w
       left join wallet_ledger_entries l on l.wallet_id = w.id
      where w.id = ?
      group by w.id, w.balance`,
    [walletId],
  )) as unknown as Array<{
    balance: string;
    ledger: string;
    entries: number;
    debits: number;
    credits: number;
  }>;

  const row = rows[0];
  if (row === undefined) throw new Error(`wallet ${walletId} not found`);

  const balance = Money.from({ amount: String(row.balance), currency: 'BRL' });
  const rebuilt = Money.from({ amount: String(row.ledger), currency: 'BRL' });
  return {
    balance,
    rebuilt,
    consistent: balance.equals(rebuilt),
    entries: Number(row.entries),
    debits: Number(row.debits),
    credits: Number(row.credits),
  };
}