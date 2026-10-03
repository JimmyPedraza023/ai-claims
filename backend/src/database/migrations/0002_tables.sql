-- 0002_tables.sql
-- Todas las fechas son timestamptz. Las fechas "de calendario" del plazo legal
-- (deadline_date) se calculan en hora de Colombia (America/Bogota).
-- Nota deliberada: no existe ninguna columna de valor/monto de indemnización.
-- El sistema no lo calcula; eso lo hace una persona fuera de este sistema.

-- ---------------------------------------------------------------- usuarios
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text        NOT NULL,
  full_name     text        NOT NULL,
  password_hash text        NOT NULL,
  role          user_role   NOT NULL DEFAULT 'analista',
  is_active     boolean     NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_lowercase CHECK (email = lower(email))
);
CREATE UNIQUE INDEX users_email_key ON users (email);

-- --------------------------------------------------------------- reclamaciones
CREATE SEQUENCE claim_reference_seq START 1;

CREATE TABLE claims (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_code              text NOT NULL UNIQUE DEFAULT (
    'RC-' || to_char(now() AT TIME ZONE 'America/Bogota', 'YYYY') || '-' ||
    lpad(nextval('claim_reference_seq')::text, 6, '0')
  ),
  status                      claim_status NOT NULL DEFAULT 'recibida',
  -- Tipo vigente (inferido por el modelo o corregido por una persona).
  -- El detalle y la trazabilidad viven en classifications.
  claim_type                  claim_type,
  channel                     intake_channel NOT NULL,
  narrative                   text NOT NULL,

  beneficiary_document_type   text NOT NULL,
  beneficiary_document_number text NOT NULL,
  beneficiary_full_name       text NOT NULL,
  beneficiary_email           text NOT NULL,
  beneficiary_phone           text,
  insured_document_number     text NOT NULL,
  insured_full_name           text NOT NULL,

  consent_accepted_at         timestamptz NOT NULL,
  consent_version             text NOT NULL,

  -- Solo se guarda el hash del token de seguimiento, nunca el token.
  tracking_token_hash         char(64) NOT NULL UNIQUE,

  received_at                 timestamptz NOT NULL DEFAULT now(),
  -- El reloj legal arranca cuando el expediente queda completo, no al radicar.
  completed_at                timestamptz,
  deadline_date               date,        -- último día del plazo (inclusive), hora Colombia
  closed_at                   timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),

  -- Sin completar => sin reloj; completo => con reloj. Imposible mezclarlos.
  CONSTRAINT claims_clock_matches_status
    CHECK ((status IN ('recibida', 'incompleta')) = (completed_at IS NULL)),
  CONSTRAINT claims_deadline_matches_completion
    CHECK ((completed_at IS NULL) = (deadline_date IS NULL)),
  CONSTRAINT claims_closed_matches_status
    CHECK ((status IN ('pagada', 'objetada')) = (closed_at IS NOT NULL)),
  CONSTRAINT claims_completed_after_received
    CHECK (completed_at IS NULL OR completed_at >= received_at),
  CONSTRAINT claims_deadline_after_completion
    CHECK (deadline_date IS NULL
           OR deadline_date > (completed_at AT TIME ZONE 'America/Bogota')::date)
);

-- Un reenvío no abre un segundo expediente: un solo caso abierto por
-- beneficiario + asegurado.
CREATE UNIQUE INDEX claims_one_open_per_beneficiary_insured
  ON claims (beneficiary_document_number, insured_document_number)
  WHERE closed_at IS NULL;

CREATE INDEX claims_status_idx ON claims (status);
CREATE INDEX claims_deadline_open_idx ON claims (deadline_date) WHERE status = 'completa';

