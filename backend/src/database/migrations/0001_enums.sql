-- 0001_enums.sql
-- Vocabulario cerrado del dominio. Los conjuntos que cambian con frecuencia
-- (p. ej. event_type en claim_events) se dejan como text a propósito.

CREATE TYPE claim_type AS ENUM (
  'muerte_natural',
  'muerte_accidental',
  'incapacidad_total_permanente'
);

-- recibida   : llegó, aún no se evalúa
-- incompleta : evaluada, faltan documentos o alguno no sirve (el reloj NO corre)
-- completa   : expediente completo (el reloj corre desde completed_at)
-- pagada / objetada : cierre registrado por una persona
CREATE TYPE claim_status AS ENUM (
  'recibida',
  'incompleta',
  'completa',
  'pagada',
  'objetada'
);

CREATE TYPE document_type AS ENUM (
  'formato_reclamacion',
  'registro_civil_defuncion',
  'certificado_medico_defuncion',
  'documento_identidad_asegurado',
  'documento_identidad_beneficiario',
  'formulario_sarlaft',
  'certificacion_bancaria',
  'informe_autoridad',
  'dictamen_perdida_capacidad_laboral',
  'historia_clinica_resumida',
  'otro',
  'no_identificado'
);

-- valido: presente Y sirve. invalido: presente pero no sirve (ver document_issue).
-- requiere_revision: el modelo no tuvo confianza suficiente; lo decide una persona.
CREATE TYPE document_status AS ENUM (
  'pendiente_analisis',
  'valido',
  'invalido',
  'requiere_revision'
);

CREATE TYPE document_issue AS ENUM (
  'sin_firma',
  'ilegible',
  'no_corresponde_asegurado',
  'no_corresponde_beneficiario',
  'tipo_no_reconocido',
  'incompleto',
  'archivo_danado',
  'otro'
);

CREATE TYPE decision_kind AS ENUM ('pagar', 'objetar', 'pedir_documentos');

CREATE TYPE actor_type AS ENUM ('sistema', 'modelo', 'beneficiario', 'analista');

CREATE TYPE user_role AS ENUM ('analista', 'admin');

CREATE TYPE intake_channel AS ENUM ('web', 'telegram', 'whatsapp', 'correo', 'oficina');

CREATE TYPE classification_subject AS ENUM (
  'tipo_reclamacion',
  'tipo_documento',
  'validez_documento'
);

CREATE TYPE ai_task AS ENUM ('clasificar_reclamacion', 'analizar_documento');

CREATE TYPE ai_run_status AS ENUM ('ok', 'salida_invalida', 'error', 'timeout');

CREATE TYPE notification_kind AS ENUM (
  'acuse_radicacion',          -- "recibimos tu solicitud" (NO cuenta como primera respuesta útil)
  'faltantes',                 -- qué documentos faltan
  'documento_invalido',        -- llegó pero no sirve, y por qué
  'expediente_completo',
  'recordatorio_beneficiario',
  'alerta_riesgo',             -- interna: caso en riesgo de vencerse
  'alerta_vencido'             -- interna: caso vencido
);

CREATE TYPE notification_status AS ENUM ('pendiente', 'enviada', 'fallida');

CREATE TYPE job_status AS ENUM ('pendiente', 'en_proceso', 'completado', 'fallido');