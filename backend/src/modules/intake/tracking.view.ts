// backend/src/modules/intake/tracking.view.ts
import type { DocumentType } from '../../common/domain/enums';
import type { ClaimRecord } from '../claims/claims.repository';
import { evaluateCompleteness } from '../completeness/completeness';
import type { DocumentInput, RequirementStatus } from '../completeness/completeness';
import { DOCUMENT_LABELS, HEADLINES, ISSUE_MESSAGES } from './tracking.messages';

export type TrackingClaim = Pick<ClaimRecord, 'referenceCode' | 'status' | 'claimType' | 'receivedAt'>;

export type TrackingStage = 'revisando' | 'faltan_documentos' | 'completa' | 'cerrada';
export type ChecklistState = 'listo' | 'revisando' | 'falta' | 'no_sirve';

export interface TrackingChecklistItem {
  documentType: DocumentType;
  label: string;
  state: ChecklistState;
  /** Solo cuando el documento llegó y no sirve: qué pasó y qué hacer. */
  message: string | null;
}

/** Lo único que ve el beneficiario. Sin ids internos, rutas, hashes ni fechas del plazo legal. */
export interface TrackingView {
  referenceCode: string;
  receivedAt: string;
  stage: TrackingStage;
  headline: string;
  documentsReceived: number;
  /** Vacía mientras no se sepa el tipo de reclamación. */
  checklist: TrackingChecklistItem[];
}

const STATE_BY_REQUIREMENT: Record<RequirementStatus, ChecklistState> = {
  valido: 'listo',
  en_revision: 'revisando',
  invalido: 'no_sirve',
  faltante: 'falta',
};

export function buildTrackingView(
  claim: TrackingClaim,
  documents: readonly DocumentInput[],
): TrackingView {
  const base = {
    referenceCode: claim.referenceCode,
    receivedAt: claim.receivedAt.toISOString(),
    documentsReceived: documents.length,
  };

  if (claim.status === 'pagada' || claim.status === 'objetada') {
    return { ...base, stage: 'cerrada', headline: HEADLINES.cerrada, checklist: [] };
  }

  // Sin tipo de reclamación no se sabe qué exigir: no se inventa una lista.
  if (!claim.claimType) {
    return { ...base, stage: 'revisando', headline: HEADLINES.revisando, checklist: [] };
  }

  const result = evaluateCompleteness(claim.claimType, documents);
  const waiting = result.pendingAnalysisCount > 0;

  const checklist: TrackingChecklistItem[] = result.requirements.map((r) => ({
    documentType: r.documentType,
    label: DOCUMENT_LABELS[r.documentType],
    // Con archivos sin analizar, un "falta" podría resolverse solo: todavía no se afirma.
    state: r.status === 'faltante' && waiting ? 'revisando' : STATE_BY_REQUIREMENT[r.status],
    message: r.status === 'invalido' && r.issue ? ISSUE_MESSAGES[r.issue] : null,
  }));

  // "Completa" solo cuando la base ya lo registró (ahí arranca el reloj), no cuando lo diga este cálculo.
  if (claim.status === 'completa') {
    return { ...base, stage: 'completa', headline: HEADLINES.completa, checklist };
  }

  const needsAction = checklist.some((i) => i.state === 'falta' || i.state === 'no_sirve');
  return {
    ...base,
    stage: needsAction ? 'faltan_documentos' : 'revisando',
    headline: needsAction ? HEADLINES.faltan : HEADLINES.revisando,
    checklist,
  };
}