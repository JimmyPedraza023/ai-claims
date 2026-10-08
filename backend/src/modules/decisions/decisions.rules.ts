import type { ClaimStatus } from '../claims/claims.repository';

export type DecisionKind = 'pagar' | 'objetar' | 'pedir_documentos';

export const isClosingDecision = (kind: DecisionKind): kind is 'pagar' | 'objetar' =>
  kind === 'pagar' || kind === 'objetar';

export const closedStatusFor = (kind: 'pagar' | 'objetar'): 'pagada' | 'objetada' =>
  kind === 'pagar' ? 'pagada' : 'objetada';

/** null = permitida. Si no, el mensaje (409) para el analista. */
export function checkDecisionAllowed(
  claim: { status: ClaimStatus; closedAt: Date | null },
  kind: DecisionKind,
): string | null {
  if (claim.closedAt !== null || claim.status === 'pagada' || claim.status === 'objetada') {
    return 'Este caso ya fue resuelto';
  }
  if (isClosingDecision(kind) && claim.status !== 'completa') {
    return 'Solo se puede pagar u objetar un caso con el expediente completo';
  }
  return null;
}