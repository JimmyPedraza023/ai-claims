// Espejo de lo que devuelve backend/src/modules/panel/panel.repository.ts y audit.service.ts.
export interface ClockInfo {
  deadlineDate: string | null;
  daysElapsed: number | null;
  daysTotal: number | null;
  daysRemaining: number | null;
  /** 'vencido' | 'en_riesgo' | 'en_plazo'; otro valor o null = sin reloj todavía. */
  clockState: string | null;
}

export interface CaseRow extends ClockInfo {
  claimId: string;
  referenceCode: string;
  status: string;
  claimType: string | null;
  receivedAt: string;
  docsInReview: number;
}

export interface CasesResponse {
  claims: CaseRow[];
  limit: number;
  offset: number;
}

/** Solo los campos que se sabe que existen (los usa tracking.view.ts). El resto se lee con cuidado. */
export type ClaimSummary = {
  referenceCode: string;
  status: string;
  claimType: string | null;
  receivedAt: string;
} & Record<string, unknown>;

export interface DocumentDetail {
  id: string;
  type: string;
  status: string;
  issue: string | null;
  issueDetail: string | null;
  extractedData: unknown;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
}

export interface Evaluation {
  id: string;
  claimType: string;
  rulesVersion: string;
  isComplete: boolean;
  result: unknown;
  createdAt: string;
}

export interface Classification {
  id: string;
  documentId: string | null;
  subject: string;
  predictedValue: unknown;
  confidence: number | string | null;
  evidence: unknown;
  finalValue: unknown;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface AiRun {
  id: string;
  task: string;
  documentId: string | null;
  model: string;
  status: string;
  latencyMs: number | null;
  error: string | null;
  createdAt: string;
}

export interface DecisionRecord {
  id: string;
  kind: string;
  reason: string;
  requestedDocuments: string[] | null;
  evaluationId: string | null;
  decidedAt: string;
  decidedByName: string;
}

export interface TimelineEntry {
  eventId: number;
  occurredAt: string;
  eventType: string;
  actor: string;
  actorName: string | null;
  payload: Record<string, unknown>;
}

export interface CaseDetail {
  claim: ClaimSummary;
  clock: ClockInfo | null;
  documents: DocumentDetail[];
  evaluation: Evaluation | null;
  classifications: Classification[];
  aiRuns: AiRun[];
  decisions: DecisionRecord[];
  timeline: TimelineEntry[];
}