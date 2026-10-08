import type { DocumentIssue, DocumentType } from '../../common/domain/enums';
import type { CompletenessResult } from '../completeness/completeness';
import { DOCUMENT_LABELS } from '../intake/tracking.messages';

/** Cómo quedaría el expediente con la corrección ya aplicada. Solo tipos y estados: sin datos personales. */
export interface CompletenessSummary {
  isComplete: boolean;
  missing: DocumentType[];
  invalid: Array<{ documentType: DocumentType; issue: DocumentIssue }>;
  inReview: DocumentType[];
}

export function summarizeCompleteness(r: CompletenessResult): CompletenessSummary {
  return {
    isComplete: r.isComplete,
    missing: r.missing,
    invalid: r.invalid.map((i) => ({ documentType: i.documentType, issue: i.issue })),
    inReview: r.inReview,
  };
}

/** Aviso para el analista cuando corrige un caso que ya tiene el reloj corriendo. null = no aplica. */
export function buildCorrectionNotice(s: CompletenessSummary | null): string | null {
  if (!s) return null;
  const base = 'El expediente ya estaba completo y el plazo no cambia.';
  if (s.isComplete) return `${base} Con esta corrección sigue completo.`;

  const label = (t: DocumentType) => DOCUMENT_LABELS[t];
  const parts: string[] = [];
  if (s.missing.length > 0) parts.push(`faltarían: ${s.missing.map(label).join(', ')}`);
  if (s.invalid.length > 0) parts.push(`no servirían: ${s.invalid.map((i) => label(i.documentType)).join(', ')}`);
  if (s.inReview.length > 0) parts.push(`quedarían en revisión: ${s.inReview.map(label).join(', ')}`);
  return `${base} Con esta corrección ${parts.join('; ')}. Si hace falta algo, registra una decisión de pedir documentos.`;
}