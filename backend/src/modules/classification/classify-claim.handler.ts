import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_EVENTS } from '../audit/event-types';
import { ClaimsRepository } from '../claims/claims.repository';
import { DocumentsRepository } from '../documents/documents.repository';
import { isFinalFailure, PermanentJobError, type ClaimedJob } from '../jobs/job-queue';
import { JobsRepository } from '../jobs/jobs.repository';
import { AnalysisRecorder } from './analysis-recorder';
import { POLICY_VERSION, type ExistingClaimType } from './classification.policy';
import type { ClaimClassification } from './classification.schemas';
import { LLM_PROVIDER, LlmError, type LlmProvider, type LlmResult } from './llm-provider';

@Injectable()
export class ClassifyClaimHandler {
  constructor(
    private readonly db: DatabaseService,
    private readonly claims: ClaimsRepository,
    private readonly documents: DocumentsRepository,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    private readonly recorder: AnalysisRecorder,
    private readonly audit: AuditService,
    private readonly jobs: JobsRepository,
  ) {}

  async execute(job: ClaimedJob, signal: AbortSignal): Promise<void> {
    const claim = await this.claims.findById(this.db, job.claimId);
    if (!claim) throw new PermanentJobError('El caso no existe');
    if (claim.status === 'pagada' || claim.status === 'objetada') return; // cerrado: nada que clasificar

    // Los documentos ya analizados ayudan al modelo (un informe de policía sugiere muerte accidental).
    const docs = await this.documents.listByClaim(this.db, claim.id);
    const documentTypes = [
      ...new Set(docs.flatMap((d) => (d.type && d.type !== 'otro' && d.type !== 'no_identificado' ? [d.type] : []))),
    ];
    // Qué se envió, sin contenido: ni el relato ni nombres.
    const inputRef = { narrativeLength: claim.narrative.length, documentTypes };

    let result: LlmResult<ClaimClassification>;
    try {
      result = await this.llm.classifyClaim(
        { narrative: claim.narrative, documents: documentTypes.map((documentType) => ({ documentType })) },
        signal,
      );
    } catch (e) {
      await this.db.withTransaction((c) =>
        this.recorder.recordFailure(c, {
          claimId: claim.id, documentId: null, task: 'clasificar_reclamacion',
          provider: this.llm.providerName, fallbackModel: this.llm.modelName, inputRef, error: e,
        }),
      );
      if (isFinalFailure(job, e)) {
        const reason = e instanceof LlmError ? e.kind : 'error_interno';
        await this.db.withTransaction((c) =>
          this.audit.record(c, {
            claimId: claim.id, type: AUDIT_EVENTS.CLASIFICACION_FALLIDA, actor: 'sistema', payload: { reason },
          }),
        );
      }
      throw e; // el runner decide si se reintenta
    }

    await this.db.withTransaction(async (c) => {
      // Mismo bloqueo que la subida desde el seguimiento: no se cruzan sobre el mismo caso.
      const locked = await this.claims.findByIdForUpdate(c, claim.id);
      if (!locked) throw new PermanentJobError('El caso desapareció');

      const humanReviewed = locked.claimType ? await this.claims.hasHumanTypeReview(c, claim.id) : false;
      const existing: ExistingClaimType = {
        claimType: locked.claimType,
        source: locked.claimType ? (humanReviewed ? 'persona' : 'modelo') : null,
      };

      const { aiRunId, decision } = await this.recorder.recordClaimClassification(c, {
        claimId: claim.id, provider: this.llm.providerName,
        inputRef: { ...inputRef, promptTokens: result.meta.promptTokens, completionTokens: result.meta.completionTokens },
        result, existing,
      });

      if (decision.shouldWrite && decision.claimType) {
        await this.claims.setClaimTypeIfEmpty(c, claim.id, decision.claimType);
        await this.audit.record(c, {
          claimId: claim.id, type: AUDIT_EVENTS.TIPO_RECLAMACION_ASIGNADO, actor: 'modelo',
          payload: {
            claimType: decision.claimType, aiRunId,
            confidence: result.data.claimType.confidence, policyVersion: POLICY_VERSION,
          },
        });
      }
      if (decision.reviewRequired) {
        await this.audit.record(c, {
          claimId: claim.id, type: AUDIT_EVENTS.CLASIFICACION_REQUIERE_REVISION, actor: 'sistema',
          payload: { reason: decision.reason, aiRunId },
        });
      }
      // Re-evaluar el expediente con el tipo (si lo hay). La llave evita duplicados por reintento.
      await this.jobs.enqueue(c, {
        kind: 'evaluar_completitud', claimId: claim.id, dedupeKey: `evaluar:${claim.id}:clasif:${job.id}`,
      });
    });
  }
}