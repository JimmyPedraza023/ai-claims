import { Inject, Injectable } from '@nestjs/common';
import type { DocumentIssue } from '../../common/domain/enums';
import { DatabaseService } from '../../database/database.service';
import { AUDIT_EVENTS } from '../audit/event-types';
import { AuditService } from '../audit/audit.service';
import { ClaimsRepository } from '../claims/claims.repository';
import { DocumentsRepository, type DocumentForAnalysis } from '../documents/documents.repository';
import { FILE_STORAGE, type FileStorage } from '../documents/file-storage';
import { PermanentJobError, type ClaimedJob } from '../jobs/job-queue';
import { JobsRepository } from '../jobs/jobs.repository';
import { AnalysisRecorder } from './analysis-recorder';
import { LLM_PROVIDER, LlmError, type LlmProvider, type LlmResult } from './llm-provider';
import { POLICY_VERSION } from './classification.policy';
import type { DocumentAnalysis } from './classification.schemas';
import { DOCUMENT_PREPARER, type DocumentPreparer, type PreparedDocument } from './preparation/document-preparer';
import { UnreadableDocumentError } from './preparation/unreadable-document.error';

@Injectable()
export class AnalyzeDocumentHandler {
  constructor(
    private readonly db: DatabaseService,
    private readonly claims: ClaimsRepository,
    private readonly documents: DocumentsRepository,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    @Inject(DOCUMENT_PREPARER) private readonly preparer: DocumentPreparer,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    private readonly recorder: AnalysisRecorder,
    private readonly audit: AuditService,
    private readonly jobs: JobsRepository,
  ) {}

  async execute(job: ClaimedJob, signal: AbortSignal): Promise<void> {
    if (!job.documentId) throw new PermanentJobError('El trabajo de análisis no trae documento');
    const doc = await this.documents.findForAnalysis(this.db, job.documentId);
    if (!doc) throw new PermanentJobError('El documento no existe');
    // Ya analizado (un reintento tardío) o corregido por una persona: no hay nada que hacer.
    if (doc.status !== 'pendiente_analisis') return;
    const claim = await this.claims.findById(this.db, doc.claimId);
    if (!claim) throw new PermanentJobError('El caso del documento no existe');

    let prepared: PreparedDocument;
    try {
      prepared = await this.preparer.prepare({
        mimeType: doc.mimeType,
        data: await this.storage.read(doc.storagePath),
      });
    } catch (e) {
      if (e instanceof UnreadableDocumentError) {
        // Culpa del archivo: no se llama al modelo ni se reintenta.
        await this.markUnprocessable(doc, 'archivo_danado', e.reason, e.message);
        return;
      }
      await this.degradeIfFinal(job, doc, e);
      throw e;
    }

    // Qué se envió, sin contenido: nada de nombres ni números de documento.
    const inputRef = {
      sha256: doc.sha256,
      mimeType: doc.mimeType,
      totalPages: prepared.totalPages,
      usedPages: prepared.usedPages,
      truncated: prepared.truncated,
      imageBytes: prepared.imageBytes,
    };

    let result: LlmResult<DocumentAnalysis>;
    try {
      // Sin transacción abierta: la llamada puede tardar un minuto.
      result = await this.llm.analyzeDocument(
        {
          images: prepared.images,
          insured: { fullName: claim.insuredFullName, documentNumber: claim.insuredDocumentNumber },
          beneficiary: { fullName: claim.beneficiaryFullName, documentNumber: claim.beneficiaryDocumentNumber },
        },
        signal,
      );
    } catch (e) {
      await this.db.withTransaction((c) =>
        this.recorder.recordFailure(c, {
          claimId: doc.claimId, documentId: doc.id, task: 'analizar_documento',
          provider: this.llm.providerName, fallbackModel: this.llm.modelName, inputRef, error: e,
        }),
      );
      await this.degradeIfFinal(job, doc, e);
      throw e; // el runner decide si se reintenta
    }

    await this.db.withTransaction(async (c) => {
      const out = await this.recorder.recordDocumentAnalysis(c, {
        claimId: doc.claimId, documentId: doc.id, provider: this.llm.providerName,
        inputRef: { ...inputRef, promptTokens: result.meta.promptTokens, completionTokens: result.meta.completionTokens },
        result, partial: prepared.truncated,
      });
      if (!out.applied) return; // ya lo había resuelto otro intento o una persona
      await this.audit.record(c, {
        claimId: doc.claimId, type: AUDIT_EVENTS.DOCUMENTO_ANALIZADO, actor: 'modelo',
        payload: {
          documentId: doc.id, aiRunId: out.aiRunId, status: out.fields.status, issue: out.fields.issue,
          reason: out.verdict.reason, policyVersion: POLICY_VERSION, promptVersion: result.meta.promptVersion,
        },
      });
      await this.enqueueEvaluation(c, doc);
    });
  }

  /** Último intento (o error sin remedio): el documento pasa a una persona en vez de quedar pendiente para siempre. */
  private async degradeIfFinal(job: ClaimedJob, doc: DocumentForAnalysis, e: unknown): Promise<void> {
    const noRetry = typeof e === 'object' && e !== null && (e as { retryable?: unknown }).retryable === false;
    if (job.attempts < job.maxAttempts && !noRetry) return;
    const kind = e instanceof LlmError ? e.kind : 'error_interno';
    await this.markUnprocessable(doc, 'otro', 'analisis_automatico_fallido', `El análisis automático falló (${kind})`);
  }

  private async markUnprocessable(
    doc: DocumentForAnalysis, issue: DocumentIssue, reasonCode: string, detail: string,
  ): Promise<void> {
    await this.db.withTransaction(async (c) => {
      const applied = await this.recorder.recordUnprocessable(c, { documentId: doc.id, issue, detail, reasonCode });
      if (!applied) return;
      await this.audit.record(c, {
        claimId: doc.claimId, type: AUDIT_EVENTS.DOCUMENTO_NO_PROCESADO, actor: 'sistema',
        payload: { documentId: doc.id, issue, reason: reasonCode },
      });
      await this.enqueueEvaluation(c, doc);
    });
  }

  /** Cada documento resuelto pide re-evaluar el expediente. La llave evita duplicados. */
  private enqueueEvaluation(c: Parameters<JobsRepository['enqueue']>[0], doc: DocumentForAnalysis) {
    return this.jobs.enqueue(c, {
      kind: 'evaluar_completitud', claimId: doc.claimId, documentId: doc.id,
      dedupeKey: `evaluar:${doc.claimId}:doc:${doc.id}`,
    });
  }
}