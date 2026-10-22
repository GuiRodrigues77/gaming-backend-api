import {
  Body, Controller, Get, HttpCode, Inject, Logger, Param, Post, Query,
  UseFilters, UseGuards, UsePipes,
} from '@nestjs/common';
import { CreateWallet } from '../../application/create-wallet';
import { WageringQueries } from '../../application/wagering-queries';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { NoopAuthGuard } from './noop-auth.guard';
import {
  presentCreatedWallet, presentLedgerPage, presentReconciliation, presentWallet,
} from './presenters';
import { requestValidationPipe } from './request-validation.pipe';
import { WageringExceptionFilter } from './wagering-exception.filter';

@Controller('wallets')
@UseGuards(NoopAuthGuard)
@UseFilters(WageringExceptionFilter)
@UsePipes(requestValidationPipe())
export class WalletsController {
  private readonly logger = new Logger(WalletsController.name);

  constructor(
    @Inject(CreateWallet) private readonly createWallet: CreateWallet,
    @Inject(WageringQueries) private readonly queries: WageringQueries,
  ) {}

  @Post()
  @HttpCode(201)
  async create(@Body() body: CreateWalletDto) {
    const wallet = await this.createWallet.execute({
      playerId: body.playerId,
      initialBalance: body.initialBalance,
    });
    return presentCreatedWallet(wallet);
  }

  @Get(':walletId')
  async get(@Param('walletId') walletId: string) {
    return presentWallet(await this.queries.getWallet(walletId));
  }

  @Get(':walletId/ledger')
  async ledger(
    @Param('walletId') walletId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const page = await this.queries.getLedger(walletId, {
      cursor,
      limit: limit === undefined ? undefined : Number(limit), // NaN é rejeitado pelo use case
    });
    return presentLedgerPage(page);
  }

  @Post(':walletId/reconciliation')
  @HttpCode(200)
  async reconcile(@Param('walletId') walletId: string) {
    const report = await this.queries.reconcile(walletId);
    if (!report.consistent) {
      // Divergência nunca é corrigida em silêncio: fica no log e na resposta.
      // (o contador em métrica entra na etapa de observabilidade)
      this.logger.error(
        `Reconciliation divergence: wallet=${walletId} difference=${report.difference.amount} entries=${report.checkedEntries}`,
      );
    }
    return presentReconciliation(report);
  }
}