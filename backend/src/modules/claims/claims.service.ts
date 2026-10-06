import { Injectable } from '@nestjs/common';
import { IntakeChannel } from '../../common/domain/enums';
import { Queryable } from '../../database/queryable';
import { isUniqueViolation } from '../../database/pg-errors';
import { AuditService } from '../audit/audit.service';
import { AUDIT_EVENTS } from '../audit/event-types';
import {
  normalizeDocumentNumber,
  normalizeEmail,
  normalizeName,
} from './claim-normalization';
import { IdempotencyKeyConflictError, OpenClaimAlreadyExistsError } from './claims.errors';
import {
  ClaimRecord,
  ClaimsRepository,
  NewSubmission,
  SubmissionRecord,
} from './claims.repository';
import { hashTrackingToken } from './tracking-token';

export interface CreateClaimInput {
  channel: IntakeChannel;
  narrative: string;
  beneficiaryDocumentType: string;
  beneficiaryDocumentNumber: string;
  beneficiaryFullName: string;
  beneficiaryEmail: string;
  beneficiaryPhone?: string | null;
  insuredDocumentNumber: string;
  insuredFullName: string;
  consentAcceptedAt: Date;
  consentVersion: string;
  /** Hash del token de seguimiento (ver tracking-token.ts). */
  trackingTokenHash: string;
}

const OPEN_CLAIM_INDEX = 'claims_one_open_per_beneficiary_insured';

/**
 * Reglas de reclamaciones. Todos los métodos reciben un `Queryable` para
 * participar en la transacción de quien los llama (intake, en la rama siguiente).
 */
@Injectable()
export class ClaimsService {
  constructor(
    private readonly repo: ClaimsRepository,
    private readonly audit: AuditService,
  ) {}

  /**
   * Crea la reclamación y su primer evento en la bitácora, en la misma transacción.
   * Normaliza los datos de identificación antes de guardar.
   * @throws OpenClaimAlreadyExistsError si ese beneficiario ya tiene un caso abierto
   *   para ese asegurado. Quien llama debe revertir la transacción y usar findOpenClaim.
   */
  async createClaim(client: Queryable, input: CreateClaimInput): Promise<ClaimRecord> {
    let claim: ClaimRecord;
    try {
      claim = await this.repo.insert(client, {
        channel: input.channel,
        narrative: input.narrative.trim(),
        beneficiaryDocumentType: input.beneficiaryDocumentType.trim().toUpperCase(),
        beneficiaryDocumentNumber: normalizeDocumentNumber(input.beneficiaryDocumentNumber),
        beneficiaryFullName: normalizeName(input.beneficiaryFullName),
        beneficiaryEmail: normalizeEmail(input.beneficiaryEmail),
        beneficiaryPhone: input.beneficiaryPhone?.trim() || null,
        insuredDocumentNumber: normalizeDocumentNumber(input.insuredDocumentNumber),
        insuredFullName: normalizeName(input.insuredFullName),
        consentAcceptedAt: input.consentAcceptedAt,
        consentVersion: input.consentVersion,
        trackingTokenHash: input.trackingTokenHash,
      });
    } catch (err) {
      if (isUniqueViolation(err, OPEN_CLAIM_INDEX)) throw new OpenClaimAlreadyExistsError();
      throw err;
    }

    await this.audit.record(client, {
      claimId: claim.id,
      type: AUDIT_EVENTS.RECLAMACION_RECIBIDA,
      actor: 'beneficiario',
      // Sin nombres, correo ni documentos: solo lo necesario para reconstruir el hecho.
      payload: { channel: claim.channel, referenceCode: claim.referenceCode },
    });
    return claim;
  }

  findOpenClaim(
    client: Queryable,
    beneficiaryDocumentNumber: string,
    insuredDocumentNumber: string,
  ): Promise<ClaimRecord | null> {
    return this.repo.findOpenByParties(
      client,
      normalizeDocumentNumber(beneficiaryDocumentNumber),
      normalizeDocumentNumber(insuredDocumentNumber),
    );
  }

  findById(client: Queryable, id: string): Promise<ClaimRecord | null> {
    return this.repo.findById(client, id);
  }

  /**
   * Registra un envío de forma idempotente: la misma llave dos veces devuelve el
   * envío original (created=false) y deja constancia del duplicado en la bitácora.
   * Un duplicado nunca crea otro expediente ni toca el reloj.
   * @throws IdempotencyKeyConflictError si la llave ya pertenece a OTRA reclamación.
   */
  async registerSubmission(
    client: Queryable,
    input: NewSubmission,
  ): Promise<{ submission: SubmissionRecord; created: boolean }> {
    const inserted = await this.repo.insertSubmission(client, input);
    if (inserted) return { submission: inserted, created: true };

    const existing = await this.repo.findSubmissionByKey(client, input.idempotencyKey);
    if (!existing) throw new Error('Envío no encontrado tras un conflicto de idempotencia');
    if (existing.claimId !== input.claimId) throw new IdempotencyKeyConflictError();

    await this.audit.record(client, {
      claimId: existing.claimId,
      type: AUDIT_EVENTS.ENVIO_DUPLICADO_IGNORADO,
      actor: 'beneficiario',
      payload: { submissionId: existing.id, channel: input.channel },
    });
    return { submission: existing, created: false };
  }

  findByTrackingToken(client: Queryable, token: string): Promise<ClaimRecord | null> {
    return this.repo.findByTrackingTokenHash(client, hashTrackingToken(token));
  }

  /** Úsese dentro de una transacción: nadie más puede cambiar el caso hasta que termine. */
  lockByTrackingToken(client: Queryable, token: string): Promise<ClaimRecord | null> {
    return this.repo.findByTrackingTokenHashForUpdate(client, hashTrackingToken(token));
  }
}