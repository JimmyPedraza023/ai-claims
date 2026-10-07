import { Injectable } from '@nestjs/common';
import { Queryable } from '../../database/queryable';
import type { ClaimedJob, JobKind } from './job-queue';

export type { JobKind } from './job-queue'; // los demás archivos siguen importándolo de aquí

export interface NewJob {
  kind: JobKind;
  claimId: string;
  documentId?: string | null;
  /** Obligatorio (y único valor válido) cuando kind es 'enviar_aviso'. */
  notificationId?: string | null;
  /** Llave única: encolar dos veces el mismo trabajo no lo duplica. */
  dedupeKey: string;
}

export interface ClaimOptions {
  /** Cuánto dura la reserva de un trabajo antes de que otro worker pueda retomarlo. */
  leaseSeconds: number;
  /** Solo para pruebas o reprocesos de un caso concreto. */
  onlyClaimId?: string;
  /** Tipos que este worker sabe manejar. Los demás se dejan intactos. */
  kinds?: JobKind[];
}

interface JobRow {
  id: string; // bigint llega como texto
  kind: JobKind;
  claim_id: string;
  document_id: string | null;
  notification_id: string | null;
  attempts: number;
  max_attempts: number;
}

const mapJob = (r: JobRow): ClaimedJob => ({
  id: Number(r.id),
  kind: r.kind,
  claimId: r.claim_id,
  documentId: r.document_id,
  notificationId: r.notification_id,
  attempts: r.attempts,
  maxAttempts: r.max_attempts,
});

/**
 * Cola de trabajos en PostgreSQL. Se guarda primero y se procesa después: si el
 * modelo falla, la radicación ya existe.
 */
@Injectable()
export class JobsRepository {
  /** Devuelve false si ya existía un trabajo con esa dedupeKey. */
  async enqueue(client: Queryable, job: NewJob): Promise<boolean> {
    const { rowCount } = await client.query(
      `INSERT INTO jobs (kind, claim_id, document_id, notification_id, dedupe_key)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [job.kind, job.claimId, job.documentId ?? null, job.notificationId ?? null, job.dedupeKey],
    );
    return rowCount === 1;
  }

  /**
   * Toma el siguiente trabajo: uno pendiente cuya hora llegó, o uno en proceso cuyo lease venció
   * (su worker murió) y aún tiene intentos. Una sola sentencia atómica, sin transacción abierta.
   * El intento se cuenta aquí: un trabajo que cuelga al worker también se agota.
   */
  async claimNext(client: Queryable, workerId: string, opts: ClaimOptions): Promise<ClaimedJob | null> {
    const { rows } = await client.query<JobRow>(
      `UPDATE jobs
          SET status = 'en_proceso', locked_at = now(), locked_by = $1, attempts = attempts + 1
        WHERE id = (
          SELECT id FROM jobs
           WHERE ( (status = 'pendiente' AND run_at <= now())
                OR (status = 'en_proceso'
                    AND locked_at < now() - make_interval(secs => $2)
                    AND attempts < max_attempts) )
             AND ($3::uuid IS NULL OR claim_id = $3::uuid)
             AND ($4::text[] IS NULL OR kind = ANY($4::text[]))
           ORDER BY run_at, id
           FOR UPDATE SKIP LOCKED
           LIMIT 1
        )
        RETURNING id, kind, claim_id, document_id, notification_id, attempts, max_attempts`,
      [
        workerId,
        opts.leaseSeconds,
        opts.onlyClaimId ?? null,
        opts.kinds ?? null,
      ],
    );
    return rows[0] ? mapJob(rows[0]) : null;
  }

  /** false si el trabajo ya no es de este worker (cercado). */
  async complete(client: Queryable, jobId: number, workerId: string): Promise<boolean> {
    const { rowCount } = await client.query(
      `UPDATE jobs
          SET status = 'completado', finished_at = now(), locked_at = NULL, locked_by = NULL, last_error = NULL
        WHERE id = $1 AND locked_by = $2 AND status = 'en_proceso'`,
      [jobId, workerId],
    );
    return rowCount === 1;
  }

  /** Vuelve a 'pendiente' con espera, o pasa a 'fallido' si ya no quedan intentos. null = ya no era suyo. */
  async retryLater(
    client: Queryable, jobId: number, workerId: string, error: string, delaySeconds: number,
  ): Promise<'pendiente' | 'fallido' | null> {
    const { rows } = await client.query<{ status: 'pendiente' | 'fallido' }>(
      `UPDATE jobs
          SET status      = CASE WHEN attempts >= max_attempts THEN 'fallido'::job_status ELSE 'pendiente'::job_status END,
              run_at      = CASE WHEN attempts >= max_attempts THEN run_at ELSE now() + make_interval(secs => $4) END,
              finished_at = CASE WHEN attempts >= max_attempts THEN now() ELSE NULL END,
              last_error  = $3, locked_at = NULL, locked_by = NULL
        WHERE id = $1 AND locked_by = $2 AND status = 'en_proceso'
        RETURNING status`,
      [jobId, workerId, error.slice(0, 500), delaySeconds],
    );
    return rows[0]?.status ?? null;
  }

  async failPermanently(client: Queryable, jobId: number, workerId: string, error: string): Promise<boolean> {
    const { rowCount } = await client.query(
      `UPDATE jobs
          SET status = 'fallido', finished_at = now(), last_error = $3, locked_at = NULL, locked_by = NULL
        WHERE id = $1 AND locked_by = $2 AND status = 'en_proceso'`,
      [jobId, workerId, error.slice(0, 500)],
    );
    return rowCount === 1;
  }

  /** Trabajos abandonados (lease vencido) que ya agotaron sus intentos: pasan a 'fallido'. */
  async failExhausted(client: Queryable, opts: ClaimOptions): Promise<number> {
    const { rowCount } = await client.query(
      `UPDATE jobs
          SET status = 'fallido', finished_at = now(), locked_at = NULL, locked_by = NULL,
              last_error = COALESCE(last_error, 'abandonado: agotó los intentos sin terminar')
        WHERE status = 'en_proceso'
          AND locked_at < now() - make_interval(secs => $1)
          AND attempts >= max_attempts
          AND ($2::uuid IS NULL OR claim_id = $2::uuid)`,
      [opts.leaseSeconds, opts.onlyClaimId ?? null],
    );
    return rowCount ?? 0;
  }
}