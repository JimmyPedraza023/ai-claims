import { Injectable } from '@nestjs/common';
import { Queryable } from '../../database/queryable';

/** Escenario del enunciado: hoy se tardan 4,5 días en decirle al beneficiario qué le falta. */
export const BASELINE_FIRST_RESPONSE_HOURS = 4.5 * 24;

export interface ClockSummary {
  open: number;
  withoutClock: number;
  onTime: number;
  atRisk: number;
  expired: number;
}

export interface ModelCorrectionRow {
  subject: string;
  total: number;
  reviewed: number;
  confirmed: number;
  corrected: number;
  abstained: number;
  pendingReview: number;
  /** corregidas / (confirmadas + corregidas). null mientras nadie haya revisado nada. */
  correctionRate: number | null;
}

export interface FirstResponseStats {
  total: number;
  responded: number;
  withoutResponse: number;
  avgHours: number | null;
  medianHours: number | null;
  p90Hours: number | null;
  maxHours: number | null;
  /** Cuánto lleva esperando el caso más antiguo sin respuesta útil. */
  oldestWaitingHours: number | null;
}

/** Solo SQL: las cuatro preguntas del enunciado salen de la base, no de contadores guardados aparte. */
@Injectable()
export class MetricsRepository {
  /** Pregunta 1 (resumen). El detalle por caso es PanelRepository.listOpenClaims. */
  async clockSummary(c: Queryable): Promise<ClockSummary> {
    const { rows } = await c.query<ClockSummary>(
      `SELECT count(*)::int                                          AS open,
              count(*) FILTER (WHERE clock_state = 'sin_reloj')::int AS "withoutClock",
              count(*) FILTER (WHERE clock_state = 'en_plazo')::int  AS "onTime",
              count(*) FILTER (WHERE clock_state = 'en_riesgo')::int AS "atRisk",
              count(*) FILTER (WHERE clock_state = 'vencido')::int   AS expired
         FROM fn_claim_clock()`,
    );
    return rows[0];
  }

  /** Pregunta 2. */
  async modelCorrections(c: Queryable): Promise<ModelCorrectionRow[]> {
    const { rows } = await c.query<ModelCorrectionRow>(
      `SELECT subject, total::int, reviewed::int, confirmed::int, corrected::int, abstained::int,
              pending_review::int AS "pendingReview", correction_rate::float8 AS "correctionRate"
         FROM v_model_correction_rate
        ORDER BY subject`,
    );
    return rows;
  }

  /**
   * Pregunta 3. Los casos sin respuesta NO se esconden dentro del promedio: se cuentan aparte
   * y se reporta cuánto lleva esperando el más antiguo.
   */
  async firstResponse(c: Queryable): Promise<FirstResponseStats> {
    const { rows } = await c.query<FirstResponseStats>(
      `SELECT count(*)::int                                     AS total,
              count(hours_to_first_response)::int               AS responded,
              (count(*) - count(hours_to_first_response))::int  AS "withoutResponse",
              round(avg(hours_to_first_response), 2)::float8    AS "avgHours",
              round((percentile_cont(0.5) WITHIN GROUP (ORDER BY hours_to_first_response::float8))::numeric, 2)::float8
                                                                AS "medianHours",
              round((percentile_cont(0.9) WITHIN GROUP (ORDER BY hours_to_first_response::float8))::numeric, 2)::float8
                                                                AS "p90Hours",
              round(max(hours_to_first_response), 2)::float8    AS "maxHours",
              round((EXTRACT(EPOCH FROM (now() - min(received_at) FILTER (WHERE first_response_at IS NULL))) / 3600.0)::numeric, 2)::float8
                                                                AS "oldestWaitingHours"
         FROM v_first_response`,
    );
    return rows[0];
  }

  /** Pregunta 4: un caso al azar. */
  async randomClaim(c: Queryable): Promise<{ id: string; referenceCode: string } | null> {
    const { rows } = await c.query<{ id: string; referenceCode: string }>(
      `SELECT id, reference_code AS "referenceCode" FROM claims ORDER BY random() LIMIT 1`,
    );
    return rows[0] ?? null;
  }

  /** Casos sin ningún evento en la bitácora. Debe ser siempre 0: es la prueba de que todo caso se puede reconstruir. */
  async claimsWithoutEvents(c: Queryable): Promise<number> {
    const { rows } = await c.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM claims cl
        WHERE NOT EXISTS (SELECT 1 FROM claim_events e WHERE e.claim_id = cl.id)`,
    );
    return rows[0].n;
  }
}