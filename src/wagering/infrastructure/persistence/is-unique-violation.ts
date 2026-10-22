import { UniqueConstraintViolationException } from '@mikro-orm/core';

export function isUniqueViolation(error: unknown): boolean {
  if (error instanceof UniqueConstraintViolationException) return true;
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505'
  );
}