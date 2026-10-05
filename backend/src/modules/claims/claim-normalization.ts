/**
 * Normalización de los datos que identifican un caso.
 *
 * Importa porque la base de datos evita duplicados comparando textos exactos:
 * si "1.234.567" y "1234567" se guardaran distinto, el mismo beneficiario podría
 * abrir dos expedientes y reiniciar el reloj. Se normaliza ANTES de guardar.
 */

/** Documento de identidad: sin puntos, espacios ni guiones, en mayúsculas. */
export function normalizeDocumentNumber(raw: string): string {
  return raw.replace(/[^0-9a-zA-Z]/g, '').toUpperCase();
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Nombres: sin espacios sobrantes al inicio, al final ni repetidos. */
export function normalizeName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}