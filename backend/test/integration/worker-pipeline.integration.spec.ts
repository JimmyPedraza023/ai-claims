import { randomBytes } from 'node:crypto';
import { createTestContext, seedDocument } from './helpers';
import type { DocumentType } from '../../src/common/domain/enums';
import { ClaimsRepository } from '../../src/modules/claims/claims.repository';
import { AiRunsRepository } from '../../src/modules/classification/ai-runs.repository';
import { AnalysisRecorder } from '../../src/modules/classification/analysis-recorder';
import { AnalyzeDocumentHandler } from '../../src/modules/classification/analyze-document.handler';
import { ClassificationsRepository } from '../../src/modules/classification/classifications.repository';
import { ClassifyClaimHandler } from '../../src/modules/classification/classify-claim.handler';
import { LlmError } from '../../src/modules/classification/llm-provider';
import type { DocumentPreparer } from '../../src/modules/classification/preparation/document-preparer';
import { FakeLlmProvider } from '../../src/modules/classification/testing/fake-llm-provider';
import { CompletenessEvaluationsRepository } from '../../src/modules/completeness/completeness-evaluations.repository';
import { REQUIRED_DOCUMENTS } from '../../src/modules/completeness/completeness.rules';
import { EvaluateCompletenessHandler } from '../../src/modules/completeness/evaluate-completeness.handler';
import { DocumentsRepository } from '../../src/modules/documents/documents.repository';
import type { FileStorage } from '../../src/modules/documents/file-storage';
import { JobRunner, type JobHandlers, type RunnerLogger } from '../../src/modules/jobs/job-runner';
import { JobsRepository } from '../../src/modules/jobs/jobs.repository';
import { PostgresJobQueue } from '../../src/modules/jobs/postgres-job-queue';
import { computeDeadline } from '../../src/modules/legal-clock/legal-clock';

/**
 * Extremo a extremo: lo que sigue a la radicación, de la cola al reloj.
 *
 * Es real: la base de datos, la cola con lease y reintentos, el runner, los tres handlers, la política,
 * la función de completitud y el reloj legal. Es de prueba: el modelo (FakeLlmProvider), el almacenamiento
 * (en memoria) y la preparación de imágenes (que solo pasa el "archivo" al modelo falso).
 * El "archivo" de cada documento es un texto: "<tipo>" o "<tipo>|sin_firma".
 */
jest.setTimeout(30_000);

const ctx = createTestContext();
afterAll(async () => {
  await ctx.db.onModuleDestroy();
});

const documents = new DocumentsRepository();
const claims = new ClaimsRepository();
const jobsRepo = new JobsRepository();
const silent: RunnerLogger = { info() {}, warn() {}, error() {} };

class MemoryStorage implements FileStorage {
  readonly files = new Map<string, Buffer>();
  async save(path: string, data: Buffer): Promise<void> {
    this.files.set(path, data);
  }
  async read(path: string): Promise<Buffer> {
    const file = this.files.get(path);
    if (!file) throw new Error('archivo inexistente');
    return file;
  }
}
const storage = new MemoryStorage();

const preparer: DocumentPreparer = {
  prepare: async ({ data }) => ({
    images: [{ mimeType: 'image/jpeg', base64: data.toString('base64') }],
    totalPages: 1,
    usedPages: 1,
    truncated: false,
    imageBytes: [data.length],
  }),
};

function makeLlm(): FakeLlmProvider {
  return new FakeLlmProvider({
    analyzeDocument: (input) => {
      const [type, flag] = Buffer.from(input.images[0].base64, 'base64').toString().split('|');
      return {
        documentType: { value: type as DocumentType, confidence: 0.95 },
        legible: { value: true, confidence: 0.95 },
        signed: { value: type === 'formulario_sarlaft' ? flag !== 'sin_firma' : null, confidence: 0.95 },
        matchesInsured: { value: type === 'documento_identidad_asegurado' ? true : null, confidence: 0.95 },
        reason: 'simulado',
      };
    },
    classifyClaim: (input) => {
      const narrative = input.narrative.toLowerCase();
      const hasReport = input.documents.some((d) => d.documentType === 'informe_autoridad');
      const value =
        hasReport || narrative.includes('accidente')
          ? 'muerte_accidental'
          : narrative.includes('infarto')
            ? 'muerte_natural'
            : 'indeterminado';
      return { claimType: { value, confidence: value === 'indeterminado' ? 0.4 : 0.95 }, evidence: 'simulado' };
    },
  });
}

