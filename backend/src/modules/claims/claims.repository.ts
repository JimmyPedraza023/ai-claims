import { Injectable } from '@nestjs/common';
import { ClaimType, IntakeChannel } from '../../common/domain/enums';
import { Queryable } from '../../database/queryable';

export type ClaimStatus = 'recibida' | 'incompleta' | 'completa' | 'pagada' | 'objetada';

/** Datos ya normalizados, listos para guardar. */
export interface NewClaim {
  channel: IntakeChannel;
  narrative: string;
  beneficiaryDocumentType: string;
  beneficiaryDocumentNumber: string;
  beneficiaryFullName: string;
  beneficiaryEmail: string;
  beneficiaryPhone: string | null;
  insuredDocumentNumber: string;
  insuredFullName: string;
  consentAcceptedAt: Date;
  consentVersion: string;
  trackingTokenHash: string;
}

export interface ClaimRecord {
  id: string;
  referenceCode: string;
  status: ClaimStatus;
  claimType: ClaimType | null;
  channel: IntakeChannel;
  narrative: string;
  beneficiaryDocumentType: string;
  beneficiaryDocumentNumber: string;
  beneficiaryFullName: string;
  beneficiaryEmail: string;
  beneficiaryPhone: string | null;
  insuredDocumentNumber: string;
  insuredFullName: string;
  consentAcceptedAt: Date;
  consentVersion: string;
  receivedAt: Date;
  completedAt: Date | null;
  /** Último día del plazo, 'YYYY-MM-DD' (hora de Colombia). */
  deadlineDate: string | null;
  closedAt: Date | null;
}

export interface NewSubmission {
  claimId: string;
  idempotencyKey: string;
  kind: 'inicial' | 'complemento';
  channel: IntakeChannel;
  clientIpHash?: string | null;
  userAgent?: string | null;
}

export interface SubmissionRecord {
  id: string;
  claimId: string;
  idempotencyKey: string;
  kind: 'inicial' | 'complemento';
  channel: IntakeChannel;
  receivedAt: Date;
}

// Nunca se devuelve tracking_token_hash: no hay motivo para que salga de la base.
const CLAIM_COLUMNS = `
  id, reference_code, status, claim_type, channel, narrative,
  beneficiary_document_type, beneficiary_document_number, beneficiary_full_name,
  beneficiary_email, beneficiary_phone, insured_document_number, insured_full_name,
  consent_accepted_at, consent_version, received_at, completed_at, deadline_date, closed_at`;

const SUBMISSION_COLUMNS = `id, claim_id, idempotency_key, kind, channel, received_at`;

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapClaim(r: any): ClaimRecord {
  return {
    id: r.id,
    referenceCode: r.reference_code,
    status: r.status,
    claimType: r.claim_type,
    channel: r.channel,
    narrative: r.narrative,
    beneficiaryDocumentType: r.beneficiary_document_type,
    beneficiaryDocumentNumber: r.beneficiary_document_number,
    beneficiaryFullName: r.beneficiary_full_name,
    beneficiaryEmail: r.beneficiary_email,
    beneficiaryPhone: r.beneficiary_phone,
    insuredDocumentNumber: r.insured_document_number,
    insuredFullName: r.insured_full_name,
    consentAcceptedAt: r.consent_accepted_at,
    consentVersion: r.consent_version,
    receivedAt: r.received_at,
    completedAt: r.completed_at,
    deadlineDate: r.deadline_date,
    closedAt: r.closed_at,
  };
}

