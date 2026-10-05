/**
 * Runner mínimo de migraciones SQL.
 * - Aplica en orden alfabético los .sql de ./migrations que no estén registrados.
 * - Cada archivo corre en su propia transacción: o se aplica completo o nada.
 * - Usa un advisory lock para que dos procesos no migren a la vez.
 * - Solo hacia adelante: un error se corrige con una migración nueva.
 *
 * IMPORTANTE (Supabase): usar la conexión DIRECTA o el pooler en modo "session"
 * (puerto 5432). El pooler en modo "transaction" (6543) no soporta advisory locks.
 *
 * Uso: DATABASE_URL=postgres://... npx tsx src/database/migrate.ts
 */
import 'dotenv/config';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

const MIGRATIONS_DIR = join(__dirname, 'migrations');
const LOCK_ID = 727_001; // arbitrario, fijo para este proyecto

async function main(): Promise<void> {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('MIGRATION_DATABASE_URL o DATABASE_URL debe estar definida');

  const client = new Client({
    connectionString: url,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();

  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);

    const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.name));

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    let count = 0;
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      console.log(`→ aplicando ${file}`);
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        count++;
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Falló ${file}: ${(err as Error).message}`);
      }
    }
    console.log(count === 0 ? 'Base de datos al día.' : `Listo: ${count} migración(es) aplicada(s).`);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => undefined);
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});