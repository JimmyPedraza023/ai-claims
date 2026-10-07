import type { DocumentAnalysis, ClaimClassification, DocumentType } from './classification.schemas.ts';

export type LlmErrorKind =
  | 'timeout' | 'rate_limited' | 'unavailable'   // transitorios: se reintenta
  | 'invalid_output'                              // el modelo respondió basura: se reintenta pocas veces
  | 'refused' | 'bad_request';                    // no tiene sentido reintentar

const RETRYABLE: Record<LlmErrorKind, boolean> = {
  timeout: true, rate_limited: true, unavailable: true, invalid_output: true,
  refused: false, bad_request: false,
};

export interface LlmCallMeta {
  model: string;
  promptVersion: string;
  latencyMs: number;
  promptTokens?: number;
  completionTokens?: number;
  rawOutput: string | null;
}

export class LlmError extends Error {
  readonly retryable: boolean;
  constructor(
    readonly kind: LlmErrorKind,
    message: string,
    readonly meta?: Partial<LlmCallMeta>, // para registrar el fallo en ai_runs
  ) {
    super(message);
    this.name = 'LlmError';
    this.retryable = RETRYABLE[kind];
  }
}

export interface LlmImage {
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  base64: string;
}

export interface AnalyzeDocumentInput {
  images: LlmImage[];
  insured: { fullName: string; documentNumber: string };
  beneficiary: { fullName: string; documentNumber: string };
}

export interface ClassifyClaimInput {
  narrative: string;
  documents: { documentType: DocumentType }[];
}

export interface LlmResult<T> {
  data: T;
  meta: LlmCallMeta;
}

export interface LlmProvider {
  readonly providerName: string;
  readonly modelName: string;
  analyzeDocument(input: AnalyzeDocumentInput, signal?: AbortSignal): Promise<LlmResult<DocumentAnalysis>>;
  classifyClaim(input: ClassifyClaimInput, signal?: AbortSignal): Promise<LlmResult<ClaimClassification>>;
}

export const LLM_PROVIDER = Symbol('LLM_PROVIDER'); // token de inyección de Nest, sin importar Nest