import { createTestContext, seedDocument } from './helpers';
import { AnalyzeDocumentHandler } from '../../src/modules/classification/analyze-document.handler';
import { AnalysisRecorder } from '../../src/modules/classification/analysis-recorder';
import { AiRunsRepository } from '../../src/modules/classification/ai-runs.repository';
import { ClassificationsRepository } from '../../src/modules/classification/classifications.repository';
import { FakeLlmProvider } from '../../src/modules/classification/testing/fake-llm-provider';
import { LlmError } from '../../src/modules/classification/llm-provider';
import type { DocumentAnalysis, DocumentType } from '../../src/modules/classification/classification.schemas';
import type { DocumentPreparer, PreparedDocument } from '../../src/modules/classification/preparation/document-preparer';
import { UnreadableDocumentError } from '../../src/modules/classification/preparation/unreadable-document.error';
import { ClaimsRepository } from '../../src/modules/claims/claims.repository';
import { DocumentsRepository } from '../../src/modules/documents/documents.repository';
import type { FileStorage } from '../../src/modules/documents/file-storage';
import type { ClaimedJob } from '../../src/modules/jobs/job-queue';
import { JobsRepository } from '../../src/modules/jobs/jobs.repository';

const ctx = createTestContext();
afterAll(async () => {
  await ctx.db.onModuleDestroy();
});

const documents = new DocumentsRepository();
const storage: FileStorage = { save: async () => {}, read: async () => Buffer.from('contenido') };
const f = <T>(value: T, confidence = 0.95) => ({ value, confidence });
const analysis = (over: Partial<DocumentAnalysis> = {}): DocumentAnalysis => ({
  documentType: f<DocumentType>('formulario_sarlaft'), legible: f(true), signed: f<boolean | null>(true),
  matchesInsured: f<boolean | null>(null), reason: 'Firma visible', ...over,
});
const prepared = (over: Partial<PreparedDocument> = {}): PreparedDocument => ({
  images: [{ mimeType: 'image/jpeg', base64: 'AAAA' }], totalPages: 1, usedPages: 1, truncated: false, imageBytes: [4], ...over,
});

function build(opts: { llm?: FakeLlmProvider; preparer?: DocumentPreparer } = {}) {
  const llm = opts.llm ?? new FakeLlmProvider({ analyzeDocument: () => analysis() });
  const preparer = opts.preparer ?? { prepare: async () => prepared() };
  const recorder = new AnalysisRecorder(new AiRunsRepository(), new ClassificationsRepository(), documents);
  const handler = new AnalyzeDocumentHandler(
    ctx.db, new ClaimsRepository(), documents, storage, preparer, llm, recorder, ctx.audit, new JobsRepository(),
  );
  return { handler, llm };
}

const job = (claimId: string, documentId: string, over: Partial<ClaimedJob> = {}): ClaimedJob => ({
  id: 1, kind: 'analizar_documento', claimId, documentId, attempts: 1, maxAttempts: 5, ...over,
});
const signal = () => new AbortController().signal;

async function doc(id: string) {
  const { rows } = await ctx.db.query('SELECT document_type, status, issue FROM documents WHERE id = $1', [id]);
  return rows[0];
}
async function events(claimId: string) {
  const { rows } = await ctx.db.query('SELECT event_type, actor, payload FROM claim_events WHERE claim_id = $1', [claimId]);
  return rows;
}
async function evaluationJobs(claimId: string) {
  const { rows } = await ctx.db.query(`SELECT dedupe_key FROM jobs WHERE claim_id = $1 AND kind = 'evaluar_completitud'`, [claimId]);
  return rows;
}
async function runs(documentId: string) {
  const { rows } = await ctx.db.query('SELECT status FROM ai_runs WHERE document_id = $1', [documentId]);
  return rows.map((r) => r.status);
}

