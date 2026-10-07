// backend/test/integration/complement.integration.spec.ts
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { DatabaseService } from '../../src/database/database.service';
import { ClaimsService } from '../../src/modules/claims/claims.service';
import { generateTrackingToken } from '../../src/modules/claims/tracking-token';
import { DocumentsRepository } from '../../src/modules/documents/documents.repository';
import { DocumentsService } from '../../src/modules/documents/documents.service';
import { LocalFileStorage } from '../../src/modules/documents/local-file-storage';
import { ComplementController } from '../../src/modules/intake/complement.controller';
import { ComplementService } from '../../src/modules/intake/complement.service';
import { SubmissionProcessor } from '../../src/modules/intake/submission-processor';
import { TrackingService } from '../../src/modules/intake/tracking.service';
import { JobsRepository } from '../../src/modules/jobs/jobs.repository';
import { createTestContext, newClaimInput, newIdempotencyKey } from './helpers';

type ClaimState = 'incompleta' | 'completa' | 'pagada';

describe('POST /tracking/documents (HTTP real, contra PostgreSQL real)', () => {
  const ctx = createTestContext();
  let app: INestApplication;
  let storageDir: string;

  beforeAll(async () => {
    storageDir = await mkdtemp(join(tmpdir(), 'aix-complement-'));
    const documents = new DocumentsService(
      new LocalFileStorage(storageDir),
      new DocumentsRepository(),
      ctx.audit,
    );
    const processor = new SubmissionProcessor(documents, new JobsRepository());
    const complement = new ComplementService(ctx.db, ctx.claims, ctx.audit, processor);
    const tracking = new TrackingService(ctx.db, ctx.claims, documents);

    const moduleRef = await Test.createTestingModule({
      controllers: [ComplementController],
      providers: [
        { provide: ComplementService, useValue: complement },
        { provide: TrackingService, useValue: tracking },
        // El guard del token necesita estos dos.
        { provide: DatabaseService, useValue: ctx.db },
        { provide: ClaimsService, useValue: ctx.claims },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => (key === 'IP_HASH_SECRET' ? 'secreto-de-pruebas-0123456789' : undefined) },
        },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
      // El controlador limita a 5 subidas por minuto (el @Throttle pisa la config del módulo) y esta
      // suite manda más peticiones que eso en la misma ventana. El límite se prueba en
      // intake.throttle.integration.spec.ts, así que aquí se desactiva el guard.
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    // app.close() ya dispara onModuleDestroy de DatabaseService (está como provider),
    // así que el pool no se cierra una segunda vez a mano.
    await app.close();
    await rm(storageDir, { recursive: true, force: true });
  });

  // ---------- utilidades ----------

  const CLOCK = `completed_at = now(), deadline_date = ((now() AT TIME ZONE 'America/Bogota')::date + 30)`;
  const STATE_SQL: Record<ClaimState, string> = {
    incompleta: `status = 'incompleta'`,
    completa: `status = 'completa', ${CLOCK}`,
    pagada: `status = 'pagada', ${CLOCK}, closed_at = now()`,
  };

  /** Un caso ya clasificado como muerte natural, con su envío inicial, en el estado pedido. */
  async function createClaim(state: ClaimState = 'incompleta') {
    const { token, hash } = generateTrackingToken();
    const claim = await ctx.claims.createClaim(ctx.db, newClaimInput({ trackingTokenHash: hash }));
    await ctx.claims.registerSubmission(ctx.db, {
      claimId: claim.id,
      idempotencyKey: newIdempotencyKey(),
      kind: 'inicial',
      channel: 'web',
    });
    await ctx.db.query(
      `UPDATE claims SET claim_type = 'muerte_natural', ${STATE_SQL[state]} WHERE id = $1`,
      [claim.id],
    );
    return { claimId: claim.id, token };
  }

  const pdf = (name = 'documento.pdf') => ({
    name,
    buffer: Buffer.concat([Buffer.from('%PDF-1.4\n'), randomBytes(64), Buffer.from('\n%%EOF')]),
  });

  function upload(
    token: string | undefined,
    key: string | undefined,
    files: { name: string; buffer: Buffer }[] = [],
  ) {
    let req = request(app.getHttpServer()).post('/tracking/documents');
    if (token !== undefined) req = req.set('x-tracking-token', token);
    if (key !== undefined) req = req.field('idempotencyKey', key);
    for (const f of files) {
      req = req.attach('files', f.buffer, { filename: f.name, contentType: 'application/pdf' });
    }
    return req;
  }

  const count = async (table: 'documents', claimId: string): Promise<number> => {
    const { rows } = await ctx.db.query<{ n: string }>(
      `SELECT count(*) AS n FROM ${table} WHERE claim_id = $1`,
      [claimId],
    );
    return Number(rows[0].n);
  };

  const submissionKinds = async (claimId: string): Promise<string[]> => {
    const { rows } = await ctx.db.query<{ kind: string }>(
      'SELECT kind FROM submissions WHERE claim_id = $1 ORDER BY received_at, id',
      [claimId],
    );
    return rows.map((r) => r.kind);
  };

  const eventTypes = async (claimId: string): Promise<string[]> => {
    const { rows } = await ctx.db.query<{ event_type: string }>(
      'SELECT event_type FROM claim_events WHERE claim_id = $1 ORDER BY id',
      [claimId],
    );
    return rows.map((r) => r.event_type);
  };

  // ---------- pruebas ----------

  it('sube un documento: 202, queda como complemento con sus trabajos, y la vista lo refleja', async () => {
    const { claimId, token } = await createClaim();
    const res = await upload(token, newIdempotencyKey(), [pdf()]);

    expect(res.status).toBe(202);
    expect(res.body.message).toEqual(expect.any(String));
    expect(res.body.tracking.documentsReceived).toBe(1);
    // El archivo recién llegado aún no se analiza: no se afirma que algo "falta" todavía.
    expect(res.body.tracking.checklist.some((i: { state: string }) => i.state === 'falta')).toBe(false);

    expect(await count('documents', claimId)).toBe(1);
    expect(await submissionKinds(claimId)).toEqual(['inicial', 'complemento']);
    expect(await eventTypes(claimId)).toEqual(
      expect.arrayContaining(['complemento_recibido', 'documento_recibido']),
    );

    const jobs = await ctx.db.query<{ kind: string }>(
      'SELECT kind FROM jobs WHERE claim_id = $1 ORDER BY kind',
      [claimId],
    );
    expect(jobs.rows.map((j) => j.kind)).toEqual(['analizar_documento', 'clasificar_reclamacion']);
  });

  it('el mismo envío repetido (misma llave) responde igual y no duplica nada', async () => {
    const { claimId, token } = await createClaim();
    const key = newIdempotencyKey();
    const file = pdf();

    const first = await upload(token, key, [file]);
    const repeated = await upload(token, key, [file]);

    expect(first.status).toBe(202);
    expect(repeated.status).toBe(202);
    expect(repeated.body).toEqual(first.body);
    expect(await count('documents', claimId)).toBe(1);
    expect(await submissionKinds(claimId)).toEqual(['inicial', 'complemento']);
    expect(await eventTypes(claimId)).toContain('envio_duplicado_ignorado');
  });

  it('cuatro envíos simultáneos de lo mismo dejan un solo documento y un solo complemento', async () => {
    const { claimId, token } = await createClaim();
    const key = newIdempotencyKey();
    const file = pdf();

    const results = await Promise.all(
      Array.from({ length: 4 }, () => upload(token, key, [file])),
    );

    for (const r of results) expect(r.status).toBe(202);
    expect(await count('documents', claimId)).toBe(1);
    expect(await submissionKinds(claimId)).toEqual(['inicial', 'complemento']);
  });

  it('un caso ya completo rechaza la subida con 409 y no deja nada', async () => {
    const { claimId, token } = await createClaim('completa');
    const res = await upload(token, newIdempotencyKey(), [pdf()]);

    expect(res.status).toBe(409);
    expect(await count('documents', claimId)).toBe(0);
    expect(await submissionKinds(claimId)).toEqual(['inicial']); // el envío se revirtió
  });

  it('un caso cerrado rechaza la subida con 409 y no deja nada', async () => {
    const { claimId, token } = await createClaim('pagada');
    const res = await upload(token, newIdempotencyKey(), [pdf()]);

    expect(res.status).toBe(409);
    expect(await count('documents', claimId)).toBe(0);
    expect(await submissionKinds(claimId)).toEqual(['inicial']);
  });

  it('sin token, mal formado o inexistente: el mismo 404 en los tres casos', async () => {
    const missing = await upload(undefined, newIdempotencyKey(), [pdf()]);
    const malformed = await upload('abc', newIdempotencyKey(), [pdf()]);
    const unknown = await upload('A'.repeat(43), newIdempotencyKey(), [pdf()]);

    for (const res of [missing, malformed, unknown]) expect(res.status).toBe(404);
    expect(malformed.body).toEqual(missing.body);
    expect(unknown.body).toEqual(missing.body);
  });

  it('los documentos llegan al caso del token, no a otro', async () => {
    const a = await createClaim();
    const b = await createClaim();

    expect((await upload(a.token, newIdempotencyKey(), [pdf()])).status).toBe(202);
    expect(await count('documents', a.claimId)).toBe(1);
    expect(await count('documents', b.claimId)).toBe(0);
  });

  it('sin archivos o con una llave inválida: 400, y no se registra ningún envío', async () => {
    const { claimId, token } = await createClaim();

    expect((await upload(token, newIdempotencyKey())).status).toBe(400);
    expect((await upload(token, 'abc', [pdf()])).status).toBe(400);
    expect((await upload(token, undefined, [pdf()])).status).toBe(400);
    expect(await submissionKinds(claimId)).toEqual(['inicial']);
  });

  it('un archivo falso (ejecutable renombrado a .pdf) da 415 y no deja nada a medias', async () => {
    const { claimId, token } = await createClaim();
    const fake = { name: 'cedula.pdf', buffer: Buffer.concat([Buffer.from('MZ'), randomBytes(64)]) };
    const res = await upload(token, newIdempotencyKey(), [fake]);

    expect(res.status).toBe(415);
    expect(await count('documents', claimId)).toBe(0);
    expect(await submissionKinds(claimId)).toEqual(['inicial']);
  });
});