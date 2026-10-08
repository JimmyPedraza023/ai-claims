import { hash } from '@node-rs/argon2';
import { Client } from 'pg';

async function main() {
  const email = process.env.SEED_ANALYST_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ANALYST_PASSWORD;

  if (!email || !password || password.length < 12) {
    throw new Error(
      'Define SEED_ANALYST_EMAIL y SEED_ANALYST_PASSWORD (mínimo 12 caracteres)',
    );
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl:
      process.env.DATABASE_SSL === 'true'
        ? { rejectUnauthorized: false }
        : undefined,
  });

  try {
    await client.connect();

    await client.query(
      `INSERT INTO users (email, full_name, password_hash, role)
       VALUES ($1, 'Analista de prueba', $2, 'analista')
       ON CONFLICT (email)
       DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         is_active = true`,
      [email, await hash(password)],
    );

    console.log(`Analista de prueba creado/actualizado: ${email}`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});