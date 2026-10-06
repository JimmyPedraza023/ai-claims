// backend/test/integration/tracking.integration.spec.ts
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { sha256Hex } from '../../src/common/utils/hash';
import { generateTrackingToken } from '../../src/modules/claims/tracking-token';
import { DocumentsRepository } from '../../src/modules/documents/documents.repository';
import { DocumentsService } from '../../src/modules/documents/documents.service';
import type { FileStorage } from '../../src/modules/documents/file-storage';
import { TrackingController } from '../../src/modules/intake/tracking.controller';
import { TrackingService } from '../../src/modules/intake/tracking.service';
import type { CreateClaimInput } from '../../src/modules/claims/claims.service';
import { createTestContext, newClaimInput, newIdempotencyKey } from './helpers';

describe('GET /tracking (HTTP real, contra PostgreSQL real)', () => {
  const ctx = createTestContext();
  let app: INestApplication;

  beforeAll(async () => {
    // El almacenamiento no se usa al leer: basta un objeto vacío.
    const documents = new DocumentsService({} as FileStorage, new DocumentsRepository(), ctx.audit);
    const tracking = new TrackingService(ctx.db, ctx.claims, documents);

    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot({ throttlers: [{ name: 'short', ttl: 60_000, limit: 1000 }] })],
      controllers: [TrackingController],
      providers: [
        { provide: TrackingService, useValue: tracking },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await ctx.db.onModuleDestroy();
  });

  async function createClaim(overrides: Partial<CreateClaimInput> = {}) {
    const { token, hash } = generateTrackingToken();
    const input = newClaimInput({ trackingTokenHash: hash, ...overrides });
    const claim = await ctx.claims.createClaim(ctx.db, input);
    return { claim, token, input };
  }

  async function addDocument(
    claimId: string,
    submissionId: string,
    type: string,
    status: string,
    issue: string | null = null,
  ) {
    await ctx.db.query(
      `INSERT INTO documents
         (claim_id, submission_id, original_filename, mime_type, size_bytes, sha256,
          storage_path, document_type, status, issue)
       VALUES ($1, $2, 'archivo.pdf', 'application/pdf', 10, $3, $4, $5, $6, $7)`,
      [claimId, submissionId, sha256Hex(randomUUID()), `ab/${randomUUID()}.pdf`, type, status, issue],
    );
  }

  const get = (token?: string) => {
    const req = request(app.getHttpServer()).get('/tracking');
    return token === undefined ? req : req.set('x-tracking-token', token);
  };

  it('un caso recién radicado: 200 "revisando", sin lista, sin caché y sin datos personales', async () => {
    const { claim, token, input } = await createClaim();
    const res = await get(token);

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.referenceCode).toBe(claim.referenceCode);
    expect(res.body.stage).toBe('revisando');
    expect(res.body.checklist).toEqual([]);

    const text = JSON.stringify(res.body);
    expect(text).not.toContain(input.beneficiaryDocumentNumber);
    expect(text).not.toContain(input.beneficiaryEmail);
    expect(text).not.toContain(input.beneficiaryFullName);
  });

  it('cada token muestra solo su propio caso', async () => {
    const a = await createClaim();
    const b = await createClaim();

    expect((await get(a.token)).body.referenceCode).toBe(a.claim.referenceCode);
    expect((await get(b.token)).body.referenceCode).toBe(b.claim.referenceCode);
  });

  it('un caso clasificado muestra qué llegó, qué no sirve y qué falta', async () => {
    const { claim, token } = await createClaim();
    const { submission } = await ctx.claims.registerSubmission(ctx.db, {
      claimId: claim.id,
      idempotencyKey: newIdempotencyKey(),
      kind: 'inicial',
      channel: 'web',
    });
    await ctx.db.query(
      `UPDATE claims SET claim_type = 'muerte_natural', status = 'incompleta' WHERE id = $1`,
      [claim.id],
    );
    await addDocument(claim.id, submission.id, 'formato_reclamacion', 'valido');
    await addDocument(claim.id, submission.id, 'formulario_sarlaft', 'invalido', 'sin_firma');

    const res = await get(token);
    const state = (t: string) =>
      res.body.checklist.find((i: { documentType: string }) => i.documentType === t);

    expect(res.status).toBe(200);
    expect(res.body.stage).toBe('faltan_documentos');
    expect(res.body.documentsReceived).toBe(2);
    expect(state('formato_reclamacion').state).toBe('listo');
    expect(state('formulario_sarlaft').state).toBe('no_sirve');
    expect(state('formulario_sarlaft').message).toContain('firma');
    expect(state('registro_civil_defuncion').state).toBe('falta');

    // Nada interno hacia afuera: ni rutas, ni hashes, ni ids de documentos.
    expect(JSON.stringify(res.body)).not.toMatch(/storage|sha256|archivo\.pdf|ab\//);
  });

  it('sin token, mal formado o inexistente: el mismo 404 en los tres casos', async () => {
    const missing = await get();
    const malformed = await get('abc');
    const unknown = await get('A'.repeat(43)); // bien formado, pero no existe

    for (const res of [missing, malformed, unknown]) {
      expect(res.status).toBe(404);
    }
    expect(malformed.body).toEqual(missing.body);
    expect(unknown.body).toEqual(missing.body);
  });
});