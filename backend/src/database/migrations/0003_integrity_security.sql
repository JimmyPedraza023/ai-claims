-- 0003_integrity_security.sql
-- Las reglas que no se pueden romper se hacen cumplir en la base de datos,
-- no solo en el código de la aplicación.

-- ------------------------------------------------ registros de solo inserción
CREATE FUNCTION forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'La tabla % es de solo inserción (% no permitido)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['claim_events', 'ai_runs', 'completeness_evaluations', 'decisions']
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION forbid_mutation()',
      t || '_append_only', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation()',
      t || '_no_truncate', t);
  END LOOP;
END $$;

-- Los expedientes y sus archivos no se borran (retención y trazabilidad).
CREATE TRIGGER claims_no_delete BEFORE DELETE ON claims
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER documents_no_delete BEFORE DELETE ON documents
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ------------------------------------------- el reloj no se reinicia ni se mueve
-- Una vez que el expediente quedó completo, completed_at y deadline_date son
-- hechos. Ni un duplicado ni un bug pueden reiniciar el plazo.
CREATE FUNCTION protect_claim_clock() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.received_at IS DISTINCT FROM OLD.received_at THEN
    RAISE EXCEPTION 'received_at es inmutable (claim %)', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.completed_at IS NOT NULL AND (
       NEW.completed_at  IS DISTINCT FROM OLD.completed_at OR
       NEW.deadline_date IS DISTINCT FROM OLD.deadline_date) THEN
    RAISE EXCEPTION 'El reloj legal ya arrancó y no puede modificarse (claim %)', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER claims_protect_clock BEFORE UPDATE ON claims
  FOR EACH ROW EXECUTE FUNCTION protect_claim_clock();

-- ------------------------------------------------------------- updated_at
CREATE FUNCTION touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER claims_touch BEFORE UPDATE ON claims
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER documents_touch BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ----------------------------------------------------------------- seguridad
-- Supabase expone el esquema public por su API REST. Se activa RLS en todas las
-- tablas sin políticas (= denegar todo a anon/authenticated). El backend se
-- conecta con el rol dueño, que no pasa por RLS. Si algún día el backend usa un
-- rol sin privilegios, habrá que crearle políticas explícitas.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations'
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon';
    EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated';
    EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM authenticated';
  END IF;
END $$;