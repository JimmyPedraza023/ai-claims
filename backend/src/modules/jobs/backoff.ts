const BASE_SECONDS = 30;
const MAX_SECONDS = 900;

/** Espera antes del siguiente intento: 30, 60, 120, 240, 480... con tope de 15 minutos. */
export function backoffSeconds(attempt: number, minSeconds = 0): number {
  const n = Math.max(1, Math.floor(attempt));
  return Math.max(Math.min(BASE_SECONDS * 2 ** (n - 1), MAX_SECONDS), minSeconds);
}