const modelDown = () => new FakeLlmProvider({ error: new LlmError('unavailable', 'modelo apagado') });

function buildRunner(llm: FakeLlmProvider, claimId: string): JobRunner {
  const recorder = new AnalysisRecorder(new AiRunsRepository(), new ClassificationsRepository(), documents);
  const analyze = new AnalyzeDocumentHandler(ctx.db, claims, documents, storage, preparer, llm, recorder, ctx.audit, jobsRepo);
  const classify = new ClassifyClaimHandler(ctx.db, claims, documents, llm, recorder, ctx.audit, jobsRepo);
  const evaluate = new EvaluateCompletenessHandler(
    ctx.db, claims, documents, new CompletenessEvaluationsRepository(), ctx.audit, jobsRepo,
  );
  const handlers: JobHandlers = {
    analizar_documento: (job, signal) => analyze.execute(job, signal),
    clasificar_reclamacion: (job, signal) => classify.execute(job, signal),
    evaluar_completitud: (job) => evaluate.execute(job),
  };
  // La misma cola de producción, limitada a un caso para no tocar trabajos de otras pruebas.
  const queue = new PostgresJobQueue(ctx.db, jobsRepo, 30, undefined, claimId);
  return new JobRunner(
    queue, handlers,
    { workerId: 'e2e', concurrency: 1, pollIntervalMs: 10, jobTimeoutMs: 5000, leaseSeconds: 30 },
    silent,
  );
}

