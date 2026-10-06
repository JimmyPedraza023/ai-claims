// backend/src/modules/intake/complement.service.ts
import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_EVENTS } from '../audit/event-types';
import { ClaimsService } from '../claims/claims.service';
import { isWellFormedTrackingToken } from '../claims/tracking-token';
import type { ReceiveDocumentsResult, UploadedFile } from '../documents/documents.service';
import { ClaimNotAcceptingDocumentsError, TrackingTokenNotFoundError } from './intake.errors';
import { SubmissionProcessor } from './submission-processor';

export interface ComplementRequest {
  token: string;
  idempotencyKey: string;
  files: UploadedFile[];
  clientIpHash?: string | null;
  userAgent?: string | null;
}

export type ComplementResult =
  | { outcome: 'received'; claimId: string; documents: ReceiveDocumentsResult }
  /** La misma llave ya se había procesado: no se hizo nada nuevo. */
  | { outcome: 'duplicate'; claimId: string };

/**
 * El beneficiario sube lo que le faltaba desde su página de seguimiento. Una sola transacción,
 * con el caso bloqueado: no puede cruzarse con otra subida ni, más adelante, con el worker
 * que marca el caso como completo.
 */
@Injectable()
export class ComplementService {
  constructor(
    private readonly db: DatabaseService,
    private readonly claims: ClaimsService,
    private readonly audit: AuditService,
    private readonly processor: SubmissionProcessor,
  ) {}

  async receive(req: ComplementRequest): Promise<ComplementResult> {
    if (!isWellFormedTrackingToken(req.token)) throw new TrackingTokenNotFoundError();

    return this.db.withTransaction(async (tx) => {
      const claim = await this.claims.lockByTrackingToken(tx, req.token);
      if (!claim) throw new TrackingTokenNotFoundError();

      // Si la llave ya era de otra reclamación, esto lanza IdempotencyKeyConflictError.
      const { submission, created } = await this.claims.registerSubmission(tx, {
        claimId: claim.id,
        idempotencyKey: req.idempotencyKey,
        kind: 'complemento',
        channel: 'web',
        clientIpHash: req.clientIpHash,
        userAgent: req.userAgent,
      });

      // Reintento de un envío ya aceptado: se responde igual, sin repetir nada.
      if (!created) return { outcome: 'duplicate', claimId: claim.id } as const;

      // Con el reloj corriendo o el caso resuelto, cambiar documentos es decisión de un analista.
      // Lanzar aquí revierte también el envío que se acaba de registrar.
      if (claim.closedAt !== null) throw new ClaimNotAcceptingDocumentsError('cerrada');
      if (claim.status === 'completa') throw new ClaimNotAcceptingDocumentsError('completa');

      await this.audit.record(tx, {
        claimId: claim.id,
        type: AUDIT_EVENTS.COMPLEMENTO_RECIBIDO,
        actor: 'beneficiario',
        payload: { submissionId: submission.id, channel: 'web', via: 'seguimiento' },
      });

      const documents = await this.processor.storeAndQueue(tx, claim.id, submission.id, req.files);
      return { outcome: 'received', claimId: claim.id, documents } as const;
    });
  }
}