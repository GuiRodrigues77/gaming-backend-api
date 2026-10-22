import { describe, expect, test } from 'bun:test';
import { uuidv7 } from './uuid-v7';

describe('uuidv7', () => {
  test('formato, versão 7 e variante corretos', () => {
    expect(uuidv7()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  test('ids gerados em instantes diferentes ordenam no tempo', () => {
    expect(uuidv7(1_000) < uuidv7(2_000)).toBe(true);
  });

  test('ids são únicos', () => {
    expect(new Set(Array.from({ length: 1000 }, () => uuidv7())).size).toBe(1000);
  });
});