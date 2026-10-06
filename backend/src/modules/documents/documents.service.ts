import { Inject, Injectable } from '@nestjs/common';
import { basename } from 'node:path';
import { ActorType } from '../../common/domain/enums';
import { sha256Hex } from '../../common/utils/hash';
import { Queryable } from '../../database/queryable';
import { AuditService } from '../audit/audit.service';
import { AUDIT_EVENTS } from '../audit/event-types';
import { DocumentsRepository } from './documents.repository';
import { InvalidFileError, TooManyFilesError } from './documents.errors';
import { detectFileType } from './file-signature';
// import { buildStoragePath, FILE_STORAGE, FileStorage } from './file-storage';
import { buildStoragePath, FILE_STORAGE } from './file-storage';
import type { FileStorage } from './file-storage';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES_PER_SUBMISSION = 10;
import type { DocumentSummary } from './documents.repository';

export interface UploadedFile {
  originalname: string;
  buffer: Buffer;
}

export interface ReceiveDocumentsInput {
  claimId: string;
  submissionId: string;
  files: UploadedFile[];
  /** Quién produjo el hecho (el beneficiario al radicar, el sistema al reprocesar). */
  actor: ActorType;
}

export interface ReceiveDocumentsResult {
  stored: { documentId: string; sha256: string }[];
  duplicates: { sha256: string }[];
}

/** Solo para mostrar: nunca se usa para construir rutas. */
function cleanDisplayName(name: string): string {
  return (
    basename(name.replace(/\\/g, '/'))
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .slice(0, 120) || 'archivo'
  );
}

@Injectable()
export class DocumentsService {
  constructor(
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    private readonly repo: DocumentsRepository,
    private readonly audit: AuditService,
  ) {}

  async receive(client: Queryable, input: ReceiveDocumentsInput): Promise<ReceiveDocumentsResult> {
    const { claimId, submissionId, files, actor } = input;

    if (files.length > MAX_FILES_PER_SUBMISSION) {
      throw new TooManyFilesError(MAX_FILES_PER_SUBMISSION);
    }

    // 1) Validar TODO antes de escribir nada: un archivo malo rechaza el envío completo.
    const prepared = files.map((f, index) => {
      const name = cleanDisplayName(f.originalname);
      if (f.buffer.length === 0) {
        throw new InvalidFileError('EMPTY', index, `El archivo "${name}" está vacío.`);
      }
      if (f.buffer.length > MAX_FILE_BYTES) {
        throw new InvalidFileError('TOO_LARGE', index, `El archivo "${name}" pesa más de 10 MB.`);
      }
      const type = detectFileType(f.buffer);
      if (!type) {
        throw new InvalidFileError(
          'TYPE_NOT_ALLOWED',
          index,
          `El archivo "${name}" no es un PDF, JPG, PNG o WebP válido.`,
        );
      }
      return {
        name,
        type,
        sha256: sha256Hex(f.buffer),
        size: f.buffer.length,
        buffer: f.buffer,
      };
    });

    // 2) Guardar y registrar.
    const result: ReceiveDocumentsResult = { stored: [], duplicates: [] };
    const seenInThisSubmission = new Set<string>();

    for (const p of prepared) {
      if (seenInThisSubmission.has(p.sha256)) {
        result.duplicates.push({ sha256: p.sha256 });
        continue; // mismo archivo repetido en el mismo envío: se ignora sin ruido
      }
      seenInThisSubmission.add(p.sha256);

      const storagePath = buildStoragePath(p.sha256, p.type.extension);
      await this.storage.save(storagePath, p.buffer);

      const documentId = await this.repo.insertIfNew(client, {
        claimId,
        submissionId,
        originalFilename: p.name,
        mimeType: p.type.mime,
        sizeBytes: p.size,
        sha256: p.sha256,
        storagePath,
      });

      if (documentId) {
        result.stored.push({ documentId, sha256: p.sha256 });
        await this.audit.record(client, {
          claimId,
          type: AUDIT_EVENTS.DOCUMENTO_RECIBIDO,
          actor,
          // Sin nombre de archivo: puede contener datos personales.
          payload: { documentId, sha256: p.sha256, mimeType: p.type.mime, sizeBytes: p.size },
        });
      } else {
        result.duplicates.push({ sha256: p.sha256 });
        await this.audit.record(client, {
          claimId,
          type: AUDIT_EVENTS.DOCUMENTO_DUPLICADO_IGNORADO,
          actor,
          payload: { sha256: p.sha256 },
        });
      }
    }
    return result;
  }

  listByClaim(client: Queryable, claimId: string): Promise<DocumentSummary[]> {
    return this.repo.listByClaim(client, claimId);
  }
}