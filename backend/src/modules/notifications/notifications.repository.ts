// notifications.repository.ts
import { Injectable } from "@nestjs/common/decorators/core/index.js";
import { Queryable } from "../../database/queryable";
import { NotificationDraft } from "./notification-drafts";

export interface NotificationRecord {
  id: string; claimId: string; kind: string;
  recipient: string; subject: string; body: string;
  status: 'pendiente' | 'enviada' | 'fallida';
}

export type NotificationKind =
  | NotificationDraft['kind']
  | 'acuse_radicacion'
  | 'recordatorio_beneficiario'
  | 'alerta_riesgo'
  | 'alerta_vencido';

@Injectable()
export class NotificationsRepository {
  /** Devuelve el id si el aviso es nuevo, o null si la clave ya existía (duplicado: no pasa nada). */
  async insertIfNew(c: Queryable, n: {
    claimId: string; kind: NotificationKind; recipient: string;
    subject: string; body: string; dedupeKey: string;
    audience?: 'beneficiario' | 'analistas';
  }): Promise<string | null> {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO notifications (claim_id, kind, audience, recipient, subject, body, dedupe_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (dedupe_key) DO NOTHING
       RETURNING id`,
      [n.claimId, n.kind, n.audience ?? 'beneficiario', n.recipient, n.subject, n.body, n.dedupeKey],
    );
    return rows[0]?.id ?? null;
  }

  async findById(c: Queryable, id: string): Promise<NotificationRecord | null> {
    const { rows } = await c.query<NotificationRecord>(
        `SELECT id, claim_id AS "claimId", kind, recipient, subject, body, status
        FROM notifications WHERE id = $1`, [id]);
    return rows[0] ?? null;
    }

    /** true si la dejó 'enviada' ahora; false si ya no estaba pendiente. */
    async markSent(c: Queryable, id: string): Promise<boolean> {
    const { rowCount } = await c.query(
        `UPDATE notifications
            SET status = 'enviada', sent_at = now(), attempts = attempts + 1, last_error = NULL
        WHERE id = $1 AND status = 'pendiente'`, [id]);
    return rowCount === 1;
    }

    async recordFailure(c: Queryable, id: string, errorCode: string, final: boolean): Promise<void> {
    await c.query(
        `UPDATE notifications
            SET attempts = attempts + 1, last_error = $2,
                status = CASE WHEN $3::boolean THEN 'fallida'::notification_status ELSE status END
        WHERE id = $1 AND status = 'pendiente'`, [id, errorCode.slice(0, 200), final]);
    }
}