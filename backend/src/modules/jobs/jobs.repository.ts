// backend/src/modules/jobs/jobs.repository.ts
import { Injectable } from '@nestjs/common';
import { Queryable } from '../../database/queryable';

export type JobKind = 'analizar_documento' | 'clasificar_reclamacion' | 'evaluar_completitud';

export interface NewJob {
  kind: JobKind;
  claimId: string;
  documentId?: string | null;
  /** Llave única: encolar dos veces el mismo trabajo no lo duplica. */
  dedupeKey: string;
}

/**
 * Cola de trabajos en PostgreSQL. Se guarda primero y se procesa después: si el
 * modelo falla, la radicación ya existe. Aquí solo se encola; tomar trabajos
 * (FOR UPDATE SKIP LOCKED) y reintentarlos se agrega en la rama del worker.
 */
@Injectable()
export class JobsRepository {
  /** Devuelve false si ya existía un trabajo con esa dedupeKey. */
  async enqueue(client: Queryable, job: NewJob): Promise<boolean> {
    const { rowCount } = await client.query(
      `INSERT INTO jobs (kind, claim_id, document_id, dedupe_key)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [job.kind, job.claimId, job.documentId ?? null, job.dedupeKey],
    );
    return rowCount === 1;
  }
}