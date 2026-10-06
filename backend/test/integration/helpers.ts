import { randomInt, randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Env } from '../../src/config/env.schema';
import { sha256Hex } from '../../src/common/utils/hash';
import { DatabaseService } from '../../src/database/database.service';
import { AuditService } from '../../src/modules/audit/audit.service';
import { ClaimsRepository } from '../../src/modules/claims/claims.repository';
import { ClaimsService, CreateClaimInput } from '../../src/modules/claims/claims.service';
import { buildStoragePath } from '../../src/modules/documents/file-storage';
import { generateTrackingToken } from '../../src/modules/claims/tracking-token';

/**
 * Arma los servicios reales contra la base de datos de pruebas.
 * Se niega a correr si la base no es claramente de pruebas: estos tests escriben
 * datos que no se pueden borrar (la bitácora es de solo inserción).
 */
export function createTestContext() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'Falta TEST_DATABASE_URL. Copia .env.test.example a .env.test y corre: npm run test:integration',
    );
  }
  const dbName = new URL(url).pathname.replace('/', '');
  if (!dbName.includes('test')) {
    throw new Error(`Por seguridad, la base de datos "${dbName}" no parece de pruebas (debe contener "test")`);
  }

  const values: Record<string, unknown> = {
    DATABASE_URL: url,
    DATABASE_SSL: false,
    DATABASE_POOL_MAX: 5,
  };
  const config = { get: (key: string) => values[key] } as unknown as ConfigService<Env, true>;

  const db = new DatabaseService(config);
  const audit = new AuditService(db);
  const claims = new ClaimsService(new ClaimsRepository(), audit);
  return { db, audit, claims };
}

/** Documento de identidad aleatorio de 8 dígitos (no se repite entre ejecuciones). */
export const randomDocument = (): string => String(randomInt(10_000_000, 99_999_999));

export function newClaimInput(overrides: Partial<CreateClaimInput> = {}): CreateClaimInput {
  return {
    channel: 'web',
    narrative: 'Mi padre falleció el mes pasado y quiero reclamar el seguro.',
    beneficiaryDocumentType: 'CC',
    beneficiaryDocumentNumber: randomDocument(),
    beneficiaryFullName: 'Ana María Pérez',
    beneficiaryEmail: 'ana.perez@example.com',
    beneficiaryPhone: '3001234567',
    insuredDocumentNumber: randomDocument(),
    insuredFullName: 'Carlos Pérez',
    consentAcceptedAt: new Date(),
    consentVersion: 'v1',
    trackingTokenHash: generateTrackingToken().hash,
    ...overrides,
  };
}

export const newIdempotencyKey = (): string => randomUUID();

/** Crea un usuario analista y devuelve su id. */
export async function createAnalyst(db: DatabaseService, fullName = 'Ana Analista'): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO users (email, full_name, password_hash) VALUES ($1, $2, 'hash-de-prueba') RETURNING id`,
    [`analista-${randomUUID()}@example.com`, fullName],
  );
  return rows[0].id;
}

/**
 * Crea un caso con su envío inicial y un documento que queda en 'pendiente_analisis'
 * (el default). Devuelve los ids del caso y del documento.
 */
export async function seedDocument(db: DatabaseService): Promise<{ claimId: string; documentId: string }> {
  const claims = new ClaimsService(new ClaimsRepository(), new AuditService(db));
  return db.withTransaction(async (c) => {
    const claim = await claims.createClaim(c, newClaimInput());
    const { submission } = await claims.registerSubmission(c, {
      claimId: claim.id,
      idempotencyKey: newIdempotencyKey(),
      kind: 'inicial',
      channel: 'web',
    });
    const buffer = Buffer.from(`seed-document-${claim.id}`);
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO documents (claim_id, submission_id, original_filename, mime_type, size_bytes, sha256, storage_path, status)
       VALUES ($1, $2, 'documento.pdf', 'application/pdf', $3, $4, $5, 'pendiente_analisis')
       RETURNING id`,
      [claim.id, submission.id, buffer.length, sha256Hex(buffer), buildStoragePath(sha256Hex(buffer), 'pdf')],
    );
    return { claimId: claim.id, documentId: rows[0].id };
  });
}