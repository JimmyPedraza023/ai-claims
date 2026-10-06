import { Injectable } from '@nestjs/common';
import type { IntakeChannel } from '../../common/domain/enums';
import { DatabaseService } from '../../database/database.service';
import type { Queryable } from '../../database/queryable';
import { AuditService } from '../audit/audit.service';
import { AUDIT_EVENTS } from '../audit/event-types';
import { OpenClaimAlreadyExistsError } from '../claims/claims.errors';
import { ClaimsService } from '../claims/claims.service';
import { generateTrackingToken } from '../claims/tracking-token';
import { DocumentsService } from '../documents/documents.service';
import type { ReceiveDocumentsResult, UploadedFile } from '../documents/documents.service';
import { JobsRepository } from '../jobs/jobs.repository';
import { OpenClaimChangedError } from './intake.errors';
import { CONSENT_VERSION } from './intake.schema';
import type { IntakeInput } from './intake.schema';

export interface IntakeRequest {
  /** Lo fija el servidor según por dónde entró; nunca lo envía el cliente. */
  channel: IntakeChannel;
  form: IntakeInput;
  files: UploadedFile[];
  clientIpHash?: string | null;
  userAgent?: string | null;
}

interface ClaimRef {
  claimId: string;
  referenceCode: string;
}

export type IntakeResult =
  /** Caso nuevo. El token solo existe aquí: en la base solo queda su hash. */
  | (ClaimRef & { outcome: 'created'; trackingToken: string; documents: ReceiveDocumentsResult })
  /** Ya había un caso abierto de este beneficiario y asegurado: el envío se anexó. */
  | (ClaimRef & { outcome: 'appended'; documents: ReceiveDocumentsResult })
  /** La misma llave de idempotencia ya se había procesado: no se hizo nada nuevo. */
  | (ClaimRef & { outcome: 'duplicate' });

/**
 * Orquesta la radicación. Cada intento corre en UNA transacción que cubre caso,
 * envío, documentos, bitácora y trabajos: o queda todo o no queda nada.
 */
@Injectable()
export class IntakeService {
  constructor(
    private readonly db: DatabaseService,
    private readonly claims: ClaimsService,
    private readonly documents: DocumentsService,
    private readonly audit: AuditService,
    private readonly jobs: JobsRepository,
  ) {}

  async receive(req: IntakeRequest): Promise<IntakeResult> {
    try {
      return await this.db.withTransaction((tx) => this.openNewClaim(tx, req));
    } catch (err) {
      // En PostgreSQL un error de unicidad aborta la transacción: por eso se
      // captura FUERA de ella y se abre otra para anexar al caso existente.
      if (!(err instanceof OpenClaimAlreadyExistsError)) throw err;
    }

    const result = await this.db.withTransaction((tx) => this.addToOpenClaim(tx, req));
    if (!result) throw new OpenClaimChangedError();
    return result;
  }

  private async openNewClaim(tx: Queryable, req: IntakeRequest): Promise<IntakeResult> {
    const { form } = req;
    const { token, hash } = generateTrackingToken();

    const claim = await this.claims.createClaim(tx, {
      channel: req.channel,
      narrative: form.narrative,
      beneficiaryDocumentType: form.beneficiaryDocumentType,
      beneficiaryDocumentNumber: form.beneficiaryDocumentNumber,
      beneficiaryFullName: form.beneficiaryFullName,
      beneficiaryEmail: form.beneficiaryEmail,
      beneficiaryPhone: form.beneficiaryPhone,
      insuredDocumentNumber: form.insuredDocumentNumber,
      insuredFullName: form.insuredFullName,
      consentAcceptedAt: new Date(),
      consentVersion: CONSENT_VERSION,
      trackingTokenHash: hash,
    });

    // Si la llave ya era de otra reclamación, registerSubmission lanza
    // IdempotencyKeyConflictError y toda la transacción se revierte.
    const { submission } = await this.claims.registerSubmission(tx, {
      claimId: claim.id,
      idempotencyKey: form.idempotencyKey,
      kind: 'inicial',
      channel: req.channel,
      clientIpHash: req.clientIpHash,
      userAgent: req.userAgent,
    });

    const documents = await this.storeAndQueue(tx, claim.id, submission.id, req.files);
    return {
      outcome: 'created',
      claimId: claim.id,
      referenceCode: claim.referenceCode,
      trackingToken: token,
      documents,
    };
  }

  /** Devuelve null si el caso abierto ya no existe (se cerró entre medio). */
  private async addToOpenClaim(tx: Queryable, req: IntakeRequest): Promise<IntakeResult | null> {
    const { form } = req;
    const claim = await this.claims.findOpenClaim(
      tx,
      form.beneficiaryDocumentNumber,
      form.insuredDocumentNumber,
    );
    if (!claim) return null;

    const { submission, created } = await this.claims.registerSubmission(tx, {
      claimId: claim.id,
      idempotencyKey: form.idempotencyKey,
      kind: 'complemento',
      channel: req.channel,
      clientIpHash: req.clientIpHash,
      userAgent: req.userAgent,
    });

    // Mensaje repetido o doble clic: ya quedó registrado como duplicado. Ni
    // documentos ni trabajos nuevos, y el reloj no se toca.
    if (!created) {
      return { outcome: 'duplicate', claimId: claim.id, referenceCode: claim.referenceCode };
    }

    await this.audit.record(tx, {
      claimId: claim.id,
      type: AUDIT_EVENTS.COMPLEMENTO_RECIBIDO,
      actor: 'beneficiario',
      payload: { submissionId: submission.id, channel: req.channel },
    });

    // El relato del formulario NO reemplaza al original (supuesto 6).
    const documents = await this.storeAndQueue(tx, claim.id, submission.id, req.files);
    return {
      outcome: 'appended',
      claimId: claim.id,
      referenceCode: claim.referenceCode,
      documents,
    };
  }

  /** Guarda los archivos y deja encolado el trabajo para el modelo. */
  private async storeAndQueue(
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