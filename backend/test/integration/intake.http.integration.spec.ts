import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { hashTrackingToken } from '../../src/modules/claims/tracking-token';
import { DocumentsRepository } from '../../src/modules/documents/documents.repository';
import { MAX_FILE_BYTES, MAX_FILES_PER_SUBMISSION, DocumentsService } from '../../src/modules/documents/documents.service';
import { LocalFileStorage } from '../../src/modules/documents/local-file-storage';
import { IntakeController } from '../../src/modules/intake/intake.controller';
import { IntakeService } from '../../src/modules/intake/intake.service';
import { TRACKING_LINK_SENDER } from '../../src/modules/intake/tracking-link-sender';
import type { TrackingLink, TrackingLinkSender } from '../../src/modules/intake/tracking-link-sender';
import { JobsRepository } from '../../src/modules/jobs/jobs.repository';
import { createTestContext, newIdempotencyKey, randomDocument } from './helpers';
import { ThrottlerModule } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { TurnstileService } from '../../src/modules/intake/turnstile.service';

describe('POST /intake (HTTP real, contra PostgreSQL real)', () => {
  const ctx = createTestContext();
  let app: INestApplication;
  let storageDir: string;

  // Sender de prueba: guarda lo que se le entrega y puede fallar a propósito.
  const sent: TrackingLink[] = [];
  let failNextDelivery = false;
  const sender: TrackingLinkSender = {
    send: async (link) => {
      if (failNextDelivery) {
        failNextDelivery = false;
        throw new Error('proveedor de correo caído');
      }
      sent.push(link);
    },
  };

  beforeAll(async () => {
    storageDir = await mkdtemp(join(tmpdir(), 'aix-intake-http-'));
    const documents = new DocumentsService(
      new LocalFileStorage(storageDir),
      new DocumentsRepository(),
      ctx.audit,
    );
    const intake = new IntakeService(ctx.db, ctx.claims, documents, ctx.audit, new JobsRepository());

    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot({ throttlers: [{ name: 'short', ttl: 60_000, limit: 1000 }] })],
      controllers: [IntakeController],
      providers: [
        { provide: IntakeService, useValue: intake },
        { provide: TRACKING_LINK_SENDER, useValue: sender },
        // El mismo filtro global de la aplicación real.
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => (key === 'IP_HASH_SECRET' ? 'secreto-de-pruebas-0123456789' : undefined) },
        },
        { provide: TurnstileService, useValue: { enabled: false } },
      ],
    }).compile();

    app = moduleRef.createNestApplication({ logger: ['error'] });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await ctx.db.onModuleDestroy();
    await rm(storageDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    sent.length = 0;
    failNextDelivery = false;
  });

  // ---------- utilidades ----------

  const pdfFile = (name = 'documento.pdf') => ({
    name,
    buffer: Buffer.concat([Buffer.from('%PDF-1.4\n'), randomBytes(64), Buffer.from('\n%%EOF')]),
  });

  const fields = (overrides: Record<string, string> = {}): Record<string, string> => ({
    idempotencyKey: newIdempotencyKey(),
    narrative: 'Mi padre falleció el mes pasado y quiero reclamar el seguro.',
    beneficiaryDocumentType: 'CC',
    beneficiaryDocumentNumber: randomDocument(),
    beneficiaryFullName: 'Ana María Pérez',
    beneficiaryEmail: 'ana.perez@example.com',
    beneficiaryPhone: '3001234567',
    insuredDocumentNumber: randomDocument(),
    insuredFullName: 'Carlos Pérez',
    consentAccepted: 'true',
    ...overrides,
  });

  function post(form: Record<string, string>, files: { name: string; buffer: Buffer }[] = []) {
    let req = request(app.getHttpServer()).post('/intake');
    for (const [key, value] of Object.entries(form)) req = req.field(key, value);
    for (const f of files) {
      req = req.attach('files', f.buffer, { filename: f.name, contentType: 'application/pdf' });
    }
    return req;
  }

  const countClaims = async (beneficiaryDocument: string): Promise<number> => {
    const { rows } = await ctx.db.query<{ n: string }>(
      'SELECT count(*) AS n FROM claims WHERE beneficiary_document_number = $1',
      [beneficiaryDocument],
    );
    return Number(rows[0].n);
  };

  const claimIdOf = async (beneficiaryDocument: string): Promise<string> => {
    const { rows } = await ctx.db.query<{ id: string }>(
      'SELECT id FROM claims WHERE beneficiary_document_number = $1',
      [beneficiaryDocument],
    );
    return rows[0].id;
  };

  // ---------- pruebas ----------

  it('caso nuevo: 202 solo con el mensaje, y el token se entrega una vez (en la base solo su hash)', async () => {
    const f = fields();
    const res = await post(f, [pdfFile()]);

    expect(res.status).toBe(202);
    // Ni código de referencia ni token: nada que distinga un caso nuevo de uno existente.
    expect(res.body).toEqual({ message: expect.any(String) });

    expect(await countClaims(f.beneficiaryDocumentNumber)).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].email).toBe('ana.perez@example.com');

    const { rows } = await ctx.db.query(
      'SELECT tracking_token_hash FROM claims WHERE beneficiary_document_number = $1',
      [f.beneficiaryDocumentNumber],
    );
    expect(rows[0].tracking_token_hash).toBe(hashTrackingToken(sent[0].token));
  });

  it('caso nuevo, envío repetido y envío anexado dan exactamente la misma respuesta', async () => {
    const f = fields();
    const first = await post(f, [pdfFile()]);
    const repeated = await post(f, [pdfFile()]); // misma llave de idempotencia
    const appended = await post(
      fields({
        beneficiaryDocumentNumber: f.beneficiaryDocumentNumber,
        insuredDocumentNumber: f.insuredDocumentNumber,
      }), // llave nueva, mismas personas
      [pdfFile()],
    );

    expect(first.status).toBe(202);
    expect(repeated.status).toBe(first.status);
    expect(appended.status).toBe(first.status);
    expect(repeated.body).toEqual(first.body);
    expect(appended.body).toEqual(first.body);

    expect(await countClaims(f.beneficiaryDocumentNumber)).toBe(1);
    expect(sent).toHaveLength(1); // el enlace solo se entrega al crear el caso
  });

  it('sin aceptar el consentimiento: 400 con campo y motivo, sin repetir los datos de la persona', async () => {
    const f = fields({ consentAccepted: 'false' });
    const res = await post(f, [pdfFile()]);

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'consentAccepted' })]),
    );
    expect(JSON.stringify(res.body)).not.toContain(f.beneficiaryDocumentNumber);
    expect(await countClaims(f.beneficiaryDocumentNumber)).toBe(0);
  });

  it('un campo que no existe en el formulario (status) se rechaza', async () => {
    const f = fields({ status: 'completa' });
    const res = await post(f, [pdfFile()]);

    expect(res.status).toBe(400);
    expect(await countClaims(f.beneficiaryDocumentNumber)).toBe(0);
  });

  it('un archivo falso (ejecutable renombrado a .pdf) da 415 y no deja nada guardado', async () => {
    const f = fields();
    const fake = { name: 'cedula.pdf', buffer: Buffer.concat([Buffer.from('MZ'), randomBytes(64)]) };
    const res = await post(f, [fake]);

    expect(res.status).toBe(415);
    expect(await countClaims(f.beneficiaryDocumentNumber)).toBe(0);
  });

  it('un archivo de más de 10 MB da 413', async () => {
    const f = fields();
    const huge = {
      name: 'enorme.pdf',
      buffer: Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(MAX_FILE_BYTES)]),
    };
    const res = await post(f, [huge]);

    expect(res.status).toBe(413);
    expect(await countClaims(f.beneficiaryDocumentNumber)).toBe(0);
  });

  it('más archivos de los permitidos da 400', async () => {
    const f = fields();
    const files = Array.from({ length: MAX_FILES_PER_SUBMISSION + 1 }, (_, i) => pdfFile(`doc-${i}.pdf`));
    const res = await post(f, files);

    expect(res.status).toBe(400);
    expect(await countClaims(f.beneficiaryDocumentNumber)).toBe(0);
  });

  it('una llave de idempotencia que ya es de otra reclamación da 409 y no crea el caso nuevo', async () => {
    const key = newIdempotencyKey();
    await post(fields({ idempotencyKey: key }), [pdfFile()]);

    const other = fields({ idempotencyKey: key });
    const res = await post(other, [pdfFile()]);

    expect(res.status).toBe(409);
    expect(await countClaims(other.beneficiaryDocumentNumber)).toBe(0);
  });

  it('sin archivos también se acepta: queda el caso, ningún documento y la clasificación encolada', async () => {
    const f = fields();
    const res = await post(f);

    expect(res.status).toBe(202);
    const claimId = await claimIdOf(f.beneficiaryDocumentNumber);

    const docs = await ctx.db.query('SELECT 1 FROM documents WHERE claim_id = $1', [claimId]);
    expect(docs.rows).toHaveLength(0);
    const jobs = await ctx.db.query<{ kind: string }>('SELECT kind FROM jobs WHERE claim_id = $1', [claimId]);
    expect(jobs.rows.map((j) => j.kind)).toEqual(['clasificar_reclamacion']);
  });

  it('si falla la entrega del enlace, la radicación igual queda guardada y se responde 202', async () => {
    failNextDelivery = true;
    const f = fields();
    const res = await post(f, [pdfFile()]);

    expect(res.status).toBe(202);
    expect(await countClaims(f.beneficiaryDocumentNumber)).toBe(1);
  });

  it('guarda un hash de la IP del cliente en el envío, nunca la IP en claro', async () => {
    const f = fields();
    await post(f, [pdfFile()]);
    const claimId = await claimIdOf(f.beneficiaryDocumentNumber);

    const { rows } = await ctx.db.query(
      'SELECT client_ip_hash FROM submissions WHERE claim_id = $1',
      [claimId],
    );
    expect(rows[0].client_ip_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});