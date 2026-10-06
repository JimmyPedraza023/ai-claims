import type { DocumentIssue, DocumentStatus, DocumentType } from '../../common/domain/enums.js';
import type { DocumentReasonCode, DocumentVerdict } from './classification.policy.js';

/** Lo que se escribe en la tabla de documentos tras el análisis. */
export interface DocumentFields {
  type: DocumentType;
  status: DocumentStatus;
  issue: DocumentIssue | null;
}

const INVALID_ISSUE: Partial<Record<DocumentReasonCode, DocumentIssue>> = {
  ilegible: 'ilegible',
  sin_firma: 'sin_firma',
  no_corresponde_asegurado: 'no_corresponde_asegurado',
};

export function verdictToDocumentFields(v: DocumentVerdict): DocumentFields {
  // Sin tipo no se puede asignar a ningún requisito: queda para una persona.
  if (v.documentType === null) {
    return { type: 'no_identificado', status: 'requiere_revision', issue: 'tipo_no_reconocido' };
  }

  switch (v.status) {
    case 'valido':
      return { type: v.documentType, status: 'valido', issue: null };
    case 'invalido':
      return {
        type: v.documentType,
        status: 'invalido',
        issue: (v.reason && INVALID_ISSUE[v.reason]) || 'otro', // nunca se pierde un inválido
      };
    case 'en_revision':
      return { type: v.documentType, status: 'requiere_revision', issue: null };
    case 'no_corresponde':
      // Supuesto #11: se conserva y queda visible, pero no cuenta para la completitud.
      // Va a revisión: si el modelo se equivocó, una persona lo rescata.
      return { type: v.documentType, status: 'requiere_revision', issue: 'tipo_no_reconocido' };
  }
}