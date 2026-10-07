/**
 * Registro único de los tipos de evento de la bitácora (claim_events.event_type).
 * Cada rama agrega aquí los suyos: así no hay textos sueltos repartidos por el
 * código y se ve de un vistazo qué cosas quedan registradas.
 */
export const AUDIT_EVENTS = {
  RECLAMACION_RECIBIDA: 'reclamacion_recibida',
  ENVIO_DUPLICADO_IGNORADO: 'envio_duplicado_ignorado',
  COMPLEMENTO_RECIBIDO: 'complemento_recibido',
  DOCUMENTO_RECIBIDO: 'documento_recibido',
  DOCUMENTO_DUPLICADO_IGNORADO: 'documento_duplicado_ignorado',
  DOCUMENTO_ANALIZADO: 'documento_analizado',
  DOCUMENTO_NO_PROCESADO: 'documento_no_procesado',
  TIPO_RECLAMACION_ASIGNADO: 'tipo_reclamacion_asignado',
  CLASIFICACION_REQUIERE_REVISION: 'clasificacion_requiere_revision',
  CLASIFICACION_FALLIDA: 'clasificacion_fallida',
} as const;

export type AuditEventType = (typeof AUDIT_EVENTS)[keyof typeof AUDIT_EVENTS];
