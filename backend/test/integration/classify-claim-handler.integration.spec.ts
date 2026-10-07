import { createAnalyst, createTestContext, seedDocument } from './helpers';
import { AiRunsRepository } from '../../src/modules/classification/ai-runs.repository';
import { AnalysisRecorder } from '../../src/modules/classification/analysis-recorder';
import { ClassificationsRepository } from '../../src/modules/classification/classifications.repository';
import { ClassifyClaimHandler } from '../../src/modules/classification/classify-claim.handler';
import type { ClaimClassification } from '../../src/modules/classification/classification.schemas';
import { LlmError } from '../../src/modules/classification/llm-provider';
import { FakeLlmProvider } from '../../src/modules/classification/testing/fake-llm-provider';
import { ClaimsRepository } from '../../src/modules/claims/claims.repository';
import { DocumentsRepository } from '../../src/modules/documents/documents.repository';
import type { ClaimedJob } from '../../src/modules/jobs/job-queue';
import { JobsRepository } from '../../src/modules/jobs/jobs.repository';

const ctx = createTestContext();
afterAll(async () => {
  await ctx.db.onModuleDestroy();
});

const classification = (
  value: ClaimClassification['claimType']['value'], confidence = 0.95,
): ClaimClassification => ({ claimType: { value, confidence }, evidence: 'texto interno' });

function build(llm: FakeLlmProvider) {
  const documents = new DocumentsRepository();
  const recorder = new AnalysisRecorder(new AiRunsRepository(), new ClassificationsRepository(), documents);
  return new ClassifyClaimHandler(ctx.db, new ClaimsRepository(), documents, llm, recorder, ctx.audit, new JobsRepository());
}
const fake = (value: ClaimClassification['claimType']['value'], confidence?: number) =>
  new FakeLlmProvider({ classifyClaim: () => classification(value, confidence) });

const job = (claimId: string, over: Partial<ClaimedJob> = {}): ClaimedJob => ({
  id: 1, kind: 'clasificar_reclamacion', claimId, documentId: null, notificationId: null, attempts: 1, maxAttempts: 5, ...over,
});
const signal = () => new AbortController().signal;

async function claimType(claimId: string) {
  const { rows } = await ctx.db.query('SELECT claim_type FROM claims WHERE id = $1', [claimId]);
  return rows[0].claim_type;
}
async function events(claimId: string, type: string) {
  const { rows } = await ctx.db.query('SELECT payload FROM claim_events WHERE claim_id = $1 AND event_type = $2', [claimId, type]);
  return rows;
}
async function evaluationJobs(claimId: string) {
  const { rows } = await ctx.db.query(`SELECT 1 FROM jobs WHERE claim_id = $1 AND kind = 'evaluar_completitud'`, [claimId]);
  return rows;
}

describe('ClassifyClaimHandler', () => {
  it('confianza alta: el tipo se escribe, queda auditado y se encola la evaluación', async () => {
    const { claimId } = await seedDocument(ctx.db);
    await build(fake('muerte_natural')).execute(job(claimId), signal());

    expect(await claimType(claimId)).toBe('muerte_natural');
    const pred = await ctx.db.query(`SELECT predicted_value, document_id FROM classifications WHERE claim_id = $1 AND subject = 'tipo_reclamacion'`, [claimId]);
    expect(pred.rows).toEqual([{ predicted_value: 'muerte_natural', document_id: null }]);
    expect(await events(claimId, 'tipo_reclamacion_asignado')).toHaveLength(1);
    expect(await evaluationJobs(claimId)).toHaveLength(1);
  });

  it('"indeterminado": no se escribe nada, queda la predicción y se avisa a una persona', async () => {
    const { claimId } = await seedDocument(ctx.db);
    await build(fake('indeterminado', 0.4)).execute(job(claimId), signal());

    expect(await claimType(claimId)).toBeNull();
    const review = await events(claimId, 'clasificacion_requiere_revision');
    expect(review[0].payload).toMatchObject({ reason: 'tipo_indeterminado' });
    expect(await events(claimId, 'tipo_reclamacion_asignado')).toHaveLength(0);
  });

  it('con baja confianza tampoco se escribe', async () => {
    const { claimId } = await seedDocument(ctx.db);
    await build(fake('muerte_accidental', 0.6)).execute(job(claimId), signal());
    expect(await claimType(claimId)).toBeNull();
  });

  it('si el modelo propone otro tipo después, se conserva el guardado y se pide revisión', async () => {
    const { claimId } = await seedDocument(ctx.db);
    await build(fake('muerte_natural')).execute(job(claimId), signal());
    await build(fake('muerte_accidental')).execute(job(claimId, { id: 2 }), signal());

    expect(await claimType(claimId)).toBe('muerte_natural');
    expect((await events(claimId, 'clasificacion_requiere_revision'))[0].payload).toMatchObject({ reason: 'cambio_de_tipo' });
  });

  it('lo que confirmó una persona no lo toca el modelo, ni siquiera para pedir revisión', async () => {
    const { claimId } = await seedDocument(ctx.db);
    await build(fake('muerte_natural')).execute(job(claimId), signal());

    const analyst = await createAnalyst(ctx.db);
    await ctx.db.query(
      `UPDATE classifications SET final_value = 'muerte_natural', reviewed_by = $1, reviewed_at = now()
        WHERE claim_id = $2 AND subject = 'tipo_reclamacion'`, [analyst, claimId]);

    await build(fake('muerte_accidental')).execute(job(claimId, { id: 2 }), signal());
    expect(await claimType(claimId)).toBe('muerte_natural');
    expect(await events(claimId, 'clasificacion_requiere_revision')).toHaveLength(0);
  });

  it('el modelo falla antes del último intento: se registra, se relanza y no se anota evento', async () => {
    const { claimId } = await seedDocument(ctx.db);
    const llm = new FakeLlmProvider({ error: new LlmError('timeout', 'sin respuesta') });
    await expect(build(llm).execute(job(claimId, { attempts: 2 }), signal())).rejects.toThrow('sin respuesta');

    const runs = await ctx.db.query(`SELECT status FROM ai_runs WHERE claim_id = $1 AND task = 'clasificar_reclamacion'`, [claimId]);
    expect(runs.rows).toEqual([{ status: 'timeout' }]);
    expect(await events(claimId, 'clasificacion_fallida')).toHaveLength(0);
    expect(await claimType(claimId)).toBeNull();
  });

  it('el modelo falla en el último intento: el caso queda sin tipo y con un evento', async () => {
    const { claimId } = await seedDocument(ctx.db);
    const llm = new FakeLlmProvider({ error: new LlmError('unavailable', 'caído') });
    await expect(build(llm).execute(job(claimId, { attempts: 5 }), signal())).rejects.toThrow();

    expect((await events(claimId, 'clasificacion_fallida'))[0].payload).toMatchObject({ reason: 'unavailable' });
    expect(await claimType(claimId)).toBeNull();
  });
});