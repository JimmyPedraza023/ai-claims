import { randomBytes } from 'node:crypto';
import { sha256Hex } from '../../common/utils/hash';

/**
 * Token de seguimiento: el "enlace secreto" con el que el beneficiario vuelve a
 * ver su caso sin crear usuario. Se entrega UNA vez al beneficiario y en la base
 * de datos solo se guarda su hash: quien lea la base no puede reconstruir enlaces.
 *
 * 32 bytes aleatorios (256 bits) en base64url: imposible de adivinar.
 */
export interface TrackingToken {
  token: string;
  hash: string;
}

export function generateTrackingToken(): TrackingToken {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashTrackingToken(token) };
}

export function hashTrackingToken(token: string): string {
  return sha256Hex(token);
}