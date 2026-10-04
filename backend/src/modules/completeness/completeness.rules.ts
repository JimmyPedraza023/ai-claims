import { ClaimType, DocumentType } from '../../common/domain/enums';

/**
 * Qué documentos exige cada tipo de reclamación (tabla de reglas del negocio).
 * Si las reglas cambian, se cambia aquí y se sube RULES_VERSION: cada evaluación
 * guardada en la base de datos registra con qué versión de las reglas se hizo.
 */
export const RULES_VERSION = '2026-10-v1';

const MUERTE_NATURAL: readonly DocumentType[] = [
  'formato_reclamacion',
  'registro_civil_defuncion',
  'certificado_medico_defuncion',
  'documento_identidad_asegurado',
  'documento_identidad_beneficiario',
  'formulario_sarlaft',
  'certificacion_bancaria',
];

export const REQUIRED_DOCUMENTS: Record<ClaimType, readonly DocumentType[]> = {
  muerte_natural: MUERTE_NATURAL,
  // "Todo lo anterior, más el informe de la autoridad competente".
  muerte_accidental: [...MUERTE_NATURAL, 'informe_autoridad'],
  // Ojo: el enunciado no pide documento de identidad del beneficiario aquí
  // (se asume que asegurado y beneficiario son la misma persona). Pendiente de confirmar.
  incapacidad_total_permanente: [
    'formato_reclamacion',
    'dictamen_perdida_capacidad_laboral',
    'historia_clinica_resumida',
    'documento_identidad_asegurado',
    'formulario_sarlaft',
    'certificacion_bancaria',
  ],
};