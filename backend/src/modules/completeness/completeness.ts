import { ClaimType, DocumentIssue, DocumentStatus, DocumentType } from '../../common/domain/enums';
import { REQUIRED_DOCUMENTS, RULES_VERSION } from './completeness.rules';

/**
 * Evalúa si un expediente está completo. Función pura: recibe los documentos
 * ya analizados y devuelve el resultado. No usa el modelo de IA, no toca la
 * base de datos: la completitud la decide el código, no el modelo.
 *
 * Estado de cada requisito (de mayor a menor prioridad):
 *   valido      hay al menos un documento de ese tipo que sirve
 *   en_revision hay uno pendiente de análisis o a la espera de una persona
 *   invalido    llegó, pero no sirve (sin firma, ilegible, no corresponde...)
 *   faltante    no ha llegado ningún documento de ese tipo
 *
 * "Llegó pero no sirve" y "falta" son casos distintos y se le explican distinto
 * al beneficiario. El expediente solo está completo si TODOS los requisitos
 * están en `valido`: que el archivo exista no basta.
 */

export interface DocumentInput {
  id: string;
  type: DocumentType | null;
  status: DocumentStatus;
  issue: DocumentIssue | null;
  uploadedAt: Date;
}

export type RequirementStatus = 'valido' | 'en_revision' | 'invalido' | 'faltante';

export interface RequirementResult {
  documentType: DocumentType;
  status: RequirementStatus;
  /** Documentos que respaldan este estado (vacío si es faltante). */
  documentIds: string[];
  /** Motivo, solo cuando status es 'invalido' (el del documento más reciente). */
  issue: DocumentIssue | null;
}

export interface CompletenessResult {
  claimType: ClaimType;
  rulesVersion: string;
  isComplete: boolean;
  requirements: RequirementResult[];
  /** Atajos para redactar el mensaje al beneficiario. */
  missing: DocumentType[];
  invalid: Array<{ documentType: DocumentType; issue: DocumentIssue; documentId: string }>;
  inReview: DocumentType[];
  /** Documentos que no corresponden a ningún requisito de este tipo de reclamación. */
  unmatchedDocumentIds: string[];
  /** Documentos que aún no terminan su análisis: conviene esperar antes de avisar "falta X". */
  pendingAnalysisCount: number;
  /** Con qué información se decidió (trazabilidad). */
  documentsConsidered: Array<{ id: string; type: DocumentType | null; status: DocumentStatus }>;
  /** Documentos sin requisito que una persona aún debe mirar (tipo incierto u "otro"):
   *  mientras existan, un "falta" puede ser falso. */
  unmatchedInReviewCount: number;
}

export function evaluateCompleteness(
  claimType: ClaimType,
  documents: readonly DocumentInput[],
): CompletenessResult {
  const required = REQUIRED_DOCUMENTS[claimType];
  const requiredSet = new Set<DocumentType>(required);

  const requirements: RequirementResult[] = required.map((documentType) => {
    const docs = documents.filter((d) => d.type === documentType);

    const valid = docs.filter((d) => d.status === 'valido');
    if (valid.length > 0) {
      return { documentType, status: 'valido', documentIds: valid.map((d) => d.id), issue: null };
    }

    const review = docs.filter(
      (d) => d.status === 'requiere_revision' || d.status === 'pendiente_analisis',
    );
    if (review.length > 0) {
      return {
        documentType,
        status: 'en_revision',
        documentIds: review.map((d) => d.id),
        issue: null,
      };
    }

    const invalid = docs
      .filter((d) => d.status === 'invalido')
      .sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());
    if (invalid.length > 0) {
      return {
        documentType,
        status: 'invalido',
        documentIds: invalid.map((d) => d.id),
        issue: invalid[0].issue ?? 'otro', // el más reciente manda
      };
    }

    return { documentType, status: 'faltante', documentIds: [], issue: null };
  });

  return {
    claimType,
    rulesVersion: RULES_VERSION,
    isComplete: requirements.every((r) => r.status === 'valido'),
    requirements,
    missing: requirements.filter((r) => r.status === 'faltante').map((r) => r.documentType),
    invalid: requirements
      .filter((r) => r.status === 'invalido')
      .map((r) => ({
        documentType: r.documentType,
        issue: r.issue as DocumentIssue,
        documentId: r.documentIds[0],
      })),
    inReview: requirements.filter((r) => r.status === 'en_revision').map((r) => r.documentType),
    unmatchedDocumentIds: documents
      .filter((d) => d.type === null || !requiredSet.has(d.type))
      .map((d) => d.id),
    pendingAnalysisCount: documents.filter((d) => d.status === 'pendiente_analisis').length,
    unmatchedInReviewCount: documents.filter(
      (d) => d.status === 'requiere_revision' && (d.type === null || !requiredSet.has(d.type)),
    ).length,
    documentsConsidered: documents.map((d) => ({ id: d.id, type: d.type, status: d.status })),
  };
}