import { ValidationPipe } from '@nestjs/common';

/** Rejeita campos desconhecidos (400) e converte o corpo para a classe do DTO. */
export const requestValidationPipe = () =>
  new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });