import {
  LlmError, type AnalyzeDocumentInput, type ClassifyClaimInput, type LlmProvider, type LlmResult,
} from '../llm-provider.js';
import type { ClaimClassification, DocumentAnalysis } from '../classification.schemas.ts';

export interface FakeScript {
  analyzeDocument?: (input: AnalyzeDocumentInput) => DocumentAnalysis;
  classifyClaim?: (input: ClassifyClaimInput) => ClaimClassification;
  error?: LlmError; // si se define, toda llamada falla con este error
}

const meta = () => ({ model: 'fake', promptVersion: 'fake-v1', latencyMs: 0, rawOutput: null });

export class FakeLlmProvider implements LlmProvider {
  readonly calls = { analyzeDocument: 0, classifyClaim: 0 };
  constructor(private readonly script: FakeScript = {}) {}
  readonly providerName = 'fake';
  readonly modelName = 'fake';

  async analyzeDocument(input: AnalyzeDocumentInput): Promise<LlmResult<DocumentAnalysis>> {
    this.calls.analyzeDocument++;
    if (this.script.error) throw this.script.error;
    const data = this.script.analyzeDocument?.(input) ?? {
      documentType: { value: 'otro' as const, confidence: 1 },
      legible: { value: true, confidence: 1 },
      signed: { value: null, confidence: 1 },
      matchesInsured: { value: null, confidence: 1 },
      reason: 'respuesta simulada',
    };
    return { data, meta: meta() };
  }

  async classifyClaim(input: ClassifyClaimInput): Promise<LlmResult<ClaimClassification>> {
    this.calls.classifyClaim++;
    if (this.script.error) throw this.script.error;
    const data = this.script.classifyClaim?.(input) ?? {
      claimType: { value: 'muerte_natural' as const, confidence: 1 },
      evidence: 'respuesta simulada',
    };
    return { data, meta: meta() };
  }
}