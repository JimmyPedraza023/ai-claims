import type { ClaimStatus } from '../claims/claims.repository';

export type StatusAction = 'iniciar_reloj' | 'marcar_incompleta' | 'sin_cambio';

/**
 * Qué cambia en el caso tras evaluar su expediente. El reloj solo arranca desde
 * 'recibida' o 'incompleta', y un caso 'completa' nunca vuelve atrás.
 */
export function decideStatusChange(status: ClaimStatus, isComplete: boolean): StatusAction {
  if (status !== 'recibida' && status !== 'incompleta') return 'sin_cambio';
  if (isComplete) return 'iniciar_reloj';
  return status === 'recibida' ? 'marcar_incompleta' : 'sin_cambio';
}