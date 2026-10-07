import { Injectable } from '@nestjs/common';
import { Queryable } from '../../database/queryable';
import type { AiRunStatus } from './ai-run-status';

export type AiTask = 'clasificar_reclamacion' | 'analizar_documento';

export interface NewAiRun {
  claimId: string;
  documentId: string | null;
  task: AiTask;
  provider: string;
  model: string;
  promptVersion: string;
  /** Qué se envió, sin contenido: ids, hashes, páginas, tamaños. Nunca nombres ni números de documento. */
  inputRef: Record<string, unknown>;
  rawOutput: string | null;
  parsedOutput: unknown | null;
  status: AiRunStatus;
  error: string | null;
  latencyMs: number | null;
}

@Injectable()
export class AiRunsRepository {
  /** Solo inserción: la tabla no admite cambios ni borrados. */
  async insert(client: Queryable, r: NewAiRun): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO ai_runs
         (claim_id, document_id, task, provider, model, prompt_version,
          input_ref, raw_output, parsed_output, status, error, latency_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10, $11, $12)
       RETURNING id`,
      [
        r.claimId, r.documentId, r.task, r.provider, r.model, r.promptVersion,
        JSON.stringify(r.inputRef), r.rawOutput,
        r.parsedOutput === null ? null : JSON.stringify(r.parsedOutput),
        r.status, r.error, r.latencyMs,
      ],
    );
    return rows[0].id;
  }
}