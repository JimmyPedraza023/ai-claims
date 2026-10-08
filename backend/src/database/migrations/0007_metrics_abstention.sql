-- 0007_metrics_abstention.sql
-- Pregunta 2: separar "acertó", "corrigió" y "se abstuvo".
-- La tasa se calcula sobre las predicciones en las que el modelo se atrevió a responder:
--   corrected / (confirmed + corrected).
-- Las abstenciones se reportan aparte: miden cuánto trabajo le deja el sistema a una persona.
CREATE OR REPLACE VIEW v_model_correction_rate AS
WITH base AS (
  SELECT subject, reviewed_at, predicted_value, final_value,
         CASE subject
           WHEN 'tipo_reclamacion'  THEN predicted_value = 'indeterminado'
           WHEN 'tipo_documento'    THEN predicted_value IN ('indeterminado', 'no_identificado')
           WHEN 'validez_documento' THEN predicted_value = 'requiere_revision'
           ELSE false
         END AS abstained
    FROM classifications
)
SELECT
  subject,
  count(*)                                                                   AS total,
  count(*) FILTER (WHERE reviewed_at IS NOT NULL)                            AS reviewed,
  count(*) FILTER (WHERE reviewed_at IS NOT NULL AND NOT abstained
                     AND final_value <> predicted_value)                     AS corrected,
  round(
    count(*) FILTER (WHERE reviewed_at IS NOT NULL AND NOT abstained AND final_value <> predicted_value)::numeric
    / NULLIF(count(*) FILTER (WHERE reviewed_at IS NOT NULL AND NOT abstained), 0), 4
  )                                                                          AS correction_rate,
  -- Columnas nuevas: siempre al final.
  count(*) FILTER (WHERE reviewed_at IS NOT NULL AND NOT abstained
                     AND final_value = predicted_value)                      AS confirmed,
  count(*) FILTER (WHERE reviewed_at IS NOT NULL AND abstained)              AS abstained,
  count(*) FILTER (WHERE reviewed_at IS NULL)                                AS pending_review
FROM base
GROUP BY subject;