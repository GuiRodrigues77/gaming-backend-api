import { IsString, Matches } from 'class-validator';

/**
 * A coluna é numeric(20,2). Limitar a 15 dígitos inteiros garante que a soma de
 * saldos nunca estoura a coluna. Valores que nem começam com dígitos (ex.: "abc")
 * passam aqui e são rejeitados pela validação de Money no domínio.
 */
const MAX_15_INTEGER_DIGITS = /^(?!-?\d{16})/;

export class MoneyDto {
  @IsString()
  @Matches(MAX_15_INTEGER_DIGITS, { message: 'amount must have at most 15 integer digits' })
  amount!: string;

  @IsString()
  currency!: string;
}