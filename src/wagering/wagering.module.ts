import { Logger, Module } from '@nestjs/common';
import { CreateWallet } from './application/create-wallet';
import {
  PENDING_REFERENCE_UNIT_OF_WORK,
  type PendingReferenceUnitOfWork,
} from './application/ports/pending-reference.port';
import {
  WAGERING_READ_MODEL,
  type WageringReadModel,
} from './application/ports/wagering-read-model.port';
import {
  WAGERING_UNIT_OF_WORK,
  type WageringUnitOfWork,
} from './application/ports/wagering-unit-of-work.port';
import { WALLET_CREATOR, type WalletCreator } from './application/ports/wallet-creator.port';
import { ResolvePendingReferences } from './application/resolve-pending-references';
import { SubmitWagerTransaction } from './application/submit-wager-transaction';
import { WageringQueries } from './application/wagering-queries';
import { MikroOrmPendingReferenceUnitOfWork } from './infrastructure/persistence/mikro-orm-pending-reference-unit-of-work';
import { MikroOrmWageringReadModel } from './infrastructure/persistence/mikro-orm-wagering-read-model';
import { MikroOrmWageringUnitOfWork } from './infrastructure/persistence/mikro-orm-wagering-unit-of-work';
import { MikroOrmWalletCreator } from './infrastructure/persistence/mikro-orm-wallet-creator';
import { PendingReferenceWorkerService } from './infrastructure/workers/pending-reference-worker.service';
import { HealthController } from './interface/http/health/health.controller';
import { PostgresReadinessCheck } from './interface/http/health/postgres-readiness.check';
import { READINESS_CHECKS } from './interface/http/health/readiness-check';
import { WageringController } from './interface/http/wagering.controller';
import { WalletsController } from './interface/http/wallets.controller';

const pendingReferencesLogger = new Logger('PendingReferences');

@Module({
  controllers: [WalletsController, WageringController, HealthController],
  providers: [
    // portas -> adaptadores MikroORM
    { provide: WAGERING_UNIT_OF_WORK, useClass: MikroOrmWageringUnitOfWork },
    { provide: WALLET_CREATOR, useClass: MikroOrmWalletCreator },
    { provide: WAGERING_READ_MODEL, useClass: MikroOrmWageringReadModel },
    { provide: PENDING_REFERENCE_UNIT_OF_WORK, useClass: MikroOrmPendingReferenceUnitOfWork },

    // casos de uso (classes puras, sem decorators do Nest)
    {
      provide: SubmitWagerTransaction,
      useFactory: (uow: WageringUnitOfWork) => new SubmitWagerTransaction(uow),
      inject: [WAGERING_UNIT_OF_WORK],
    },
    {
      provide: CreateWallet,
      useFactory: (creator: WalletCreator) => new CreateWallet(creator),
      inject: [WALLET_CREATOR],
    },
    {
      provide: WageringQueries,
      useFactory: (readModel: WageringReadModel) => new WageringQueries(readModel),
      inject: [WAGERING_READ_MODEL],
    },
    {
      provide: ResolvePendingReferences,
      useFactory: (uow: PendingReferenceUnitOfWork) =>
        new ResolvePendingReferences(uow, {
          onError: (error, reference) =>
            pendingReferencesLogger.error(
              `failed to resolve transaction ${reference.transactionId}: ${String(error)}`,
            ),
        }),
      inject: [PENDING_REFERENCE_UNIT_OF_WORK],
    },

    // worker em segundo plano (liga no bootstrap, desliga no shutdown)
    PendingReferenceWorkerService,

    // readiness: quando entrar o SQS, é só incluir o check novo nesta lista
    PostgresReadinessCheck,
    {
      provide: READINESS_CHECKS,
      useFactory: (postgres: PostgresReadinessCheck) => [postgres],
      inject: [PostgresReadinessCheck],
    },
  ],
})
export class WageringModule {}