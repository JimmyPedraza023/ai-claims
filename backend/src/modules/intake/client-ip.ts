// backend/src/modules/intake/client-ip.ts
import { createHmac } from 'node:crypto';

/** Una IPv4 puede llegar como '::ffff:1.2.3.4': es el mismo origen y debe dar el mismo hash. */
function canonical(ip: string): string {
  return ip.trim().replace(/^::ffff:/i, '');
}

/**
 * HMAC-SHA256 de la IP con un secreto del entorno. Un hash simple se revierte probando
 * todas las IPv4 (son pocas); con el secreto, quien lea la base no puede hacerlo.
 * Devuelve null si falta la IP o el secreto: es preferible no guardar nada.
 */
export function hashClientIp(
  ip: string | undefined | null,
  secret: string | undefined,
): string | null {
  if (!ip || !secret) return null;
  return createHmac('sha256', secret).update(canonical(ip)).digest('hex');
}