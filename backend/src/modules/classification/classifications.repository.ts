import { Injectable } from '@nestjs/common';
import { Queryable } from '../../database/queryable';

export type ClassificationSubject = 'tipo_reclamacion' | 'tipo_documento' | 'validez_documento';

export interface NewClassification {
  claimId: string;
  /** null solo para 'tipo_reclamacion' (lo exige un CHECK de la tabla). */
  documentId: string | null;
  aiRunId: string;
  subject: ClassificationSubject;
  predictedValue: string;
  confidence: number;
  evidence: string | null;
}

export interface ClassificationRow {
  id: string;
  predictedValue: string;
  finalValue: string | null;
  reviewedAt: Date | null;
}

@Injectable()
export class ClassificationsRepository {
  async insert(client: Queryable, c: NewClassification): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO classifications
         (claim_id, document_id, ai_run_id, subject, predicted_value, confidence, evidence)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [c.claimId, c.documentId, c.aiRunId, c.subject, c.predictedValue, c.confidence, c.evidence],
    );
    return rows[0].id;
  }

  /** La predicción más reciente del modelo para ese tema (y documento, si aplica). */
  async latestFor(
    c: Queryable, claimId: string, subject: ClassificationSubject, documentId: string | null,
  ): Promise<ClassificationRow | null> {
    const { rows } = await c.query<ClassificationRow>(
      `SELECT id, predicted_value AS "predictedValue", final_value AS "finalValue", reviewed_at AS "reviewedAt"
        FROM classifications
        WHERE claim_id = $1 AND subject = $2 AND document_id IS NOT DISTINCT FROM $3::uuid
        ORDER BY created_at DESC, id DESC LIMIT 1`,
      [claimId, subject, documentId],
    );
    return rows[0] ?? null;
  }

  /** Los tres campos van juntos: lo exige el CHECK classifications_review_complete. */
  async review(c: Queryable, id: string, finalValue: string, userId: string): Promise<void> {
    await c.query(
      `UPDATE classifications SET final_value = $2, reviewed_by = $3, reviewed_at = now() WHERE id = $1`,
      [id, finalValue, userId],
    );
  }
}