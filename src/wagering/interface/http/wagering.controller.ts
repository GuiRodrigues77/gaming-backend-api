import {
  BadRequestException, Body, Controller, Get, Headers, Inject, Param, Post, Res,
  UseFilters, UseGuards, UsePipes,
} from '@nestjs/common';
import type { Response } from 'express';
import { SubmitWagerTransaction } from '../../application/submit-wager-transaction';
import { WageringQueries } from '../../application/wagering-queries';
import { SubmitWagerTransactionDto } from './dto/submit-wager-transaction.dto';
import { NoopAuthGuard } from './noop-auth.guard';
import { httpStatusFor, presentStoredTransaction, presentSubmitResult } from './presenters';
import { requestValidationPipe } from './request-validation.pipe';
import { WageringExceptionFilter } from './wagering-exception.filter';

const MAX_IDEMPOTENCY_KEY_LENGTH = 255;

function requireIdempotencyKey(value: string | undefined): string {
  const key = value?.trim();
  if (key === undefined || key === '') {
    throw new BadRequestException('Idempotency-Key header is required');
  }
  if (key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new BadRequestException(
      `Idempotency-Key must have at most ${MAX_IDEMPOTENCY_KEY_LENGTH} characters`,
    );
  }
  return key;
}

@Controller()
@UseGuards(NoopAuthGuard)
@UseFilters(WageringExceptionFilter)
@UsePipes(requestValidationPipe())
export class WageringController {
  constructor(
    @Inject(SubmitWagerTransaction) private readonly submitTransaction: SubmitWagerTransaction,
    @Inject(WageringQueries) private readonly queries: WageringQueries,
  ) {}

  @Post('wagering/transactions')
  async submit(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Body() body: SubmitWagerTransactionDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.submitTransaction.execute({
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
      providerId: body.providerId,
      externalTransactionId: body.externalTransactionId,
      playerId: body.playerId,
      walletId: body.walletId,
      roundId: body.roundId,
      gameId: body.gameId,
      kind: body.kind,
      money: body.money,
      referenceExternalTransactionId: body.referenceExternalTransactionId,
      correlationId: correlationId?.trim() || undefined,
    });
    response.status(httpStatusFor(result.status));
    return presentSubmitResult(result);
  }

  @Get('wagering/transactions/:transactionId')
  async getById(@Param('transactionId') transactionId: string) {
    return presentStoredTransaction(await this.queries.getTransaction(transactionId));
  }

  @Get('providers/:providerId/wagering/transactions/:externalTransactionId')
  async getByExternalId(
    @Param('providerId') providerId: string,
    @Param('externalTransactionId') externalTransactionId: string,
  ) {
    return presentStoredTransaction(
      await this.queries.getTransactionByExternalId(providerId, externalTransactionId),
    );
  }
}