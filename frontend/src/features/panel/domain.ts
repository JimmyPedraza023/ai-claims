// Espejo de backend/src/modules/decisions/decisions.schema.ts y de los enums del dominio.
// Si cambian allá, hay que cambiarlos aquí.
export type DecisionKind = 'pagar' | 'objetar' | 'pedir_documentos';

export const DECISION_OPTIONS: { value: DecisionKind; label: string; description: string }[] = [
  {
    value: 'pagar',
    label: 'Pagar',
    description: 'Se reconoce la indemnización. El valor y el pago se gestionan fuera de este sistema.',
  },
  {
    value: 'objetar',
    label: 'Objetar',
    description: 'Se objeta formalmente la reclamación.',
  },
  {
    value: 'pedir_documentos',
    label: 'Pedir más documentos',
    description: 'Se piden documentos adicionales. Indica cuáles.',
  },
];

export const DOCUMENT_LABELS: Record<string, string> = {
  formato_reclamacion: 'Formato de reclamación',
  registro_civil_defuncion: 'Registro civil de defunción',
  certificado_medico_defuncion: 'Certificado médico de defunción',
  documento_identidad_asegurado: 'Documento de identidad del asegurado',
  documento_identidad_beneficiario: 'Documento de identidad del beneficiario',
  formulario_sarlaft: 'Formulario SARLAFT firmado',
  certificacion_bancaria: 'Certificación bancaria',
  informe_autoridad: 'Informe de la autoridad (policía o fiscalía)',
  dictamen_perdida_capacidad_laboral: 'Dictamen de pérdida de capacidad laboral',
  historia_clinica_resumida: 'Historia clínica resumida',
  otro: 'Otro documento',
  no_identificado: 'Documento sin identificar',
};

/** Los que un analista puede pedir: todos menos 'otro' y 'no_identificado'. */
export const REQUESTABLE_DOCUMENTS = [
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
] as const;

export const ISSUE_LABELS: Record<string, string> = {
  sin_firma: 'Sin firma',
  ilegible: 'Ilegible',
  no_corresponde_asegurado: 'No corresponde al asegurado',
  no_corresponde_beneficiario: 'No corresponde al beneficiario',
  tipo_no_reconocido: 'Tipo no reconocido',
  incompleto: 'Incompleto',
  archivo_danado: 'Archivo dañado',
  otro: 'Otro problema',
};

export const CLAIM_TYPE_LABELS: Record<string, string> = {
  muerte_natural: 'Muerte natural',
  muerte_accidental: 'Muerte accidental',
  incapacidad_total_permanente: 'Incapacidad total y permanente',
};

/** Para el selector de la corrección del tipo de reclamación (15e). */
export const CLAIM_TYPES = Object.keys(CLAIM_TYPE_LABELS);