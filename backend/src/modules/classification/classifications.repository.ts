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
}