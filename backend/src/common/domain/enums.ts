/**
 * Vocabulario del dominio. Refleja los tipos ENUM de la base de datos
 * (migración 0001_enums.sql). El test enums.spec.ts verifica que ambos lados
 * no se desincronicen: si cambias uno, el test falla hasta que cambies el otro.
 */

export const CLAIM_TYPES = [
  'muerte_natural',
  'muerte_accidental',
  'incapacidad_total_permanente',
] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

export const DOCUMENT_TYPES = [
  'formato_reclamacion',
  'registro_civil_defuncion',
  'certificado_medico_defuncion',
  'documento_identidad_asegurado',
  'documento_identidad_beneficiario',
  'formulario_sarlaft',
  'certificacion_bancaria',
  'informe_autoridad',
  'dictamen_perdida_capacidad_laboral',
  'historia_clinica_resumida',
  'otro',
  'no_identificado',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_STATUSES = [
  'pendiente_analisis',
  'valido',
  'invalido',
  'requiere_revision',
] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const DOCUMENT_ISSUES = [
  'sin_firma',
  'ilegible',
  'no_corresponde_asegurado',
  'no_corresponde_beneficiario',
  'tipo_no_reconocido',
  'incompleto',
  'archivo_danado',
  'otro',
] as const;
export type DocumentIssue = (typeof DOCUMENT_ISSUES)[number];

export const ACTOR_TYPES = ['sistema', 'modelo', 'beneficiario', 'analista'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export const INTAKE_CHANNELS = ['web', 'telegram', 'whatsapp', 'correo', 'oficina'] as const;
export type IntakeChannel = (typeof INTAKE_CHANNELS)[number];