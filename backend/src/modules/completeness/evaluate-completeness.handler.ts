import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { Queryable } from '../../database/queryable';
import { AuditService } from '../audit/audit.service';
import { AUDIT_EVENTS } from '../audit/event-types';
import { ClaimsRepository } from '../claims/claims.repository';
import { DocumentsRepository } from '../documents/documents.repository';
import { PermanentJobError, type ClaimedJob } from '../jobs/job-queue';
import { JobsRepository } from '../jobs/jobs.repository';
import { computeDeadline } from '../legal-clock/legal-clock';
import { evaluateCompleteness } from './completeness';
import { CompletenessEvaluationsRepository } from './completeness-evaluations.repository';
import { decideStatusChange } from './completeness.transition';

@Injectable()
export class EvaluateCompletenessHandler {
  constructor(
    private readonly db: DatabaseService,
    private readonly claims: ClaimsRepository,
    private readonly documents: DocumentsRepository,
    private readonly evaluations: CompletenessEvaluationsRepository,
    private readonly audit: AuditService,
    private readonly jobs: JobsRepository,
  ) {}

  /** Sin llamadas al modelo: una sola transacción corta que bloquea el caso. */
  async execute(job: ClaimedJob): Promise<void> {
    await this.db.withTransaction(async (c) => {
      const claim = await this.claims.findByIdForUpdate(c, job.claimId);
      if (!claim) throw new PermanentJobError('El caso no existe');

      // El reloj es un hecho: con el expediente ya completo (o el caso cerrado) no se evalúa hacia atrás.
      if (claim.status !== 'recibida' && claim.status !== 'incompleta') return;

      const docs = await this.documents.listByClaim(c, claim.id);
      // El último documento en terminar su análisis vuelve a pedir esta evaluación.
      if (docs.some((d) => d.status === 'pendiente_analisis')) return;

      if (!claim.claimType) {
        // Todo analizado y el caso sigue sin tipo: se intenta UNA vez más, ahora con los documentos.
        const hasKnownDocs = docs.some((d) => d.type && d.type !== 'otro' && d.type !== 'no_identificado');
        if (hasKnownDocs) {
          await this.jobs.enqueue(c, {
            kind: 'clasificar_reclamacion', claimId: claim.id, dedupeKey: `reclasificar:${claim.id}`,
          });
        }
        return;
      }

      const result = evaluateCompleteness(claim.claimType, docs);
      const evaluationId = await this.evaluations.insert(c, {
        claimId: claim.id, claimType: claim.claimType, rulesVersion: result.rulesVersion,
        isComplete: result.isComplete, result,
      });

      const action = decideStatusChange(claim.status, result.isComplete);
      let deadlineDate: string | null = null;
      if (action === 'iniciar_reloj') {
        const completedAt = await this.databaseNow(c);
        deadlineDate = computeDeadline(completedAt);
        if (!(await this.claims.startClock(c, claim.id, completedAt, deadlineDate))) {
          throw new Error('No se pudo arrancar el reloj del caso'); // no debería pasar: la fila está bloqueada
        }
      } else if (action === 'marcar_incompleta') {
        await this.claims.markIncomplete(c, claim.id);
      }

      // Solo tipos, estados e ids: la bitácora no puede llevar datos personales.
      await this.audit.record(c, {
        claimId: claim.id, type: AUDIT_EVENTS.EXPEDIENTE_EVALUADO, actor: 'sistema',
        payload: {
          evaluationId, claimType: claim.claimType, rulesVersion: result.rulesVersion, isComplete: result.isComplete,
          missing: result.missing,
          invalid: result.invalid.map((i) => ({ documentType: i.documentType, issue: i.issue })),
          inReview: result.inReview,
        },
      });
      if (action === 'iniciar_reloj') {
        await this.audit.record(c, {
          claimId: claim.id, type: AUDIT_EVENTS.EXPEDIENTE_COMPLETO, actor: 'sistema',
          payload: { evaluationId, deadlineDate },
        });
      }
      // Los avisos al beneficiario y al analista salen de aquí en la rama 9 (notificaciones).
    });
  }

  /** La hora la pone la base de datos, no el servidor del worker. */
  private async databaseNow(c: Queryable): Promise<Date> {
    const { rows } = await c.query<{ now: Date }>('SELECT clock_timestamp() AS now');
    return rows[0].now;
  }
}