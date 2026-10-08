import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { ClaimType } from '../../common/domain/enums';
import { DatabaseService } from '../../database/database.service';
import type { Queryable } from '../../database/queryable';
import { AuditService } from '../audit/audit.service';
import { AUDIT_EVENTS } from '../audit/event-types';
import type { AuthUser } from '../auth/jwt-auth.guard';
import { ClaimsRepository } from '../claims/claims.repository';
import { ClassificationsRepository } from '../classification/classifications.repository';
import { evaluateCompleteness } from '../completeness/completeness';
import { DocumentsRepository } from '../documents/documents.repository';
import { JobsRepository } from '../jobs/jobs.repository';
import {
  buildCorrectionNotice, summarizeCompleteness, type CompletenessSummary,
} from './corrections.notice';
import type { DocumentCorrectionInput } from './corrections.schema';

export type CorrectionResult =
  | { changed: false }
  | { changed: true; clockUnchanged: boolean; notice: string | null; completeness: CompletenessSummary | null };

@Injectable()
export class CorrectionsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly claims: ClaimsRepository,
    private readonly documents: DocumentsRepository,
    private readonly classifications: ClassificationsRepository,
    private readonly jobs: JobsRepository,
    private readonly audit: AuditService,
  ) {}

  /**
   * Cambia el tipo de reclamación. Se permite también con el caso 'completa': el reloj no se mueve
   * (supuesto #3), la corrección queda registrada para la métrica y la respuesta dice cómo queda el expediente.
   */
  async correctClaimType(user: AuthUser, claimId: string, newType: ClaimType): Promise<CorrectionResult> {
    return this.db.withTransaction(async (c) => {
      const claim = await this.claims.findByIdForUpdate(c, claimId);
      if (!claim) throw new NotFoundException();
      if (claim.closedAt) throw new ConflictException('Este caso ya fue resuelto; su tipo no se modifica');

      const prediction = await this.classifications.latestFor(c, claimId, 'tipo_reclamacion', null);
      const typeChanges = claim.claimType !== newType;
      // Confirmar lo que dijo el modelo también cuenta como revisión: entra en el denominador de la tasa.
      const needsReview = prediction !== null && prediction.finalValue !== newType;
      if (!typeChanges && !needsReview) return { changed: false };

      if (prediction && needsReview) await this.classifications.review(c, prediction.id, newType, user.id);
      if (typeChanges) await this.claims.setClaimType(c, claimId, newType);

      const after = await this.afterCorrection(c, claimId, claim.status);
      await this.audit.record(c, {
        claimId, type: AUDIT_EVENTS.CLASIFICACION_CORREGIDA, actor: 'analista', actorUserId: user.id,
        payload: {
          subject: 'tipo_reclamacion',
          previous: claim.claimType, final: newType, predicted: prediction?.predictedValue ?? null,
          claimStatus: claim.status, clockUnchanged: after.clockUnchanged,
          ...(after.completeness ? { completeness: after.completeness } : {}),
        },
      });
      return { changed: true, ...after };
    });
  }

  async correctDocument(
    user: AuthUser, claimId: string, documentId: string, input: DocumentCorrectionInput,
  ): Promise<CorrectionResult> {
    return this.db.withTransaction(async (c) => {
      const claim = await this.claims.findByIdForUpdate(c, claimId);
      if (!claim) throw new NotFoundException();
      if (claim.closedAt) throw new ConflictException('Este caso ya fue resuelto');

      const doc = (await this.documents.listByClaim(c, claimId)).find((d) => d.id === documentId);
      if (!doc) throw new NotFoundException();
      if (doc.status === 'pendiente_analisis') {
        throw new ConflictException('El documento todavía se está analizando');
      }

      const issue = input.issue ?? null;
      if (doc.type === input.documentType && doc.status === input.status && (doc.issue ?? null) === issue) {
        return { changed: false };
      }

      const applied = await this.documents.applyHumanCorrection(c, documentId, {
        type: input.documentType, status: input.status, issue,
      });
      if (!applied) throw new ConflictException('El documento todavía se está analizando');

      // Las dos predicciones del documento. Si el sistema no pudo analizarlo (archivo dañado, modelo caído),
      // no hay predicción y esta corrección no entra en la métrica: no hubo nada que corregir.
      const typePrediction = await this.classifications.latestFor(c, claimId, 'tipo_documento', documentId);
      if (typePrediction) await this.classifications.review(c, typePrediction.id, input.documentType, user.id);
      const validityPrediction = await this.classifications.latestFor(c, claimId, 'validez_documento', documentId);
      if (validityPrediction) await this.classifications.review(c, validityPrediction.id, input.status, user.id);

      const after = await this.afterCorrection(c, claimId, claim.status);
      await this.audit.record(c, {
        claimId, type: AUDIT_EVENTS.DOCUMENTO_CORREGIDO, actor: 'analista', actorUserId: user.id,
        payload: {
          documentId,
          previous: { type: doc.type, status: doc.status, issue: doc.issue },
          final: { type: input.documentType, status: input.status, issue },
          claimStatus: claim.status, clockUnchanged: after.clockUnchanged,
          ...(after.completeness ? { completeness: after.completeness } : {}),
        },
      });
      return { changed: true, ...after };
    });
  }

  /**
   * Sin reloj ('recibida' o 'incompleta'): se vuelve a evaluar con el worker.
   * Con reloj ('completa'): no se mueve nada; se calcula, sin guardar, cómo queda el expediente.
   */
  private async afterCorrection(c: Queryable, claimId: string, status: string) {
    if (status === 'recibida' || status === 'incompleta') {
      await this.jobs.enqueue(c, {
        kind: 'evaluar_completitud', claimId,
        dedupeKey: `evaluar:${claimId}:correccion:${randomUUID()}`,
      });
      return { clockUnchanged: false, notice: null, completeness: null };
    }
    const claim = await this.claims.findById(c, claimId); // ya con el tipo nuevo, dentro de la misma transacción
    const docs = await this.documents.listByClaim(c, claimId);
    const completeness = claim?.claimType
      ? summarizeCompleteness(evaluateCompleteness(claim.claimType, docs))
      : null;
    return { clockUnchanged: true, notice: buildCorrectionNotice(completeness), completeness };
  }
}