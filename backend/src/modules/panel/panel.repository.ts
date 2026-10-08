import { Injectable } from '@nestjs/common';
import { Queryable } from '../../database/queryable';

@Injectable()
export class PanelRepository {
  /**
   * Casos abiertos por urgencia: vencidos, luego en riesgo, luego en plazo, luego los que aún no tienen reloj.
   * Dentro de cada grupo, los más cercanos al límite primero.
   */
  async listOpenClaims(c: Queryable, limit: number, offset: number) {
    const { rows } = await c.query(
      `SELECT k.claim_id AS "claimId", k.reference_code AS "referenceCode", k.status, k.claim_type AS "claimType",
              k.received_at AS "receivedAt", k.deadline_date AS "deadlineDate",
              k.days_elapsed AS "daysElapsed", k.days_total AS "daysTotal",
              k.days_remaining AS "daysRemaining", k.clock_state AS "clockState",
              (SELECT count(*)::int FROM documents d
                WHERE d.claim_id = k.claim_id AND d.status = 'requiere_revision') AS "docsInReview"
         FROM fn_claim_clock() k
        ORDER BY CASE k.clock_state WHEN 'vencido' THEN 0 WHEN 'en_riesgo' THEN 1
                                    WHEN 'en_plazo' THEN 2 ELSE 3 END,
                 k.days_remaining ASC NULLS LAST, k.received_at
        LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return rows;
  }

  /** El reloj de un caso. null si ya está cerrado (fn_claim_clock solo devuelve casos abiertos). */
  async clockFor(c: Queryable, claimId: string) {
    const { rows } = await c.query(
      `SELECT deadline_date AS "deadlineDate", days_elapsed AS "daysElapsed", days_total AS "daysTotal",
              days_remaining AS "daysRemaining", clock_state AS "clockState"
         FROM fn_claim_clock() WHERE claim_id = $1`,
      [claimId],
    );
    return rows[0] ?? null;
  }

  async documentsDetail(c: Queryable, claimId: string) {
    const { rows } = await c.query(
      `SELECT id, document_type AS "type", status, issue, issue_detail AS "issueDetail",
              extracted_data AS "extractedData", original_filename AS "originalFilename",
              mime_type AS "mimeType", size_bytes::int AS "sizeBytes", uploaded_at AS "uploadedAt"
         FROM documents WHERE claim_id = $1 ORDER BY uploaded_at, id`,
      [claimId],
    );
    return rows;
  }

  async latestEvaluation(c: Queryable, claimId: string) {
    const { rows } = await c.query(
      `SELECT id, claim_type AS "claimType", rules_version AS "rulesVersion", is_complete AS "isComplete",
              result, created_at AS "createdAt"
         FROM completeness_evaluations WHERE claim_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
      [claimId],
    );
    return rows[0] ?? null;
  }

  async classifications(c: Queryable, claimId: string) {
    const { rows } = await c.query(
      `SELECT id, document_id AS "documentId", subject, predicted_value AS "predictedValue", confidence,
              evidence, final_value AS "finalValue", reviewed_by AS "reviewedBy", reviewed_at AS "reviewedAt",
              created_at AS "createdAt"
         FROM classifications WHERE claim_id = $1 ORDER BY created_at, id`,
      [claimId],
    );
    return rows;
  }

  /** Qué llamadas al modelo se hicieron y cómo terminaron. No se expone la salida cruda. */
  async aiRuns(c: Queryable, claimId: string) {
    const { rows } = await c.query(
      `SELECT id, task, document_id AS "documentId", model, status, latency_ms AS "latencyMs", error,
              created_at AS "createdAt"
         FROM ai_runs WHERE claim_id = $1 ORDER BY created_at, id`,
      [claimId],
    );
    return rows;
  }

  async decisions(c: Queryable, claimId: string) {
    const { rows } = await c.query(
      `SELECT d.id, d.kind, d.reason, d.requested_documents AS "requestedDocuments",
              d.evaluation_id AS "evaluationId", d.decided_at AS "decidedAt", u.full_name AS "decidedByName"
         FROM decisions d JOIN users u ON u.id = d.decided_by
        WHERE d.claim_id = $1 ORDER BY d.decided_at`,
      [claimId],
    );
    return rows;
  }

  /** Para la descarga: el documento tiene que pertenecer a ESE caso. */
  async documentFile(c: Queryable, claimId: string, documentId: string) {
    const { rows } = await c.query<{ id: string; storagePath: string; mimeType: string }>(
      `SELECT id, storage_path AS "storagePath", mime_type AS "mimeType"
         FROM documents WHERE id = $2 AND claim_id = $1`,
      [claimId, documentId],
    );
    return rows[0] ?? null;
  }

  /** Lo que una persona tiene que mirar: nada se queda "pendiente" sin que se vea. */
  async reviewQueue(c: Queryable) {
    const documents = await c.query(
      `SELECT d.id AS "documentId", d.claim_id AS "claimId", cl.reference_code AS "referenceCode",
              d.document_type AS "type", d.issue, d.uploaded_at AS "uploadedAt"
         FROM documents d JOIN claims cl ON cl.id = d.claim_id
        WHERE d.status = 'requiere_revision' AND cl.closed_at IS NULL
        ORDER BY d.uploaded_at LIMIT 100`,
    );
    // Sin tipo y sin trabajo en curso: el modelo ya no lo va a resolver.
    const untypedClaims = await c.query(
      `SELECT cl.id AS "claimId", cl.reference_code AS "referenceCode", cl.received_at AS "receivedAt"
         FROM claims cl
        WHERE cl.claim_type IS NULL AND cl.closed_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.claim_id = cl.id AND j.status IN ('pendiente', 'en_proceso'))
        ORDER BY cl.received_at LIMIT 100`,
    );
    // El modelo propuso otro tipo y nadie lo ha revisado.
    const typeReviews = await c.query(
      `SELECT cl.id AS "claimId", cl.reference_code AS "referenceCode", cl.claim_type AS "currentType",
              max(e.occurred_at) AS "since"
         FROM claims cl
         JOIN claim_events e ON e.claim_id = cl.id AND e.event_type = 'clasificacion_requiere_revision'
        WHERE cl.closed_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM classifications k
                           WHERE k.claim_id = cl.id AND k.subject = 'tipo_reclamacion' AND k.reviewed_at IS NOT NULL)
        GROUP BY cl.id, cl.reference_code, cl.claim_type
        ORDER BY max(e.occurred_at) LIMIT 100`,
    );
    const failedJobs = await c.query(
      `SELECT j.id, j.kind, j.claim_id AS "claimId", cl.reference_code AS "referenceCode",
              j.attempts, j.last_error AS "lastError", j.finished_at AS "finishedAt"
         FROM jobs j JOIN claims cl ON cl.id = j.claim_id
        WHERE j.status = 'fallido' ORDER BY j.finished_at DESC LIMIT 50`,
    );
    return {
      documents: documents.rows,
      untypedClaims: untypedClaims.rows,
      typeReviews: typeReviews.rows,
      failedJobs: failedJobs.rows,
    };
  }
}