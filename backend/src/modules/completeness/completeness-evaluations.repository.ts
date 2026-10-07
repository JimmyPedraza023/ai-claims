import { Injectable } from '@nestjs/common';
import type { ClaimType } from '../../common/domain/enums';
import { Queryable } from '../../database/queryable';

export interface NewEvaluation {
  claimId: string;
  claimType: ClaimType;
  rulesVersion: string;
  isComplete: boolean;
  /** Resultado completo de evaluateCompleteness (solo ids y tipos: sin datos personales). */
  result: unknown;
}

@Injectable()
export class CompletenessEvaluationsRepository {
  /** Solo inserción: la tabla no admite cambios ni borrados. */
  async insert(client: Queryable, e: NewEvaluation): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO completeness_evaluations (claim_id, claim_type, rules_version, is_complete, result)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING id`,
      [e.claimId, e.claimType, e.rulesVersion, e.isComplete, JSON.stringify(e.result)],
    );
    return rows[0].id;
  }
}