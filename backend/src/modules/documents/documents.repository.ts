import { Injectable } from '@nestjs/common';
import { Queryable } from '../../database/queryable';

export interface NewDocument {
  claimId: string;
  submissionId: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  storagePath: string;
}

@Injectable()
export class DocumentsRepository {
  /**
   * Devuelve el id si se insertó; null si el mismo archivo ya estaba en el caso.
   * El estado queda en 'pendiente_analisis' (default de la tabla): el worker lo toma después.
   */
  async insertIfNew(client: Queryable, d: NewDocument): Promise<string | null> {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO documents
         (claim_id, submission_id, original_filename, mime_type, size_bytes, sha256, storage_path)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT ON CONSTRAINT documents_unique_file_per_claim DO NOTHING
       RETURNING id`,
      [d.claimId, d.submissionId, d.originalFilename, d.mimeType, d.sizeBytes, d.sha256, d.storagePath],
    );
    return rows[0]?.id ?? null;
  }
}