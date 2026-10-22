import { EntityManager } from '@mikro-orm/core';
import { Inject, Injectable } from '@nestjs/common';
import type { ReadinessCheck } from './readiness-check';
import { withTimeout } from './with-timeout';

@Injectable()
export class PostgresReadinessCheck implements ReadinessCheck {
  readonly name = 'postgres';

  constructor(@Inject(EntityManager) private readonly em: EntityManager) {}

  async check(): Promise<void> {
    await withTimeout(this.em.fork().getConnection().execute('select 1'), 2_000, 'postgres');
  }
}