describe('AnalyzeDocumentHandler', () => {
  it('documento bueno: queda válido, con evento y con el siguiente trabajo encolado', async () => {
    const { claimId, documentId } = await seedDocument(ctx.db);
    const { handler } = build();
    await handler.execute(job(claimId, documentId), signal());

    expect(await doc(documentId)).toMatchObject({ document_type: 'formulario_sarlaft', status: 'valido', issue: null });
    expect(await runs(documentId)).toEqual(['ok']);
    const analyzed = (await events(claimId)).find((e) => e.event_type === 'documento_analizado');
    expect(analyzed).toMatchObject({ actor: 'modelo' });
    expect(analyzed!.payload).toMatchObject({ documentId, status: 'valido' });
    expect(await evaluationJobs(claimId)).toEqual([{ dedupe_key: `evaluar:${claimId}:doc:${documentId}` }]);
  });

  it('un reintento sobre un documento ya analizado no llama de nuevo al modelo', async () => {
    const { claimId, documentId } = await seedDocument(ctx.db);
    const { handler, llm } = build();
    await handler.execute(job(claimId, documentId), signal());
    await handler.execute(job(claimId, documentId, { attempts: 2 }), signal());
    expect(llm.calls.analyzeDocument).toBe(1);
    expect(await evaluationJobs(claimId)).toHaveLength(1);
  });

  it('archivo dañado: no se llama al modelo, queda para una persona y se registra', async () => {
    const { claimId, documentId } = await seedDocument(ctx.db);
    const llm = new FakeLlmProvider();
    const preparer: DocumentPreparer = {
      prepare: async () => { throw new UnreadableDocumentError('corrupto', 'El PDF no se pudo abrir o dibujar'); },
    };
    await build({ llm, preparer }).handler.execute(job(claimId, documentId), signal());

    expect(llm.calls.analyzeDocument).toBe(0);
    expect(await doc(documentId)).toMatchObject({ status: 'requiere_revision', issue: 'archivo_danado' });
    expect(await runs(documentId)).toEqual([]);
    expect((await events(claimId)).some((e) => e.event_type === 'documento_no_procesado')).toBe(true);
    expect(await evaluationJobs(claimId)).toHaveLength(1);
  });

  it('el modelo falla antes del último intento: se relanza el error y el documento sigue pendiente', async () => {
    const { claimId, documentId } = await seedDocument(ctx.db);
    const llm = new FakeLlmProvider({ error: new LlmError('timeout', 'sin respuesta') });
    await expect(build({ llm }).handler.execute(job(claimId, documentId, { attempts: 2 }), signal())).rejects.toThrow('sin respuesta');

    expect(await runs(documentId)).toEqual(['timeout']);
    expect((await doc(documentId)).status).toBe('pendiente_analisis');
    expect(await evaluationJobs(claimId)).toHaveLength(0);
  });

  it('el modelo falla en el último intento: el documento pasa a una persona', async () => {
    const { claimId, documentId } = await seedDocument(ctx.db);
    const llm = new FakeLlmProvider({ error: new LlmError('unavailable', 'caído') });
    await expect(build({ llm }).handler.execute(job(claimId, documentId, { attempts: 5 }), signal())).rejects.toThrow();

    expect(await doc(documentId)).toMatchObject({ status: 'requiere_revision', issue: 'otro' });
    expect(await evaluationJobs(claimId)).toHaveLength(1);
  });

  it('un error sin remedio no espera al último intento', async () => {
    const { claimId, documentId } = await seedDocument(ctx.db);
    const llm = new FakeLlmProvider({ error: new LlmError('bad_request', 'clave inválida') });
    await expect(build({ llm }).handler.execute(job(claimId, documentId, { attempts: 1 }), signal())).rejects.toThrow();
    expect((await doc(documentId)).status).toBe('requiere_revision');
  });

  it('un documento con páginas omitidas nunca queda válido por sí solo', async () => {
    const { claimId, documentId } = await seedDocument(ctx.db);
    const preparer: DocumentPreparer = { prepare: async () => prepared({ totalPages: 6, usedPages: 4, truncated: true }) };
    await build({ preparer }).handler.execute(job(claimId, documentId), signal());
    expect((await doc(documentId)).status).toBe('requiere_revision');
  });
});