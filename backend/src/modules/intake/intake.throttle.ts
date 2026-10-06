import type { ThrottlerModuleOptions } from '@nestjs/throttler';

export const THROTTLE_MESSAGE =
  'Hiciste varias solicitudes seguidas. Espera unos minutos e inténtalo de nuevo.';

/**
 * Límite por IP del canal público. Generoso a propósito: muchas personas comparten
 * una misma IP (redes móviles, oficinas) y no queremos bloquear a quien sí necesita
 * radicar. El tiempo (ttl) va en milisegundos.
 */
export const intakeThrottlerOptions: ThrottlerModuleOptions = {
  throttlers: [
    { name: 'short', ttl: 60_000, limit: 5 },
    { name: 'long', ttl: 60 * 60_000, limit: 30 },
  ],
  errorMessage: THROTTLE_MESSAGE,
};