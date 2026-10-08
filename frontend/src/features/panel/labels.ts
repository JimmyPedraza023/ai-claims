export function humanize(code: string): string {
  const text = code.toLowerCase().replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Etiqueta conocida o, si el valor es nuevo, el código legible: el panel nunca se rompe por un valor que no conoce. */
export function labelOf(map: Record<string, string>, key: string): string {
  return map[key] ?? humanize(key);
}

export const CLAIM_STATUS_LABELS: Record<string, string> = {
  completa: 'Expediente completo',
  pagada: 'Pagada',
  objetada: 'Objetada',
};

export const DOCUMENT_STATUS_LABELS: Record<string, string> = {
  valido: 'Válido',
  invalido: 'No sirve',
  requiere_revision: 'Requiere revisión',
  pendiente_analisis: 'Pendiente de análisis',
};

export const REQUIREMENT_STATUS_LABELS: Record<string, string> = {
  valido: 'Válido',
  en_revision: 'En revisión',
  invalido: 'No sirve',
  faltante: 'Falta',
};

export const SUBJECT_LABELS: Record<string, string> = {
  tipo_reclamacion: 'Tipo de reclamación',
  tipo_documento: 'Tipo de documento',
  validez_documento: 'Validez del documento',
};

export const TASK_LABELS: Record<string, string> = {
  analizar_documento: 'Análisis de documento',
  clasificar_reclamacion: 'Clasificación del tipo de reclamación',
};

export const ACTOR_LABELS: Record<string, string> = {
  beneficiario: 'Beneficiario',
  sistema: 'Sistema',
  modelo: 'Modelo de IA',
  analista: 'Analista',
};

export const EVENT_LABELS: Record<string, string> = {
  documento_recibido: 'Documento recibido',
  documento_duplicado_ignorado: 'Documento repetido (ignorado)',
  envio_duplicado_ignorado: 'Envío repetido (ignorado)',
  complemento_recibido: 'Documentos adicionales recibidos',
  tipo_reclamacion_asignado: 'Tipo de reclamación asignado',
  clasificacion_requiere_revision: 'Clasificación enviada a revisión',
  clasificacion_fallida: 'Clasificación fallida',
  expediente_evaluado: 'Expediente evaluado',
  expediente_completo: 'Expediente completo: arranca el plazo',
  documento_no_procesado: 'Documento no procesado',
};