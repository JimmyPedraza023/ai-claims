import type {
  ClaimClassification, ClaimType, DocumentAnalysis, DocumentType,
} from './classification.schemas.js';

export const POLICY_VERSION = 'policy-v1';

/** Valores iniciales. Se calibran con el dataset de prueba y con la tasa de correcciones. */
export const THRESHOLDS = {
  documentType: 0.8,
  legible: 0.7,
  signed: 0.8,
  matchesInsured: 0.8,
  claimType: 0.85,
} as const;

const SIGNATURE_REQUIRED: ReadonlySet<DocumentType> = new Set(['formulario_sarlaft']);
const MUST_MATCH_INSURED: ReadonlySet<DocumentType> = new Set(['documento_identidad_asegurado']);

/** Confianza de "este documento sirve": la del eslabón más débil de las comprobaciones que le aplican. */
export function validityConfidence(a: DocumentAnalysis): number {
  const type = a.documentType.value;
  const parts = [a.documentType.confidence, a.legible.confidence];
  if (SIGNATURE_REQUIRED.has(type)) parts.push(a.signed.confidence);
  if (MUST_MATCH_INSURED.has(type)) parts.push(a.matchesInsured.confidence);
  return Math.min(...parts);
}

// ---------- Veredicto por documento ----------

export type DocumentVerdictStatus = 'valido' | 'en_revision' | 'invalido' | 'no_corresponde';

export type DocumentReasonCode =
  | 'ilegible' | 'sin_firma' | 'no_corresponde_asegurado'              // invalido
  | 'tipo_incierto' | 'legibilidad_incierta' | 'firma_incierta' | 'asegurado_incierto' // en_revision
  | 'tipo_no_requerido';                                               // no_corresponde

export interface DocumentVerdict {
  status: DocumentVerdictStatus;
  /** null si el modelo no estuvo seguro del tipo: así no cuenta para ningún requisito. */
  documentType: DocumentType | null;
  reason: DocumentReasonCode | null;
}

const verdict = (
  status: DocumentVerdictStatus, documentType: DocumentType | null, reason: DocumentReasonCode | null,
): DocumentVerdict => ({ status, documentType, reason });

const unsure = (confidence: number, threshold: number) => confidence < threshold;

export function evaluateDocument(a: DocumentAnalysis): DocumentVerdict {
  if (unsure(a.documentType.confidence, THRESHOLDS.documentType)) {
    return verdict('en_revision', null, 'tipo_incierto');
  }
  const type = a.documentType.value;
  if (type === 'no_identificado' || unsure(a.documentType.confidence, THRESHOLDS.documentType)) {
    return verdict('en_revision', null, 'tipo_incierto');
  }
  
  if (type === 'otro') return verdict('no_corresponde', 'otro', 'tipo_no_requerido');
  // La legibilidad va primero: si no se lee, no se puede juzgar firma ni identidad.
  // Con poca confianza nunca se tira a la basura: va a revisión humana.
  if (unsure(a.legible.confidence, THRESHOLDS.legible)) {
    return verdict('en_revision', type, 'legibilidad_incierta');
  }
  if (!a.legible.value) return verdict('invalido', type, 'ilegible');

  if (SIGNATURE_REQUIRED.has(type)) {
    if (unsure(a.signed.confidence, THRESHOLDS.signed) || a.signed.value === null) {
      return verdict('en_revision', type, 'firma_incierta');
    }
    if (!a.signed.value) return verdict('invalido', type, 'sin_firma');
  }

  if (MUST_MATCH_INSURED.has(type)) {
    if (unsure(a.matchesInsured.confidence, THRESHOLDS.matchesInsured) || a.matchesInsured.value === null) {
      return verdict('en_revision', type, 'asegurado_incierto');
    }
    if (!a.matchesInsured.value) return verdict('invalido', type, 'no_corresponde_asegurado');
  }

  return verdict('valido', type, null);
}

// ---------- Tipo de reclamación ----------

export type ClaimTypeSource = 'modelo' | 'persona';

export type ClaimTypeReason =
  | 'confirmado_por_persona'   // una persona ya lo fijó: el modelo no lo toca
  | 'asignado_por_modelo'      // confianza alta, primera vez
  | 'mantenido'                // el modelo coincide con lo ya guardado
  | 'tipo_indeterminado'       // el modelo dijo "indeterminado"
  | 'baja_confianza'           // el modelo eligió un tipo pero dudó
  | 'cambio_de_tipo';          // el modelo propone otro tipo distinto al guardado

export interface ClaimTypeDecision {
  /** Lo que debe quedar en claims.claim_type (null = vacío: el beneficiario ve "estamos revisando"). */
  claimType: ClaimType | null;
  source: ClaimTypeSource | null;
  /** true solo si hay que ejecutar un UPDATE. */
  shouldWrite: boolean;
  reviewRequired: boolean;
  reason: ClaimTypeReason;
}

export interface ExistingClaimType {
  claimType: ClaimType | null;
  source: ClaimTypeSource | null;
}

export function decideClaimType(c: ClaimClassification, existing: ExistingClaimType): ClaimTypeDecision {
  // Lo que fijó una persona manda: el modelo nunca lo cambia, ni siquiera para "revisarlo".
  if (existing.claimType && existing.source === 'persona') {
    return {
      claimType: existing.claimType, source: 'persona',
      shouldWrite: false, reviewRequired: false, reason: 'confirmado_por_persona',
    };
  }

  const proposed = c.claimType.value;
  const confident = proposed !== 'indeterminado' && !unsure(c.claimType.confidence, THRESHOLDS.claimType);

  if (!confident) {
    // Con duda no se escribe ni se borra nada: el beneficiario no debe ver una lista que cambia.
    return {
      claimType: existing.claimType, source: existing.source,
      shouldWrite: false, reviewRequired: true,
      reason: proposed === 'indeterminado' ? 'tipo_indeterminado' : 'baja_confianza',
    };
  }

  if (!existing.claimType) {
    return {
      claimType: proposed as ClaimType, source: 'modelo',
      shouldWrite: true, reviewRequired: false, reason: 'asignado_por_modelo',
    };
  }

  if (existing.claimType === proposed) {
    return {
      claimType: existing.claimType, source: existing.source,
      shouldWrite: false, reviewRequired: false, reason: 'mantenido',
    };
  }

  // El modelo "cambió de opinión" (por ejemplo, tras un complemento). No se cambia la lista
  // que ya ve el beneficiario: lo decide una persona.
  return {
    claimType: existing.claimType, source: existing.source,
    shouldWrite: false, reviewRequired: true, reason: 'cambio_de_tipo',
  };
}