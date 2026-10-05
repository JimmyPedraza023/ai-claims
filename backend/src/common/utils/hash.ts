import { createHash } from 'node:crypto';

/** SHA-256 en hexadecimal (64 caracteres). */
export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}