-- ------------------------------------------------------------------ envíos
-- Cada interacción de radicación (inicial o complemento). La llave de
-- idempotencia la genera el cliente: un doble clic o un reintento = misma llave.
CREATE TABLE submissions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id        uuid NOT NULL REFERENCES claims (id),
  idempotency_key text NOT NULL UNIQUE,
  kind            text NOT NULL CHECK (kind IN ('inicial', 'complemento')),
  channel         intake_channel NOT NULL,
  client_ip_hash  text,
  user_agent      text,
  received_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX submissions_claim_idx ON submissions (claim_id);

-- --------------------------------------------------------------- documentos
CREATE TABLE documents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id          uuid NOT NULL REFERENCES claims (id),
  submission_id     uuid NOT NULL REFERENCES submissions (id),
  original_filename text   NOT NULL,
  mime_type         text   NOT NULL,           -- verificado por magic bytes, no por extensión
  size_bytes        bigint NOT NULL CHECK (size_bytes > 0),
  sha256            char(64) NOT NULL,
  storage_path      text   NOT NULL,

  -- Estado vigente (resultado del modelo o corrección humana).
  document_type     document_type,
  status            document_status NOT NULL DEFAULT 'pendiente_analisis',
  issue             document_issue,
  issue_detail      text,
  extracted_data    jsonb,                     -- campos extraídos por el modelo (firma, legibilidad, nombres...)

  uploaded_at       timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  -- El mismo archivo dos veces en el mismo caso no crea otro documento.
  CONSTRAINT documents_unique_file_per_claim UNIQUE (claim_id, sha256),
  -- "Llegó pero no sirve" siempre trae motivo.
  CONSTRAINT documents_invalid_has_issue CHECK (status <> 'invalido' OR issue IS NOT NULL)
);
CREATE INDEX documents_claim_idx ON documents (claim_id);

-- --------------------------------------------------------- ejecuciones de IA
CREATE TABLE ai_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id       uuid NOT NULL REFERENCES claims (id),
  document_id    uuid REFERENCES documents (id),
  task           ai_task NOT NULL,
  provider       text NOT NULL,
  model          text NOT NULL,
  prompt_version text NOT NULL,
  input_ref      jsonb NOT NULL,   -- qué se envió (ids, hashes, longitudes); no el contenido crudo
  raw_output     text,
  parsed_output  jsonb,            -- salida ya validada contra el esquema
  status         ai_run_status NOT NULL,
  error          text,
  latency_ms     integer,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_runs_claim_idx ON ai_runs (claim_id, created_at);
CREATE INDEX ai_runs_status_idx ON ai_runs (status, created_at);

-- ------------------------------------------------------------ clasificaciones
-- Lo que predijo el modelo y lo que dijo la persona. Es la base de la métrica
-- "¿cuántas clasificaciones tuvo que corregir una persona?".
CREATE TABLE classifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id        uuid NOT NULL REFERENCES claims (id),
  document_id     uuid REFERENCES documents (id),
  ai_run_id       uuid NOT NULL REFERENCES ai_runs (id),
  subject         classification_subject NOT NULL,
  predicted_value text NOT NULL,
  confidence      numeric(4, 3) CHECK (confidence BETWEEN 0 AND 1),
  evidence        text,
  final_value     text,            -- valor tras revisión humana (igual al predicho si lo confirmó)
  reviewed_by     uuid REFERENCES users (id),
  reviewed_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT classifications_review_complete
    CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL)
       AND (reviewed_at IS NULL) = (final_value IS NULL)),
  CONSTRAINT classifications_document_scope
    CHECK ((subject = 'tipo_reclamacion') = (document_id IS NULL))
);
CREATE INDEX classifications_claim_idx ON classifications (claim_id);

-- --------------------------------------------------- evaluaciones de completitud
-- Qué determinó el sistema, con qué reglas y con qué información.
CREATE TABLE completeness_evaluations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id      uuid NOT NULL REFERENCES claims (id),
  claim_type    claim_type NOT NULL,
  rules_version text NOT NULL,
  is_complete   boolean NOT NULL,
  result        jsonb NOT NULL,   -- requisitos: faltante / valido / invalido (+ motivo) y documentos considerados
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX completeness_claim_idx ON completeness_evaluations (claim_id, created_at DESC);

