import { Injectable } from '@nestjs/common';
import { Queryable } from '../../database/queryable';
import type { DocumentIssue, DocumentStatus, DocumentType } from '../../common/domain/enums';

export interface NewDocument {
  claimId: string;
  submissionId: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  storagePath: string;
}

export interface DocumentSummary {
  id: string;
  type: DocumentType | null;
  status: DocumentStatus;
  issue: DocumentIssue | null;
  uploadedAt: Date;
}

export interface DocumentAnalysisUpdate {
  type: DocumentType;
  status: DocumentStatus;
  issue: DocumentIssue | null;
  issueDetail: string | null;
  extractedData: unknown;
}

export interface DocumentForAnalysis {
  id: string;
  claimId: string;
  mimeType: string;
  storagePath: string;
  sha256: string;
  status: DocumentStatus;
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

  /** Resumen de los documentos de un caso. No incluye ruta, hash ni nombre de archivo. */
  async listByClaim(client: Queryable, claimId: string): Promise<DocumentSummary[]> {
    const { rows } = await client.query<{
      id: string;
      document_type: DocumentType | null;
      status: DocumentStatus;
      issue: DocumentIssue | null;
      uploaded_at: Date;
    }>(
      `SELECT id, document_type, status, issue, uploaded_at
         FROM documents WHERE claim_id = $1 ORDER BY uploaded_at, id`,
      [claimId],
    );
    return rows.map((r) => ({
      id: r.id,
      type: r.document_type,
      status: r.status,
      issue: r.issue,
      uploadedAt: r.uploaded_at,
    }));
  }

  /**
   * Aplica el resultado del análisis solo si el documento sigue pendiente.
   * Devuelve false si ya estaba analizado o lo corrigió una persona: un reintento
   * del trabajo no puede pisar ese resultado.
   */
  async applyAnalysis(client: Queryable, documentId: string, u: DocumentAnalysisUpdate): Promise<boolean> {
    const { rowCount } = await client.query(
      `UPDATE documents
          SET document_type = $2, status = $3, issue = $4, issue_detail = $5,
              extracted_data = $6::jsonb, updated_at = now()
        WHERE id = $1 AND status = 'pendiente_analisis'`,
      [documentId, u.type, u.status, u.issue, u.issueDetail, JSON.stringify(u.extractedData)],
    );
    return (rowCount ?? 0) > 0;
  }

  async findForAnalysis(client: Queryable, id: string): Promise<DocumentForAnalysis | null> {
    const { rows } = await client.query<{
      id: string; claim_id: string; mime_type: string; storage_path: string; sha256: string; status: DocumentStatus;
    }>(
      `SELECT id, claim_id, mime_type, storage_path, sha256, status FROM documents WHERE id = $1`,
      [id],
    );
    const r = rows[0];
    return r
      ? { id: r.id, claimId: r.claim_id, mimeType: r.mime_type, storagePath: r.storage_path, sha256: r.sha256, status: r.status }
      : null;
  }
}