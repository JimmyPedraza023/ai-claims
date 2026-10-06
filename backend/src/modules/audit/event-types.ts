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
} as const;

export type AuditEventType = (typeof AUDIT_EVENTS)[keyof typeof AUDIT_EVENTS];