function mapSubmission(r: any): SubmissionRecord {
  return {
    id: r.id,
    claimId: r.claim_id,
    idempotencyKey: r.idempotency_key,
    kind: r.kind,
    channel: r.channel,
    receivedAt: r.received_at,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Acceso a datos de reclamaciones y envíos. Solo SQL: las reglas viven en ClaimsService. */
@Injectable()
export class ClaimsRepository {
  async insert(client: Queryable, claim: NewClaim): Promise<ClaimRecord> {
    const { rows } = await client.query(
      `INSERT INTO claims (
         channel, narrative,
         beneficiary_document_type, beneficiary_document_number, beneficiary_full_name,
         beneficiary_email, beneficiary_phone,
         insured_document_number, insured_full_name,
         consent_accepted_at, consent_version, tracking_token_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING ${CLAIM_COLUMNS}`,
      [
        claim.channel,
        claim.narrative,
        claim.beneficiaryDocumentType,
        claim.beneficiaryDocumentNumber,
        claim.beneficiaryFullName,
        claim.beneficiaryEmail,
        claim.beneficiaryPhone,
        claim.insuredDocumentNumber,
        claim.insuredFullName,
        claim.consentAcceptedAt,
        claim.consentVersion,
        claim.trackingTokenHash,
      ],
    );
    return mapClaim(rows[0]);
  }

  async findById(client: Queryable, id: string): Promise<ClaimRecord | null> {
    const { rows } = await client.query(`SELECT ${CLAIM_COLUMNS} FROM claims WHERE id = $1`, [id]);
    return rows[0] ? mapClaim(rows[0]) : null;
  }

  async findOpenByParties(
    client: Queryable,
    beneficiaryDocumentNumber: string,
    insuredDocumentNumber: string,
  ): Promise<ClaimRecord | null> {
    const { rows } = await client.query(
      `SELECT ${CLAIM_COLUMNS} FROM claims
        WHERE beneficiary_document_number = $1
          AND insured_document_number = $2
          AND closed_at IS NULL`,
      [beneficiaryDocumentNumber, insuredDocumentNumber],
    );
    return rows[0] ? mapClaim(rows[0]) : null;
  }

  /** Devuelve null si la llave de idempotencia ya existía (no inserta nada). */
  async insertSubmission(client: Queryable, s: NewSubmission): Promise<SubmissionRecord | null> {
    const { rows } = await client.query(
      `INSERT INTO submissions (claim_id, idempotency_key, kind, channel, client_ip_hash, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING ${SUBMISSION_COLUMNS}`,
      [s.claimId, s.idempotencyKey, s.kind, s.channel, s.clientIpHash ?? null, s.userAgent ?? null],
    );
    return rows[0] ? mapSubmission(rows[0]) : null;
  }

  async findSubmissionByKey(client: Queryable, key: string): Promise<SubmissionRecord | null> {
    const { rows } = await client.query(
      `SELECT ${SUBMISSION_COLUMNS} FROM submissions WHERE idempotency_key = $1`,
      [key],
    );
    return rows[0] ? mapSubmission(rows[0]) : null;
  }

  /** Busca por el hash del token de seguimiento (en la base nunca está el token). */
  async findByTrackingTokenHash(client: Queryable, hash: string): Promise<ClaimRecord | null> {
    const { rows } = await client.query(
      `SELECT ${CLAIM_COLUMNS} FROM claims WHERE tracking_token_hash = $1`,
      [hash],
    );
    return rows[0] ? mapClaim(rows[0]) : null;
  }

  /** Igual que findByTrackingTokenHash, pero bloquea la fila hasta que termine la transacción. */
  async findByTrackingTokenHashForUpdate(client: Queryable, hash: string): Promise<ClaimRecord | null> {
    const { rows } = await client.query(
      `SELECT ${CLAIM_COLUMNS} FROM claims WHERE tracking_token_hash = $1 FOR UPDATE`,
      [hash],
    );
    return rows[0] ? mapClaim(rows[0]) : null;
  }

  /** Igual que findById, pero bloquea la fila hasta que termine la transacción. */
  async findByIdForUpdate(client: Queryable, id: string): Promise<ClaimRecord | null> {
    const { rows } = await client.query(`SELECT ${CLAIM_COLUMNS} FROM claims WHERE id = $1 FOR UPDATE`, [id]);
    return rows[0] ? mapClaim(rows[0]) : null;
  }

  /** Fija el tipo solo si estaba vacío: nunca pisa uno ya fijado. */
  async setClaimTypeIfEmpty(client: Queryable, id: string, claimType: ClaimType): Promise<boolean> {
    const { rowCount } = await client.query(
      `UPDATE claims SET claim_type = $2 WHERE id = $1 AND claim_type IS NULL`,
      [id, claimType],
    );
    return rowCount === 1;
  }

  /** ¿Una persona ya revisó el tipo de este caso? (claims no guarda quién lo fijó.) */
  async hasHumanTypeReview(client: Queryable, claimId: string): Promise<boolean> {
    const { rows } = await client.query<{ reviewed: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM classifications
          WHERE claim_id = $1 AND subject = 'tipo_reclamacion' AND reviewed_at IS NOT NULL
       ) AS reviewed`,
      [claimId],
    );
    return rows[0].reviewed;
  }

  /** Primera evaluación sin completar: 'recibida' → 'incompleta'. */
  async markIncomplete(client: Queryable, id: string): Promise<boolean> {
    const { rowCount } = await client.query(
      `UPDATE claims SET status = 'incompleta' WHERE id = $1 AND status = 'recibida'`,
      [id],
    );
    return rowCount === 1;
  }

  /** Arranca el reloj: estado, instante y fecha límite en el mismo UPDATE (lo exigen los CHECK de la tabla). */
  async startClock(client: Queryable, id: string, completedAt: Date, deadlineDate: string): Promise<boolean> {
    const { rowCount } = await client.query(
      `UPDATE claims SET status = 'completa', completed_at = $2, deadline_date = $3::date
        WHERE id = $1 AND status IN ('recibida', 'incompleta')`,
      [id, completedAt, deadlineDate],
    );
    return rowCount === 1;
  }

  /** Cierra el caso. Solo desde 'completa': la base ya impide un segundo cierre. */
  async closeClaim(client: Queryable, id: string, status: 'pagada' | 'objetada'): Promise<boolean> {
    const { rowCount } = await client.query(
      `UPDATE claims SET status = $2, closed_at = now() WHERE id = $1 AND status = 'completa'`,
      [id, status],
    );
    return rowCount === 1;
  }

  /** Cambio humano del tipo. A diferencia de setClaimTypeIfEmpty, sí reemplaza el valor guardado. */
  async setClaimType(client: Queryable, id: string, claimType: ClaimType): Promise<boolean> {
    const { rowCount } = await client.query(`UPDATE claims SET claim_type = $2 WHERE id = $1`, [id, claimType]);
    return rowCount === 1;
  }
}