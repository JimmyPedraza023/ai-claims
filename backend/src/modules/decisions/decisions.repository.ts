import { Injectable } from '@nestjs/common';
import type { DocumentType } from '../../common/domain/enums';
import { Queryable } from '../../database/queryable';
import type { DecisionKind } from './decisions.rules';

export interface NewDecision {
  claimId: string;
  kind: DecisionKind;
  decidedBy: string;
  reason: string;
  requestedDocuments: DocumentType[] | null;
  /** La evaluación de completitud que el analista tenía a la vista. */
  evaluationId: string | null;
}

@Injectable()
export class DecisionsRepository {
  async insert(c: Queryable, d: NewDecision): Promise<{ id: string; decidedAt: Date }> {
    const { rows } = await c.query<{ id: string; decided_at: Date }>(
      `INSERT INTO decisions (claim_id, kind, decided_by, reason, requested_documents, evaluation_id)
       VALUES ($1, $2, $3, $4, $5::document_type[], $6)
       RETURNING id, decided_at`,
      [d.claimId, d.kind, d.decidedBy, d.reason, d.requestedDocuments, d.evaluationId],
    );
    return { id: rows[0].id, decidedAt: rows[0].decided_at };
  }

  async latestEvaluationId(c: Queryable, claimId: string): Promise<string | null> {
    const { rows } = await c.query<{ id: string }>(
      `SELECT id FROM completeness_evaluations
        WHERE claim_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
      [claimId],
    );
    return rows[0]?.id ?? null;
  }

  /** ¿Ya pasó el último día del plazo (hora de Colombia)? Sin reloj, false. */
  async isPastDeadline(c: Queryable, claimId: string): Promise<boolean> {
    const { rows } = await c.query<{ past: boolean }>(
      `SELECT COALESCE((now() AT TIME ZONE 'America/Bogota')::date > deadline_date, false) AS past
         FROM claims WHERE id = $1`,
      [claimId],
    );
    return rows[0]?.past ?? false;
  }
}