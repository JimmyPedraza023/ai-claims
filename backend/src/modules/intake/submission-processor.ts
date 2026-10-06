// backend/src/modules/intake/submission-processor.ts
import { Injectable } from '@nestjs/common';
import type { Queryable } from '../../database/queryable';
import { DocumentsService } from '../documents/documents.service';
import type { ReceiveDocumentsResult, UploadedFile } from '../documents/documents.service';
import { JobsRepository } from '../jobs/jobs.repository';

/**
 * Lo que sigue a cada envío con archivos, sea de un caso nuevo o de uno que ya existe:
 * guardar los documentos y dejar encolado el trabajo para el modelo. Usa la transacción
 * de quien lo llama, para que todo quede junto o no quede nada.
 */
@Injectable()
export class SubmissionProcessor {
  constructor(
    private readonly documents: DocumentsService,
    private readonly jobs: JobsRepository,
  ) {}

  async storeAndQueue(
    tx: Queryable,
    claimId: string,
    submissionId: string,
    files: UploadedFile[],
  ): Promise<ReceiveDocumentsResult> {
    const documents = await this.documents.receive(tx, {
      claimId,
      submissionId,
      files,
      actor: 'beneficiario',
    });

    for (const doc of documents.stored) {
      await this.jobs.enqueue(tx, {
        kind: 'analizar_documento',
        claimId,
        documentId: doc.documentId,
        dedupeKey: `analizar_documento:${doc.documentId}`,
      });
    }

    // Un trabajo por envío, aunque no traiga archivos: así un caso que llega solo
    // con texto también se clasifica y el beneficiario recibe respuesta.
    await this.jobs.enqueue(tx, {
      kind: 'clasificar_reclamacion',
      claimId,
      dedupeKey: `clasificar_reclamacion:${submissionId}`,
    });
    return documents;
  }
}