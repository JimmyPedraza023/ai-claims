import { randomUUID } from 'node:crypto';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256Hex } from '../../src/common/utils/hash';
import { DocumentsRepository } from '../../src/modules/documents/documents.repository';
import { InvalidFileError } from '../../src/modules/documents/documents.errors';
import { DocumentsService } from '../../src/modules/documents/documents.service';
import { buildStoragePath } from '../../src/modules/documents/file-storage';
import { LocalFileStorage } from '../../src/modules/documents/local-file-storage';
import { createTestContext, newClaimInput, newIdempotencyKey } from './helpers';

describe('Documentos (integración)', () => {
  const ctx = createTestContext();
  let storageDir: string;
  let documents: DocumentsService;

  beforeAll(async () => {
    storageDir = await mkdtemp(join(tmpdir(), 'ai-claims-docs-'));
    documents = new DocumentsService(new LocalFileStorage(storageDir), new DocumentsRepository(), ctx.audit);
  });

  afterAll(async () => {
    await rm(storageDir, { recursive: true, force: true });
    await ctx.db.onModuleDestroy?.();
  });

  /**
   * AJUSTA esta función a la API real de ClaimsService: copia la llamada que ya
   * usas en claims.integration.spec.ts para crear un caso nuevo y devuelve los
   * ids del caso y del envío.
   */
    async function newClaimWithSubmission(): Promise<{ claimId: string; submissionId: string }> {
        return ctx.db.withTransaction(async (c) => {
        const claim = await ctx.claims.createClaim(c, newClaimInput());
        const { submission } = await ctx.claims.registerSubmission(c, {
            claimId: claim.id,
            idempotencyKey: newIdempotencyKey(),
            kind: 'inicial',
            channel: 'web',
        });
        return { claimId: claim.id, submissionId: submission.id };
        });
    }

  const pdf = (marca = randomUUID()) => Buffer.from(`%PDF-1.4\n% ${marca}\n`);
  const file = (buffer: Buffer, originalname = 'documento.pdf') => ({ originalname, buffer });

  const countDocuments = async (claimId: string) =>
    Number(
      (await ctx.db.query<{ n: string }>('SELECT count(*) AS n FROM documents WHERE claim_id = $1', [claimId]))
        .rows[0].n,
    );

  const eventTypes = async (claimId: string) =>
    (
      await ctx.db.query<{ event_type: string }>(
        'SELECT event_type FROM claim_events WHERE claim_id = $1 ORDER BY id',
        [claimId],
      )
    ).rows.map((r) => r.event_type);

  const exists = (path: string) => access(join(storageDir, path)).then(() => true, () => false);

  it('guarda un documento válido, lo deja pendiente de análisis y registra el evento', async () => {
    const { claimId, submissionId } = await newClaimWithSubmission();
    const buffer = pdf();

    const result = await documents.receive(ctx.db, {
      claimId, submissionId, files: [file(buffer)], actor: 'beneficiario',
    });

    expect(result.stored).toHaveLength(1);
    expect(result.duplicates).toHaveLength(0);

    const { rows } = await ctx.db.query(
      'SELECT status, mime_type, sha256, storage_path FROM documents WHERE claim_id = $1',
      [claimId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('pendiente_analisis');
    expect(rows[0].mime_type).toBe('application/pdf');
    expect(rows[0].sha256).toBe(sha256Hex(buffer));
    expect(await exists(rows[0].storage_path)).toBe(true);
    expect(await eventTypes(claimId)).toContain('documento_recibido');
  });

  it('el mismo archivo enviado dos veces deja un solo documento y un evento de duplicado', async () => {
    const { claimId, submissionId } = await newClaimWithSubmission();
    const buffer = pdf();
    const input = { claimId, submissionId, actor: 'beneficiario' as const };

    await documents.receive(ctx.db, { ...input, files: [file(buffer)] });
    const second = await documents.receive(ctx.db, { ...input, files: [file(buffer, 'otro-nombre.pdf')] });

    expect(second.stored).toHaveLength(0);
    expect(second.duplicates).toHaveLength(1);
    expect(await countDocuments(claimId)).toBe(1);

    const events = await eventTypes(claimId);
    expect(events.filter((e) => e === 'documento_recibido')).toHaveLength(1);
    expect(events.filter((e) => e === 'documento_duplicado_ignorado')).toHaveLength(1);
  });

  it('el mismo archivo repetido dentro de un solo envío crea un solo documento', async () => {
    const { claimId, submissionId } = await newClaimWithSubmission();
    const buffer = pdf();

    const result = await documents.receive(ctx.db, {
      claimId, submissionId, files: [file(buffer), file(buffer, 'copia.pdf')], actor: 'beneficiario',
    });

    expect(result.stored).toHaveLength(1);
    expect(result.duplicates).toHaveLength(1);
    expect(await countDocuments(claimId)).toBe(1);
  });

  it('envíos simultáneos del mismo archivo no crean documentos repetidos', async () => {
    const { claimId, submissionId } = await newClaimWithSubmission();
    const buffer = pdf();

    await Promise.all(
      Array.from({ length: 5 }, () =>
        documents.receive(ctx.db, { claimId, submissionId, files: [file(buffer)], actor: 'beneficiario' }),
      ),
    );

    expect(await countDocuments(claimId)).toBe(1);
  });

  it('rechaza un ejecutable renombrado a .pdf y no guarda nada', async () => {
    const { claimId, submissionId } = await newClaimWithSubmission();
    const exe = Buffer.from('MZ\x90\x00\x03\x00\x00\x00', 'binary');

    await expect(
      documents.receive(ctx.db, { claimId, submissionId, files: [file(exe, 'cedula.pdf')], actor: 'beneficiario' }),
    ).rejects.toMatchObject({ name: 'InvalidFileError', code: 'TYPE_NOT_ALLOWED' });

    expect(await countDocuments(claimId)).toBe(0);
  });

  it('un envío con un archivo válido y uno inválido no guarda ninguno', async () => {
    const { claimId, submissionId } = await newClaimWithSubmission();
    const valido = pdf();
    const invalido = Buffer.from('esto es texto plano');

    await expect(
      documents.receive(ctx.db, {
        claimId, submissionId, files: [file(valido), file(invalido, 'foto.jpg')], actor: 'beneficiario',
      }),
    ).rejects.toBeInstanceOf(InvalidFileError);

    expect(await countDocuments(claimId)).toBe(0);
    expect(await exists(buildStoragePath(sha256Hex(valido), 'pdf'))).toBe(false);
  });

  it('rechaza archivos vacíos', async () => {
    const { claimId, submissionId } = await newClaimWithSubmission();
    await expect(
      documents.receive(ctx.db, { claimId, submissionId, files: [file(Buffer.alloc(0))], actor: 'beneficiario' }),
    ).rejects.toMatchObject({ code: 'EMPTY' });
  });

  it('un nombre malicioso no afecta la ruta de almacenamiento (solo depende del hash)', async () => {
    const { claimId, submissionId } = await newClaimWithSubmission();
    const buffer = pdf();

    await documents.receive(ctx.db, {
      claimId, submissionId, files: [file(buffer, '../../etc/passwd.pdf')], actor: 'beneficiario',
    });

    const { rows } = await ctx.db.query(
      'SELECT original_filename, storage_path FROM documents WHERE claim_id = $1',
      [claimId],
    );
    expect(rows[0].storage_path).toBe(buildStoragePath(sha256Hex(buffer), 'pdf'));
    expect(rows[0].original_filename).toBe('passwd.pdf');
  });

  it('un reenvío completo (misma llave, mismos archivos) no duplica documentos', async () => {
    const claim = await ctx.db.withTransaction((c) => ctx.claims.createClaim(c, newClaimInput()));
    const key = newIdempotencyKey();
    const buffer = pdf();

    const enviar = () =>
    ctx.db.withTransaction(async (c) => {
        const { submission } = await ctx.claims.registerSubmission(c, {
        claimId: claim.id, idempotencyKey: key, kind: 'inicial', channel: 'web',
        });
        return documents.receive(c, {
        claimId: claim.id, submissionId: submission.id, files: [file(buffer)], actor: 'beneficiario',
        });
    });

    const primero = await enviar();
    const repetido = await enviar();

    expect(primero.stored).toHaveLength(1);
    expect(repetido.stored).toHaveLength(0);
    expect(repetido.duplicates).toHaveLength(1);
    expect(await countDocuments(claim.id)).toBe(1);

    const tipos = await eventTypes(claim.id);
    expect(tipos).toEqual([
        'reclamacion_recibida',
        'documento_recibido',
        'envio_duplicado_ignorado',
        'documento_duplicado_ignorado',
        ]);
    });
  
});