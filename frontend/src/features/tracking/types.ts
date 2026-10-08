// Espejo de lo que devuelve el backend (backend/src/modules/intake/tracking.view.ts).
export type TrackingStage = 'revisando' | 'faltan_documentos' | 'completa' | 'cerrada';
export type ChecklistState = 'listo' | 'revisando' | 'falta' | 'no_sirve';

export interface TrackingChecklistItem {
  documentType: string;
  label: string;
  state: ChecklistState;
  /** Solo cuando el documento llegó y no sirve: qué pasó y qué hacer. */
  message: string | null;
}

export interface TrackingView {
  referenceCode: string;
  receivedAt: string;
  stage: TrackingStage;
  headline: string;
  documentsReceived: number;
  /** Vacía mientras no se sepa el tipo de reclamación. */
  checklist: TrackingChecklistItem[];
}

export interface UploadResponse {
  message: string;
  tracking: TrackingView;
}