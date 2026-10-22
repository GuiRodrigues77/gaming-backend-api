import { Type } from 'class-transformer';
import {
  IsDefined,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { MoneyDto } from './money.dto';

/** OPENING é interno: não está na lista, então a API o rejeita com 400. */
export const SUBMITTABLE_KINDS = ['BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK'] as const;

export class SubmitWagerTransactionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  providerId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  externalTransactionId!: string;

  @IsUUID()
  playerId!: string;

  @IsUUID()
  walletId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  roundId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  gameId!: string;

  @IsIn(SUBMITTABLE_KINDS)
  kind!: string;

  @IsDefined()
  @ValidateNested()
  @Type(() => MoneyDto)
  money!: MoneyDto;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  referenceExternalTransactionId?: string;
}