-- ----------------------------------------------------------------- eventos
-- Bitácora de solo inserción. De aquí se reconstruye cualquier caso.
CREATE TABLE claim_events (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  claim_id      uuid NOT NULL REFERENCES claims (id),
  event_type    text NOT NULL,
  actor         actor_type NOT NULL,
  actor_user_id uuid REFERENCES users (id),
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT claim_events_analyst_has_user CHECK ((actor = 'analista') = (actor_user_id IS NOT NULL))
);
CREATE INDEX claim_events_claim_idx ON claim_events (claim_id, id);
CREATE INDEX claim_events_type_idx ON claim_events (event_type, occurred_at);

-- -------------------------------------------------------------- decisiones
-- Siempre humanas. decided_by es obligatorio y no hay columna de valor.
CREATE TABLE decisions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id            uuid NOT NULL REFERENCES claims (id),
  kind                decision_kind NOT NULL,
  decided_by          uuid NOT NULL REFERENCES users (id),
  reason              text NOT NULL CHECK (length(btrim(reason)) > 0),
  requested_documents document_type[],
  evaluation_id       uuid REFERENCES completeness_evaluations (id),  -- lo que el analista tenía a la vista
  decided_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT decisions_request_has_documents
    CHECK ((kind = 'pedir_documentos') = (requested_documents IS NOT NULL AND cardinality(requested_documents) > 0))
);
CREATE INDEX decisions_claim_idx ON decisions (claim_id, decided_at);
-- Solo un cierre (pagar u objetar) por caso.
CREATE UNIQUE INDEX decisions_one_closing_per_claim
  ON decisions (claim_id) WHERE kind IN ('pagar', 'objetar');

-- ---------------------------------------------------------- notificaciones
CREATE TABLE notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id    uuid NOT NULL REFERENCES claims (id),
  kind        notification_kind NOT NULL,
  audience    text NOT NULL CHECK (audience IN ('beneficiario', 'analistas')),
  channel     text NOT NULL DEFAULT 'correo',
  recipient   text NOT NULL,
  subject     text NOT NULL,
  body        text NOT NULL,
  -- Evita avisos repetidos: p. ej. 'riesgo:<claim>:dia-20'.
  dedupe_key  text NOT NULL UNIQUE,
  status      notification_status NOT NULL DEFAULT 'pendiente',
  attempts    integer NOT NULL DEFAULT 0,
  last_error  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz,
  CONSTRAINT notifications_sent_matches_status CHECK ((status = 'enviada') = (sent_at IS NOT NULL))
);
CREATE INDEX notifications_pending_idx ON notifications (created_at) WHERE status = 'pendiente';
CREATE INDEX notifications_claim_idx ON notifications (claim_id);

-- --------------------------------------------------- cola de trabajos (outbox)
-- Se guarda primero, se procesa después: si el modelo falla, la radicación
-- ya existe y el trabajo se reintenta. El worker toma filas con
-- FOR UPDATE SKIP LOCKED.
CREATE TABLE jobs (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind         text NOT NULL
               CHECK (kind IN ('analizar_documento', 'clasificar_reclamacion', 'evaluar_completitud')),
  claim_id     uuid NOT NULL REFERENCES claims (id),
  document_id  uuid REFERENCES documents (id),
  dedupe_key   text NOT NULL UNIQUE,
  status       job_status NOT NULL DEFAULT 'pendiente',
  attempts     integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  run_at       timestamptz NOT NULL DEFAULT now(),
  locked_at    timestamptz,
  locked_by    text,
  last_error   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz
);
CREATE INDEX jobs_ready_idx ON jobs (run_at) WHERE status = 'pendiente';
CREATE INDEX jobs_running_idx ON jobs (locked_at) WHERE status = 'en_proceso';