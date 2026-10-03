-- 0004_metrics.sql
-- Las cuatro preguntas del enunciado, respondidas con datos reales (eventos,
-- notificaciones y clasificaciones), no con contadores precalculados.

-- ---------------------------------------------------------------------------
-- Pregunta 1: casos abiertos, día del plazo, en riesgo y vencidos.
-- El día se calcula al vuelo en hora de Colombia: nadie incrementa un contador.
-- deadline_date es el último día del plazo (inclusive): "vencido" solo después.
-- p_risk_days: días restantes a partir de los cuales el caso se considera en riesgo.
-- ---------------------------------------------------------------------------
CREATE FUNCTION fn_claim_clock(p_risk_days integer DEFAULT 7)
RETURNS TABLE (
  claim_id       uuid,
  reference_code text,
  status         claim_status,
  claim_type     claim_type,
  received_at    timestamptz,
  completed_at   timestamptz,
  deadline_date  date,
  days_elapsed   integer,
  days_total     integer,
  days_remaining integer,
  clock_state    text
)
LANGUAGE sql STABLE AS $$
  WITH hoy AS (SELECT (now() AT TIME ZONE 'America/Bogota')::date AS d)
  SELECT
    c.id,
    c.reference_code,
    c.status,
    c.claim_type,
    c.received_at,
    c.completed_at,
    c.deadline_date,
    CASE WHEN c.completed_at IS NOT NULL
         THEN hoy.d - (c.completed_at AT TIME ZONE 'America/Bogota')::date END,
    CASE WHEN c.completed_at IS NOT NULL
         THEN c.deadline_date - (c.completed_at AT TIME ZONE 'America/Bogota')::date END,
    CASE WHEN c.completed_at IS NOT NULL THEN c.deadline_date - hoy.d END,
    CASE
      WHEN c.completed_at IS NULL            THEN 'sin_reloj'
      WHEN c.deadline_date < hoy.d           THEN 'vencido'
      WHEN c.deadline_date - hoy.d <= p_risk_days THEN 'en_riesgo'
      ELSE 'en_plazo'
    END
  FROM claims c CROSS JOIN hoy
  WHERE c.status IN ('recibida', 'incompleta', 'completa')
$$;

-- ---------------------------------------------------------------------------
-- Pregunta 2: de las clasificaciones del modelo, ¿cuántas corrigió una persona?
-- La tasa se calcula sobre lo revisado; "reviewed" muestra cuánto se ha revisado.
-- ---------------------------------------------------------------------------
CREATE VIEW v_model_correction_rate AS
SELECT
  subject,
  count(*)                                                        AS total,
  count(*) FILTER (WHERE reviewed_at IS NOT NULL)                 AS reviewed,
  count(*) FILTER (WHERE reviewed_at IS NOT NULL
                     AND final_value <> predicted_value)          AS corrected,
  round(
    count(*) FILTER (WHERE reviewed_at IS NOT NULL AND final_value <> predicted_value)::numeric
    / NULLIF(count(*) FILTER (WHERE reviewed_at IS NOT NULL), 0), 4
  )                                                               AS correction_rate
FROM classifications
GROUP BY subject;

-- ---------------------------------------------------------------------------
-- Pregunta 3: tiempo desde que llega la radicación hasta que se le dice al
-- beneficiario qué le falta (o que quedó completo). El acuse de recibo NO cuenta:
-- no le dice nada útil. Sin respuesta útil enviada, hours_to_first_response es NULL.
-- ---------------------------------------------------------------------------
CREATE VIEW v_first_response AS
SELECT
  c.id            AS claim_id,
  c.reference_code,
  c.received_at,
  min(n.sent_at)  AS first_response_at,
  round((EXTRACT(EPOCH FROM (min(n.sent_at) - c.received_at)) / 3600.0)::numeric, 2)
                  AS hours_to_first_response
FROM claims c
LEFT JOIN notifications n
  ON  n.claim_id = c.id
  AND n.audience = 'beneficiario'
  AND n.status   = 'enviada'
  AND n.kind IN ('faltantes', 'documento_invalido', 'expediente_completo')
GROUP BY c.id, c.reference_code, c.received_at;

-- ---------------------------------------------------------------------------
-- Pregunta 4: historia completa de un caso, de principio a fin.
-- Uso: SELECT * FROM v_claim_timeline WHERE claim_id = $1 ORDER BY event_id;
-- ---------------------------------------------------------------------------
CREATE VIEW v_claim_timeline AS
SELECT
  e.claim_id,
  e.id          AS event_id,
  e.occurred_at,
  e.event_type,
  e.actor,
  u.full_name   AS actor_name,
  e.payload
FROM claim_events e
LEFT JOIN users u ON u.id = e.actor_user_id;