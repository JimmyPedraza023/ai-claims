import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_EVENTS } from '../audit/event-types';
import type { AuthUser } from '../auth/jwt-auth.guard';
import { ClaimsRepository } from '../claims/claims.repository';
import { JobsRepository } from '../jobs/jobs.repository';
import { draftRequestedDocumentsNotice } from '../notifications/notification-drafts';
import { NotificationsRepository } from '../notifications/notifications.repository';
import type { DecisionInput } from './decisions.schema';
import { checkDecisionAllowed, closedStatusFor, isClosingDecision } from './decisions.rules';
import { DecisionsRepository } from './decisions.repository';

export interface DecisionResult {
  decisionId: string;
  kind: DecisionInput['kind'];
  decidedAt: Date;
  /** Estado del caso después de la decisión. */
  claimStatus: string;
  /** La decisión se tomó con el plazo ya vencido (queda marcado en la bitácora). */
  afterDeadline: boolean;
}

const UNIQUE_VIOLATION = '23505';

@Injectable()
export class DecisionsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly claims: ClaimsRepository,
    private readonly decisions: DecisionsRepository,
    private readonly notifications: NotificationsRepository,
    private readonly jobs: JobsRepository,
    private readonly audit: AuditService,
  ) {}

  /**
   * La frontera humano/modelo: solo una persona autenticada decide, y todo queda a su nombre.
   * Una sola transacción que bloquea el caso: dos analistas no pueden decidir a la vez ni cruzarse
   * con la evaluación del worker.
   */
  async register(user: AuthUser, claimId: string, input: DecisionInput): Promise<DecisionResult> {
    return this.db.withTransaction(async (c) => {
      const claim = await this.claims.findByIdForUpdate(c, claimId);
      if (!claim) throw new NotFoundException();

      // Antes de escribir nada: un rechazo no deja rastro.
      const refusal = checkDecisionAllowed({ status: claim.status, closedAt: claim.closedAt }, input.kind);
      if (refusal) throw new ConflictException(refusal);

      const requested = input.requestedDocuments ? [...new Set(input.requestedDocuments)] : null;
      const evaluationId = await this.decisions.latestEvaluationId(c, claimId);
      const afterDeadline = await this.decisions.isPastDeadline(c, claimId);

      let decision: { id: string; decidedAt: Date };
      try {
        decision = await this.decisions.insert(c, {
          claimId, kind: input.kind, decidedBy: user.id, reason: input.reason,
          requestedDocuments: requested, evaluationId,
        });
      } catch (err) {
        // Segunda barrera: el índice único de un solo cierre por caso.
        if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
          throw new ConflictException('Este caso ya fue resuelto');
        }
        throw err;
      }

      let claimStatus: string = claim.status;
      if (isClosingDecision(input.kind)) {
        claimStatus = closedStatusFor(input.kind);
        if (!(await this.claims.closeClaim(c, claimId, claimStatus as 'pagada' | 'objetada'))) {
          throw new Error('No se pudo cerrar el caso'); // no debería pasar: la fila está bloqueada
        }
      } else {
        const draft = draftRequestedDocumentsNotice(claimId, decision.id, requested!, claim.status !== 'completa');
        const notificationId = await this.notifications.insertIfNew(c, {
          claimId, kind: draft.kind, recipient: claim.beneficiaryEmail,
          subject: draft.subject, body: draft.body, dedupeKey: draft.dedupeKey,
        });
        if (notificationId) {
          await this.jobs.enqueue(c, {
            kind: 'enviar_aviso', claimId, notificationId, dedupeKey: `aviso:${notificationId}`,
          });
        }
      }

      // La bitácora no lleva datos personales: ni el motivo escrito por el analista ni nombres.
      await this.audit.record(c, {
        claimId, type: AUDIT_EVENTS.DECISION_REGISTRADA, actor: 'analista', actorUserId: user.id,
        payload: {
          decisionId: decision.id, kind: input.kind, evaluationId, afterDeadline,
          claimStatusBefore: claim.status, ...(requested ? { requestedDocuments: requested } : {}),
        },
      });

      return { decisionId: decision.id, kind: input.kind, decidedAt: decision.decidedAt, claimStatus, afterDeadline };
    });
  }
}