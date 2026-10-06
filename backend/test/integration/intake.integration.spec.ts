// backend/test/integration/intake.integration.spec.ts
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256Hex } from '../../src/common/utils/hash';
import { IdempotencyKeyConflictError } from '../../src/modules/claims/claims.errors';
import { hashTrackingToken } from '../../src/modules/claims/tracking-token';
import { DocumentsRepository } from '../../src/modules/documents/documents.repository';
import { InvalidFileError } from '../../src/modules/documents/documents.errors';
import { DocumentsService } from '../../src/modules/documents/documents.service';
import type { UploadedFile } from '../../src/modules/documents/documents.service';
import { LocalFileStorage } from '../../src/modules/documents/local-file-storage';
import { IntakeService } from '../../src/modules/intake/intake.service';
import type { IntakeRequest } from '../../src/modules/intake/intake.service';
import type { IntakeInput } from '../../src/modules/intake/intake.schema';
import { JobsRepository } from '../../src/modules/jobs/jobs.repository';
import { createTestContext, newIdempotencyKey, randomDocument } from './helpers';
import { SubmissionProcessor } from '../../src/modules/intake/submission-processor';

describe('IntakeService (contra PostgreSQL real)', () => {
  const ctx = createTestContext();
  let storageDir: string;
  let intake: IntakeService;

  beforeAll(async () => {
    storageDir = await mkdtemp(join(tmpdir(), 'aix-intake-'));
    const documents = new DocumentsService(
      new LocalFileStorage(storageDir),
      new DocumentsRepository(),
      ctx.audit,
    );
    intake = new IntakeService(
      ctx.db,
      ctx.claims,
      ctx.audit,
      new SubmissionProcessor(documents, new JobsRepository()),
    );
  });

  afterAll(async () => {
    await ctx.db.onModuleDestroy();
    await rm(storageDir, { recursive: true, force: true });
  });

  /** PDF mínimo: empieza con la firma %PDF y lleva bytes aleatorios para que cada uno sea distinto. */
  const pdf = (): Buffer =>
    Buffer.concat([Buffer.from('%PDF-1.4\n'), randomBytes(64), Buffer.from('\n%%EOF')]);
  const file = (buffer: Buffer, name = 'documento.pdf'): UploadedFile => ({
    originalname: name,
    buffer,
  });

  function form(overrides: Partial<IntakeInput> = {}): IntakeInput {
    return {
      idempotencyKey: newIdempotencyKey(),
      narrative: 'Mi padre falleció el mes pasado y quiero reclamar el seguro.',
      beneficiaryDocumentType: 'CC',
      beneficiaryDocumentNumber: randomDocument(),
      beneficiaryFullName: 'Ana María Pérez',
      beneficiaryEmail: 'ana.perez@example.com',
      beneficiaryPhone: '3001234567',
      insuredDocumentNumber: randomDocument(),
      insuredFullName: 'Carlos Pérez',
      consentAccepted: true,
      ...overrides,
    };
  }

  const request = (f: IntakeInput, files: UploadedFile[] = [file(pdf())]): IntakeRequest => ({
    channel: 'web',
    form: f,
    files,
  });

  const events = async (claimId: string): Promise<string[]> => {
    const { rows } = await ctx.db.query<{ event_type: string }>(
      'SELECT event_type FROM claim_events WHERE claim_id = $1 ORDER BY id',
      [claimId],
    );
    return rows.map((r) => r.event_type);
  };

  const count = async (table: 'submissions' | 'documents', claimId: string): Promise<number> => {
    const { rows } = await ctx.db.query<{ n: string }>(
      `SELECT count(*) AS n FROM ${table} WHERE claim_id = $1`,
      [claimId],
    );
    return Number(rows[0].n);
  };

  const countClaimsOf = async (beneficiaryDocument: string): Promise<number> => {
    const { rows } = await ctx.db.query<{ n: string }>(
      'SELECT count(*) AS n FROM claims WHERE beneficiary_document_number = $1',
      [beneficiaryDocument],
    );
    return Number(rows[0].n);
  };

  it('radicación nueva: guarda caso, envío, documento, eventos y trabajos, sin arrancar el reloj', async () => {
    const result = await intake.receive(request(form()));

    expect(result.outcome).toBe('created');
    if (result.outcome !== 'created') return;
    expect(result.referenceCode).toMatch(/^RC-\d{4}-\d{6}$/);
    expect(result.documents.stored).toHaveLength(1);

    const { rows } = await ctx.db.query(
      'SELECT status, completed_at, deadline_date, tracking_token_hash FROM claims WHERE id = $1',
      [result.claimId],
    );
    expect(rows[0].status).toBe('recibida');
    expect(rows[0].completed_at).toBeNull(); // el reloj NO arranca al radicar
    expect(rows[0].deadline_date).toBeNull();
    // En la base solo está el hash del token, nunca el token.
    expect(rows[0].tracking_token_hash).toBe(hashTrackingToken(result.trackingToken));
    expect(rows[0].tracking_token_hash).not.toBe(result.trackingToken);

    expect(await count('submissions', result.claimId)).toBe(1);
    expect(await count('documents', result.claimId)).toBe(1);

    const eventTypes = await events(result.claimId);
    expect(eventTypes).toContain('reclamacion_recibida');
    expect(eventTypes).toContain('documento_recibido');

    const jobs = await ctx.db.query<{ kind: string }>(
      'SELECT kind FROM jobs WHERE claim_id = $1 ORDER BY kind',
      [result.claimId],
    );
    expect(jobs.rows.map((j) => j.kind)).toEqual(['analizar_documento', 'clasificar_reclamacion']);
  });

  it('la misma radicación dos veces no crea otro caso, ni otro archivo, ni toca el reloj', async () => {
    const f = form();
    const files = [file(pdf())];

    const first = await intake.receive(request(f, files));
    const second = await intake.receive(request(f, files));

    expect(first.outcome).toBe('created');
    expect(second.outcome).toBe('duplicate');
    expect(second.claimId).toBe(first.claimId);

    expect(await countClaimsOf(f.beneficiaryDocumentNumber)).toBe(1);
    expect(await count('submissions', first.claimId)).toBe(1);
    expect(await count('documents', first.claimId)).toBe(1);
    expect(await events(first.claimId)).toContain('envio_duplicado_ignorado');

    const { rows } = await ctx.db.query('SELECT completed_at FROM claims WHERE id = $1', [
      first.claimId,
    ]);
    expect(rows[0].completed_at).toBeNull();
  });

  it('cinco envíos simultáneos con la misma llave dejan un solo caso y un solo envío', async () => {
    const f = form();
    const files = [file(pdf())];

    const results = await Promise.all(
      Array.from({ length: 5 }, () => intake.receive(request(f, files))),
    );

    expect(await countClaimsOf(f.beneficiaryDocumentNumber)).toBe(1);
    const claimIds = new Set(results.map((r) => r.claimId));
    expect(claimIds.size).toBe(1);
    expect(results.filter((r) => r.outcome === 'created')).toHaveLength(1);
    expect(await count('submissions', results[0].claimId)).toBe(1);
  });

  it('con un caso abierto, un envío nuevo (otra llave) se anexa y no cambia el relato original', async () => {
    const original = form();
    const first = await intake.receive(request(original));

    const followUp = form({
      beneficiaryDocumentNumber: original.beneficiaryDocumentNumber,
      insuredDocumentNumber: original.insuredDocumentNumber,
      narrative: 'Adjunto los documentos que faltaban, gracias por la ayuda.',
    });
    const second = await intake.receive(request(followUp));

    expect(second.outcome).toBe('appended');
    expect(second.claimId).toBe(first.claimId);
    expect(await countClaimsOf(original.beneficiaryDocumentNumber)).toBe(1);
    expect(await count('submissions', first.claimId)).toBe(2);
    expect(await count('documents', first.claimId)).toBe(2);
    expect(await events(first.claimId)).toContain('complemento_recibido');

    const { rows } = await ctx.db.query('SELECT narrative FROM claims WHERE id = $1', [
      first.claimId,
    ]);
    expect(rows[0].narrative).toBe(original.narrative.trim());
  });

  it('un archivo falso (ejecutable renombrado a .pdf) se rechaza y no deja nada a medias', async () => {
    const f = form();
    const fake = file(Buffer.concat([Buffer.from('MZ'), randomBytes(64)]), 'cedula.pdf');

    await expect(intake.receive(request(f, [fake]))).rejects.toBeInstanceOf(InvalidFileError);

    expect(await countClaimsOf(f.beneficiaryDocumentNumber)).toBe(0);
    const { rows } = await ctx.db.query('SELECT 1 FROM submissions WHERE idempotency_key = $1', [
      f.idempotencyKey,
    ]);
    expect(rows).toHaveLength(0);
  });

  it('una llave de idempotencia de otra reclamación se rechaza y revierte todo', async () => {
    const key = randomUUID();
    await intake.receive(request(form({ idempotencyKey: key })));

    const other = form({ idempotencyKey: key });
    await expect(intake.receive(request(other))).rejects.toBeInstanceOf(
      IdempotencyKeyConflictError,
    );

    // El caso que se alcanzó a insertar dentro de la transacción no quedó guardado.
    expect(await countClaimsOf(other.beneficiaryDocumentNumber)).toBe(0);
  });

  it('el hash de cada archivo coincide con el guardado (trazabilidad del documento)', async () => {
    const buffer = pdf();
    const result = await intake.receive(request(form(), [file(buffer)]));
    if (result.outcome !== 'created') throw new Error('se esperaba un caso nuevo');

    expect(result.documents.stored[0].sha256).toBe(sha256Hex(buffer));
  });
});