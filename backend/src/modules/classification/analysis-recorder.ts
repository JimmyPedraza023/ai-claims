import { Injectable } from '@nestjs/common';
import { Queryable } from '../../database/queryable';
import { DocumentsRepository } from '../documents/documents.repository';
import { aiRunStatusFor } from './ai-run-status';
import { AiRunsRepository, type AiTask } from './ai-runs.repository';
import { ClassificationsRepository } from './classifications.repository';
import { verdictToDocumentFields, type DocumentFields } from './classification.mapping';
import {
  POLICY_VERSION, decideClaimType, evaluateDocument, validityConfidence,
  type ClaimTypeDecision, type DocumentVerdict, type ExistingClaimType,
} from './classification.policy';
import type { ClaimClassification, DocumentAnalysis } from './classification.schemas';
import { LlmError, type LlmResult } from './llm-provider';
import { PROMPT_VERSION } from './prompts';
import { DocumentIssue } from '../../common/domain/enums';

/** Recibe una conexión ya abierta (Queryable): quien orquesta decide qué va en la misma transacción. */

@Injectable()
export class AnalysisRecorder {
  constructor(
    private readonly aiRuns: AiRunsRepository,
    private readonly classifications: ClassificationsRepository,
    private readonly documents: DocumentsRepository,
  ) {}

  async recordDocumentAnalysis(
    client: Queryable,
    input: {
      claimId: string;
      documentId: string;
      provider: string;
      inputRef: Record<string, unknown>;
      result: LlmResult<DocumentAnalysis>;
      partial?: boolean
    },
  ): Promise<{ aiRunId: string; verdict: DocumentVerdict; fields: DocumentFields; applied: boolean }> {
    const { data, meta } = input.result;

    // El hecho (qué dijo el modelo) se registra siempre.
    const aiRunId = await this.aiRuns.insert(client, {
      claimId: input.claimId, documentId: input.documentId, task: 'analizar_documento',
      provider: input.provider, model: meta.model, promptVersion: meta.promptVersion,
      inputRef: input.inputRef, rawOutput: meta.rawOutput, parsedOutput: data,
      status: 'ok', error: null, latencyMs: meta.latencyMs,
    });

    const verdict = evaluateDocument(data, { partial: input.partial });
    const fields = verdictToDocumentFields(verdict);

    // Aplicarlo solo si el documento sigue pendiente.
    const applied = await this.documents.applyAnalysis(client, input.documentId, {
      type: fields.type, status: fields.status, issue: fields.issue,
      issueDetail: data.reason,
      extractedData: { analysis: data, verdict, policyVersion: POLICY_VERSION },
    });

    if (applied) {
      await this.classifications.insert(client, {
        claimId: input.claimId, documentId: input.documentId, aiRunId,
        subject: 'tipo_documento', predictedValue: data.documentType.value,
        confidence: data.documentType.confidence, evidence: data.reason,
      });
      await this.classifications.insert(client, {
        claimId: input.claimId, documentId: input.documentId, aiRunId,
        subject: 'validez_documento', predictedValue: fields.status,
        confidence: validityConfidence(data), evidence: data.reason,
      });
    }

    return { aiRunId, verdict, fields, applied };
  }

  async recordClaimClassification(
    client: Queryable,
    input: {
      claimId: string;
      provider: string;
      inputRef: Record<string, unknown>;
      result: LlmResult<ClaimClassification>;
      existing: ExistingClaimType;
    },
  ): Promise<{ aiRunId: string; decision: ClaimTypeDecision }> {
    const { data, meta } = input.result;

    const aiRunId = await this.aiRuns.insert(client, {
      claimId: input.claimId, documentId: null, task: 'clasificar_reclamacion',
      provider: input.provider, model: meta.model, promptVersion: meta.promptVersion,
      inputRef: input.inputRef, rawOutput: meta.rawOutput, parsedOutput: data,
      status: 'ok', error: null, latencyMs: meta.latencyMs,
    });

    // La predicción del modelo se guarda siempre, aunque la política decida no escribir claim_type.
    await this.classifications.insert(client, {
      claimId: input.claimId, documentId: null, aiRunId, subject: 'tipo_reclamacion',
      predictedValue: data.claimType.value, confidence: data.claimType.confidence, evidence: data.evidence,
    });

    // Escribir claims.claim_type es responsabilidad del handler (8e), que bloquea la fila del caso.
    return { aiRunId, decision: decideClaimType(data, input.existing) };
  }

  async recordFailure(
    client: Queryable,
    input: {
      claimId: string;
      documentId: string | null;
      task: AiTask;
      provider: string;
      fallbackModel: string;
      inputRef: Record<string, unknown>;
      error: unknown;
    },
  ): Promise<string> {
    const llm = input.error instanceof LlmError ? input.error : null;
    const kind = llm ? llm.kind : 'inesperado';
    const message = llm ? llm.message : input.error instanceof Error ? input.error.message : 'error desconocido';

    return this.aiRuns.insert(client, {
      claimId: input.claimId, documentId: input.documentId, task: input.task,
      provider: input.provider,
      model: llm?.meta?.model ?? input.fallbackModel,
      promptVersion: llm?.meta?.promptVersion ?? PROMPT_VERSION,
      inputRef: input.inputRef,
      rawOutput: llm?.meta?.rawOutput ?? null,
      parsedOutput: null,
      status: aiRunStatusFor(kind),
      error: `${kind}: ${message}`.slice(0, 500),
      latencyMs: llm?.meta?.latencyMs ?? null,
    });
  }

  /** Documento que el sistema no pudo analizar solo (archivo dañado, modelo caído): queda para una persona. */
  recordUnprocessable(
    client: Queryable,
    input: { documentId: string; issue: DocumentIssue; detail: string; reasonCode: string },
  ): Promise<boolean> {
    return this.documents.applyAnalysis(client, input.documentId, {
      type: 'no_identificado',
      status: 'requiere_revision',
      issue: input.issue,
      issueDetail: input.detail,
      extractedData: { automatic: false, reason: input.reasonCode, policyVersion: POLICY_VERSION },
    });
  }
}