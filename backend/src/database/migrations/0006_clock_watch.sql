CREATE TABLE clock_watch_runs (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  claims_checked  integer,
  at_risk         integer,
  expired         integer,
  alerts_created  integer,
  failed          integer,
  error           text
);
-- 0003 solo cubrió las tablas que existían entonces.
ALTER TABLE clock_watch_runs ENABLE ROW LEVEL SECURITY;

-- Para eventos de la línea de tiempo del caso (ajusta si event_type tiene CHECK o enum).