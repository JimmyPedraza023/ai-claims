export type UnreadableReason = 'corrupto' | 'protegido' | 'tipo_no_soportado';

/** El archivo no se puede abrir. Es culpa del archivo, no del sistema: no se reintenta. */
export class UnreadableDocumentError extends Error {
  constructor(readonly reason: UnreadableReason, message: string) {
    super(message);
    this.name = 'UnreadableDocumentError';
  }
}