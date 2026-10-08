// backend/src/modules/notifications/notification-drafts.ts
import { createHash } from 'node:crypto';
import type { ClaimType, DocumentType } from '../../common/domain/enums';
import type { CompletenessResult } from '../completeness/completeness';
import { DOCUMENT_LABELS, HEADLINES, ISSUE_MESSAGES } from '../intake/tracking.messages';

export interface NotificationDraft {
  kind: 'faltantes' | 'documento_invalido' | 'expediente_completo';
  subject: string;
  body: string;
  dedupeKey: string;
}

const CLOSING =
  'Puedes subir lo que falta desde el enlace de seguimiento que te enviamos al radicar tu solicitud. ' +
  'Si tienes dudas, comunícate con la compañía por sus canales habituales.';

function greeting(claimType: ClaimType): string {
  return claimType === 'incapacidad_total_permanente'
    ? 'Hola,'
    : 'Hola, lamentamos mucho tu pérdida.';
}

/** Función pura: de la evaluación al aviso. null = todavía no hay nada útil que decirle. */
export function draftBeneficiaryNotice(
  claimId: string,
  result: CompletenessResult,
): NotificationDraft | null {
  if (result.isComplete) {
    return {
      kind: 'expediente_completo',
      subject: 'Tu expediente está completo',
      body: [greeting(result.claimType), '', HEADLINES.completa].join('\n'),
      dedupeKey: `completo:${claimId}`,
    };
  }

  // Un "falta X" puede ser falso mientras algo se analiza o una persona lo mira.
  if (result.pendingAnalysisCount > 0 || result.unmatchedInReviewCount > 0) return null;
  if (result.missing.length === 0 && result.invalid.length === 0) return null;

  const lines: string[] = [greeting(result.claimType), '', HEADLINES.faltan, ''];

  if (result.invalid.length > 0) {
    lines.push('Estos documentos llegaron, pero necesitamos que los envíes de nuevo:');
    for (const i of result.invalid) {
      lines.push(`- ${DOCUMENT_LABELS[i.documentType]}: ${ISSUE_MESSAGES[i.issue]}`);
    }
    lines.push('');
  }
  if (result.missing.length > 0) {
    lines.push('Estos documentos aún no nos han llegado:');
    for (const t of result.missing) lines.push(`- ${DOCUMENT_LABELS[t]}`);
    lines.push('');
  }
  if (result.inReview.length > 0) {
    lines.push('Seguimos revisando:');
    for (const t of result.inReview) lines.push(`- ${DOCUMENT_LABELS[t]}`);
    lines.push('');
  }
  lines.push(CLOSING);

  const hasInvalid = result.invalid.length > 0;
  const fingerprint = [
    result.rulesVersion,
    result.claimType,
    'F:' + [...result.missing].sort().join(','),
    'I:' + result.invalid.map((i) => `${i.documentType}:${i.issue}:${i.documentId}`).sort().join(','),
  ].join('|');

  return {
    kind: hasInvalid ? 'documento_invalido' : 'faltantes',
    subject: !hasInvalid
      ? 'Tu reclamación: documentos que necesitamos'
      : result.invalid.length === 1
        ? 'Tu reclamación: un documento necesita corrección'
        : 'Tu reclamación: algunos documentos necesitan corrección',
    body: lines.join('\n'),
    dedupeKey: `estado:${claimId}:${createHash('sha256').update(fingerprint).digest('hex').slice(0, 16)}`,
  };
}

/**
 * Aviso por la decisión "pedir documentos". Recibe SOLO tipos de documento: el motivo que escribió
 * el analista es interno y nunca llega al correo.
 * Si el caso ya estaba completo, el seguimiento rechaza subidas (409): el aviso no manda a subirlos por el enlace.
 */
export function draftRequestedDocumentsNotice(
  claimId: string,
  decisionId: string,
  documents: readonly DocumentType[],
  uploadViaLink: boolean,
): NotificationDraft {
  const lines = [
    'Hola,',
    '',
    uploadViaLink
      ? 'Para continuar con tu reclamación necesitamos que nos envíes estos documentos:'
      : 'Tu expediente estaba completo, pero necesitamos estos documentos adicionales:',
    '',
    ...documents.map((t) => `- ${DOCUMENT_LABELS[t]}`),
    '',
    uploadViaLink
      ? 'Puedes subirlos desde el enlace de seguimiento que te enviamos al radicar tu solicitud. ' +
        'Si tienes dudas, comunícate con la compañía por sus canales habituales.'
      : 'Por favor comunícate con la compañía por sus canales habituales para entregarlos.',
  ];
  return {
    kind: 'faltantes',
    subject: 'Tu reclamación: documentos que necesitamos',
    body: lines.join('\n'),
    dedupeKey: `decision:${decisionId}`,
  };
}