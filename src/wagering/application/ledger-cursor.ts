import { InvalidQueryError } from './errors';

const MAX_WALLET_VERSION = 2_147_483_647; // coluna integer

/**
 * Cursor opaco: base64url de {"v": walletVersion}. É estável porque wallet_version
 * é único por wallet e o ledger só recebe inserções.
 */
export function encodeLedgerCursor(walletVersion: number): string {
  return Buffer.from(JSON.stringify({ v: walletVersion })).toString('base64url');
}

export function decodeLedgerCursor(cursor: string): number {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new InvalidQueryError('invalid cursor');
  }
  if (typeof parsed === 'object' && parsed !== null) {
    const version = (parsed as { v?: unknown }).v;
    if (
      typeof version === 'number' &&
      Number.isInteger(version) &&
      version >= 1 &&
      version <= MAX_WALLET_VERSION
    ) {
      return version;
    }
  }
  throw new InvalidQueryError('invalid cursor');
}