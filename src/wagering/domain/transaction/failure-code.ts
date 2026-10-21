/**
 * Códigos estáveis e legíveis por máquina.
 * REJECTED (negócio): todos exceto INTERNAL_ERROR.
 * FAILED (infra permanente): INTERNAL_ERROR.
 */
export enum FailureCode {
  // saldo
  InsufficientFunds = 'INSUFFICIENT_FUNDS', // BET sem saldo
  ReversalWouldOverdraw = 'REVERSAL_WOULD_OVERDRAW', // reversão deixaria saldo negativo

  // referência
  ReferenceNotFound = 'REFERENCE_NOT_FOUND', // esgotou tentativas/TTL (7.1)
  ReferenceNotProcessed = 'REFERENCE_NOT_PROCESSED', // referência existe mas foi REJECTED/FAILED
  ReferenceMismatch = 'REFERENCE_MISMATCH', // provider/player/wallet/moeda/rodada divergem
  InvalidReferenceKind = 'INVALID_REFERENCE_KIND', // ex.: REFUND de um WIN
  AmountMismatch = 'AMOUNT_MISMATCH', // reversão com valor diferente da referência
  AlreadyReversed = 'ALREADY_REVERSED', // referência já revertida por este tipo

  // entidades
  WalletNotFound = 'WALLET_NOT_FOUND',
  PlayerWalletMismatch = 'PLAYER_WALLET_MISMATCH',
  CurrencyMismatch = 'CURRENCY_MISMATCH', // moeda da operação != moeda da wallet

  // infraestrutura (FAILED)
  InternalError = 'INTERNAL_ERROR',
}