/** Procesa trabajos hasta vaciar la cola del caso. Con fastForward se salta la espera de los reintentos. */
async function run(claimId: string, llm: FakeLlmProvider = makeLlm(), fastForward = false): Promise<void> {
  const runner = buildRunner(llm, claimId);
  for (let pass = 0; pass < 12; pass++) {
    while (await runner.runOnce()) {
      /* sigue mientras haya trabajo disponible */
    }
    const { rows } = await ctx.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM jobs WHERE claim_id = $1 AND status IN ('pendiente', 'en_proceso')`, [claimId]);
    if (rows[0].n === 0) return;
    if (!fastForward) throw new Error('Quedaron trabajos esperando un reintento');
    await ctx.db.query(`UPDATE jobs SET run_at = now() WHERE claim_id = $1 AND status = 'pendiente'`, [claimId]);
  }
  throw new Error('La cola no se vació');
}

// ------------------------------------------------------------------ preparación de casos
async function registerDocument(claimId: string, submissionId: string, spec: string): Promise<string> {
  const sha = randomBytes(32).toString('hex');
  const path = `${sha.slice(0, 2)}/${sha}.pdf`;
  const { rows } = await ctx.db.query<{ id: string }>(
    `INSERT INTO documents (claim_id, submission_id, original_filename, mime_type, size_bytes, sha256, storage_path)
     VALUES ($1, $2, 'documento.pdf', 'application/pdf', 10, $3, $4) RETURNING id`,
    [claimId, submissionId, sha, path]);
  storage.files.set(path, Buffer.from(spec));
  return rows[0].id;
}

const enqueueAnalysis = (claimId: string, documentId: string) =>
  jobsRepo.enqueue(ctx.db, { kind: 'analizar_documento', claimId, documentId, dedupeKey: `e2e:analizar:${documentId}` });

/** Un caso recién radicado: sus documentos pendientes y los mismos trabajos que encola la radicación. */
async function seedClaim(narrative: string, specs: string[]) {
  const { claimId, documentId } = await seedDocument(ctx.db);
  await ctx.db.query(`UPDATE jobs SET status = 'completado' WHERE claim_id = $1`, [claimId]);
  await ctx.db.query('UPDATE claims SET narrative = $2 WHERE id = $1', [claimId, narrative]);
  const first = (
    await ctx.db.query<{ submission_id: string; storage_path: string }>(
      'SELECT submission_id, storage_path FROM documents WHERE id = $1', [documentId])
  ).rows[0];
  storage.files.set(first.storage_path, Buffer.from(specs[0]));

  const documentIds = [documentId];
  for (const spec of specs.slice(1)) documentIds.push(await registerDocument(claimId, first.submission_id, spec));

  await jobsRepo.enqueue(ctx.db, { kind: 'clasificar_reclamacion', claimId, dedupeKey: `e2e:clasificar:${claimId}` });
  for (const id of documentIds) await enqueueAnalysis(claimId, id);
  return { claimId, submissionId: first.submission_id };
}

/** El beneficiario sube otro documento desde el seguimiento. */
async function uploadLater(claimId: string, submissionId: string, spec: string): Promise<void> {
  await enqueueAnalysis(claimId, await registerDocument(claimId, submissionId, spec));
}

const specs = (types: readonly DocumentType[], overrides: Partial<Record<DocumentType, string>> = {}) =>
  types.map((t) => overrides[t] ?? t);

// ------------------------------------------------------------------ lectura del resultado
const NATURAL = REQUIRED_DOCUMENTS.muerte_natural;
const ACCIDENTAL = REQUIRED_DOCUMENTS.muerte_accidental;

async function claimOf(id: string) {
  return (await ctx.db.query(
    'SELECT status, claim_type, completed_at, deadline_date FROM claims WHERE id = $1', [id])).rows[0];
}
async function evaluations(id: string) {
  return (await ctx.db.query(
    'SELECT is_complete, result, created_at FROM completeness_evaluations WHERE claim_id = $1 ORDER BY created_at', [id])).rows;
}
const eventTypes = async (id: string) => (await ctx.audit.timeline(id)).map((e) => e.eventType);
const count = (types: string[], type: string) => types.filter((t) => t === type).length;

async function assertNoPersonalData(claimId: string): Promise<void> {
  const claim = (await ctx.db.query(
    `SELECT beneficiary_full_name, insured_full_name, beneficiary_document_number, insured_document_number
       FROM claims WHERE id = $1`, [claimId])).rows[0];
  const events = await ctx.db.query('SELECT payload FROM claim_events WHERE claim_id = $1', [claimId]);
  const refs = await ctx.db.query('SELECT input_ref FROM ai_runs WHERE claim_id = $1', [claimId]);
  const blob = JSON.stringify([events.rows, refs.rows]);
  for (const value of Object.values(claim)) expect(blob).not.toContain(String(value));
}

describe('el flujo después de radicar, de punta a punta', () => {
  it('un expediente completo se procesa solo: queda completo, con su reloj, su historia y sin datos personales en la bitácora', async () => {
    const { claimId } = await seedClaim('Mi padre falleció de un infarto en su casa.', specs(NATURAL));
    await run(claimId);

    const claim = await claimOf(claimId);
    expect(claim).toMatchObject({ status: 'completa', claim_type: 'muerte_natural' });
    expect(claim.completed_at).toBeInstanceOf(Date);
    expect(claim.deadline_date).toBe(computeDeadline(claim.completed_at));

    // Pregunta 4: la historia completa se puede reconstruir, en orden.
    const types = await eventTypes(claimId);
    expect(count(types, 'documento_analizado')).toBe(NATURAL.length);
    expect(count(types, 'tipo_reclamacion_asignado')).toBe(1);
    expect(count(types, 'expediente_completo')).toBe(1);
    expect(types.lastIndexOf('documento_analizado')).toBeLessThan(types.indexOf('expediente_completo'));

    const runs = await ctx.db.query(
      'SELECT task, status, count(*)::int AS n FROM ai_runs WHERE claim_id = $1 GROUP BY task, status', [claimId]);
    expect(runs.rows).toEqual(expect.arrayContaining([
      { task: 'analizar_documento', status: 'ok', n: NATURAL.length },
      { task: 'clasificar_reclamacion', status: 'ok', n: 1 },
    ]));

    const leftover = await ctx.db.query(
      `SELECT 1 FROM jobs WHERE claim_id = $1 AND status IN ('pendiente', 'en_proceso', 'fallido')`, [claimId]);
    expect(leftover.rows).toHaveLength(0);
    await assertNoPersonalData(claimId);

    // Una evaluación repetida (un duplicado) no reinicia el reloj ni crea otra evaluación.
    await jobsRepo.enqueue(ctx.db, { kind: 'evaluar_completitud', claimId, dedupeKey: `e2e:evaluar-duplicado:${claimId}` });
    await run(claimId);
    const again = await claimOf(claimId);
    expect(again.completed_at.getTime()).toBe(claim.completed_at.getTime());
    expect(again.deadline_date).toBe(claim.deadline_date);
    expect(await evaluations(claimId)).toHaveLength(1);
  });

  it('llega incompleto y se completa después: el reloj corre desde que se completa, no desde que se radicó', async () => {
    const missing = NATURAL[NATURAL.length - 1];
    const { claimId, submissionId } = await seedClaim('Mi padre falleció de un infarto.', specs(NATURAL.slice(0, -1)));
    await run(claimId);

    expect(await claimOf(claimId)).toMatchObject({ status: 'incompleta', completed_at: null, deadline_date: null });
    const [first] = await evaluations(claimId);
    expect(first.is_complete).toBe(false);
    expect(first.result.missing).toEqual([missing]);

    await uploadLater(claimId, submissionId, missing);
    await run(claimId);

    const claim = await claimOf(claimId);
    expect(claim.status).toBe('completa');
    expect(claim.completed_at.getTime()).toBeGreaterThan(first.created_at.getTime());
    expect(claim.deadline_date).toBe(computeDeadline(claim.completed_at));
    expect(await evaluations(claimId)).toHaveLength(2);
    expect(count(await eventTypes(claimId), 'expediente_completo')).toBe(1);
  });

  it('un documento que llega pero no sirve es distinto de uno que falta, y se corrige subiendo otro', async () => {
    const { claimId, submissionId } = await seedClaim(
      'Mi padre falleció de un infarto.', specs(NATURAL, { formulario_sarlaft: 'formulario_sarlaft|sin_firma' }));
    await run(claimId);

    expect(await claimOf(claimId)).toMatchObject({ status: 'incompleta', completed_at: null });
    const [evaluation] = await evaluations(claimId);
    expect(evaluation.result.invalid).toEqual([
      expect.objectContaining({ documentType: 'formulario_sarlaft', issue: 'sin_firma' }),
    ]);
    expect(evaluation.result.missing).toEqual([]); // no «falta»: llegó y no sirve

    await uploadLater(claimId, submissionId, 'formulario_sarlaft');
    await run(claimId);
    expect((await claimOf(claimId)).status).toBe('completa');
  });

  it('un relato ambiguo se resuelve con los documentos: una sola reclasificación y el caso se completa', async () => {
    const { claimId } = await seedClaim('Mi padre falleció el mes pasado.', specs(ACCIDENTAL));
    await run(claimId);

    const predictions = await ctx.db.query(
      `SELECT predicted_value FROM classifications WHERE claim_id = $1 AND subject = 'tipo_reclamacion' ORDER BY created_at`,
      [claimId]);
    expect(predictions.rows.map((r) => r.predicted_value)).toEqual(['indeterminado', 'muerte_accidental']);

    const types = await eventTypes(claimId);
    expect(types.indexOf('clasificacion_requiere_revision')).toBeLessThan(types.indexOf('tipo_reclamacion_asignado'));
    const reclassify = await ctx.db.query('SELECT 1 FROM jobs WHERE dedupe_key = $1', [`reclasificar:${claimId}`]);
    expect(reclassify.rows).toHaveLength(1);

    expect(await claimOf(claimId)).toMatchObject({ status: 'completa', claim_type: 'muerte_accidental' });
  });

  it('con el modelo apagado no se pierde ningún caso: tras los reintentos todo queda para una persona', async () => {
    const { claimId } = await seedClaim('Mi padre falleció de un infarto.', specs(NATURAL.slice(0, 3)));
    await run(claimId, modelDown(), true);

    const docs = await ctx.db.query('SELECT status, issue FROM documents WHERE claim_id = $1', [claimId]);
    expect(docs.rows).toHaveLength(3);
    for (const doc of docs.rows) expect(doc).toEqual({ status: 'requiere_revision', issue: 'otro' });

    const jobs = await ctx.db.query(
      'SELECT kind, status, count(*)::int AS n FROM jobs WHERE claim_id = $1 GROUP BY kind, status', [claimId]);
    expect(jobs.rows).toEqual(expect.arrayContaining([
      { kind: 'analizar_documento', status: 'fallido', n: 3 },
      { kind: 'clasificar_reclamacion', status: 'fallido', n: 1 },
    ]));
    expect(jobs.rows.some((j) => j.status === 'pendiente' || j.status === 'en_proceso')).toBe(false);

    expect(await claimOf(claimId)).toMatchObject({ status: 'recibida', claim_type: null, completed_at: null });
    const types = await eventTypes(claimId);
    expect(count(types, 'documento_no_procesado')).toBe(3);
    expect(count(types, 'clasificacion_fallida')).toBe(1);

    // Cada llamada fallida quedó registrada: las cinco del intento de clasificar, entre otras.
    const failedRuns = await ctx.db.query(
      `SELECT count(*)::int AS n FROM ai_runs WHERE claim_id = $1 AND status = 'error'`, [claimId]);
    expect(failedRuns.rows[0].n).toBeGreaterThanOrEqual(5);
  });
});