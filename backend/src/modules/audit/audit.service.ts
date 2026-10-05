import { Injectable } from '@nestjs/common';
import { ActorType } from '../../common/domain/enums';
import { DatabaseService } from '../../database/database.service';
import { Queryable } from '../../database/queryable';
import { AuditEventType } from './event-types';

export interface AuditEventInput {
  claimId: string;
  type: AuditEventType;
  actor: ActorType;
  /** Obligatorio cuando actor es 'analista': la base de datos lo exige. */
  actorUserId?: string | null;
  /**
   * Datos del evento. REGLA: nada de datos personales (nombres, documentos,
   * correos, texto del beneficiario). La bitácora es de solo inserción y no se
   * puede borrar: aquí van identificadores, no personas.
   */
  payload?: Record<string, unknown>;
}

export interface TimelineEntry {
  eventId: number;
  occurredAt: Date;
  eventType: string;
  actor: ActorType;
  /** Nombre del analista, si el actor es una persona del equipo. */
  actorName: string | null;
  payload: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Registra un hecho. Se llama con la MISMA conexión de la transacción que
   * produjo el hecho: si la transacción se revierte, el evento tampoco queda.
   */
  async record(client: Queryable, event: AuditEventInput): Promise<void> {
    await client.query(
      `INSERT INTO claim_events (claim_id, event_type, actor, actor_user_id, payload)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        event.claimId,
        event.type,
        event.actor,
        event.actorUserId ?? null,
        JSON.stringify(event.payload ?? {}),
      ],
    );
  }

  /** Historia completa de un caso, en orden: responde "¿se puede reconstruir este caso?". */
  async timeline(claimId: string, client: Queryable = this.db): Promise<TimelineEntry[]> {
    const { rows } = await client.query<{
      event_id: string;
      occurred_at: Date;
      event_type: string;
      actor: ActorType;
      actor_name: string | null;
      payload: Record<string, unknown>;
    }>(
      `SELECT event_id, occurred_at, event_type, actor, actor_name, payload
         FROM v_claim_timeline
        WHERE claim_id = $1
        ORDER BY event_id`,
      [claimId],
    );
    return rows.map((r) => ({
      eventId: Number(r.event_id), // bigint llega como texto
      occurredAt: r.occurred_at,
      eventType: r.event_type,
      actor: r.actor,
      actorName: r.actor_name,
      payload: r.payload,
    }));
  }
}