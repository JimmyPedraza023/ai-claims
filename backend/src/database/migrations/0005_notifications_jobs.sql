-- El trabajo "enviar_aviso" apunta a una fila de notifications (que ya trae destinatario, asunto y cuerpo).
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_kind_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_kind_check
  CHECK (kind IN ('analizar_documento', 'clasificar_reclamacion', 'evaluar_completitud', 'enviar_aviso'));

ALTER TABLE jobs ADD COLUMN notification_id uuid REFERENCES notifications (id);
ALTER TABLE jobs ADD CONSTRAINT jobs_notification_matches_kind
  CHECK ((kind = 'enviar_aviso') = (notification_id IS NOT NULL));