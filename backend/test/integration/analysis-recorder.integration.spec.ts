import { createAnalyst, createTestContext } from './helpers';
import { AnalysisRecorder } from '../../src/modules/classification/analysis-recorder';
import { AiRunsRepository } from '../../src/modules/classification/ai-runs.repository';
import { ClassificationsRepository } from '../../src/modules/classification/classifications.repository';
import { DocumentsRepository } from '../../src/modules/documents/documents.repository';
import { LlmError, type LlmResult } from '../../src/modules/classification/llm-provider';
import type { ClaimClassification, DocumentAnalysis, DocumentType } from '../../src/modules/classification/classification.schemas';

const ctx = createTestContext();
const recorder = new AnalysisRecorder(new AiRunsRepository(), new ClassificationsRepository(), new DocumentsRepository());

afterAll(async () => {
  await ctx.db.onModuleDestroy(); // cierra el pool igual que en tus otros specs
});

/**
 * ADAPTAR: copia aquí cómo documents.integration.spec.ts crea un caso, un envío y un documento
 * (el documento debe quedar en 'pendiente_analisis', que es el default). Devuelve sus ids.
 */
async function seedDocument(): Promise<{ claimId: string; documentId: string }> {
  throw new Error('Adapta seedDocument() a tus fixtures (ver documents.integration.spec.ts)');
}

const f = <T>(value: T, confidence = 0.95) => ({ value, confidence });
const analysis = (over: Partial<DocumentAnalysis> = {}): DocumentAnalysis => ({
  documentType: f<DocumentType>('formulario_sarlaft'),
  legible: f(true),
  signed: f<boolean | null>(true),
  matchesInsured: f<boolean | null>(null),
  reason: 'Firma visible en el recuadro',
  ...over,
});
const result = <T>(data: T): LlmResult<T> => ({
  data,
  meta: { model: 'modelo-x', promptVersion: 'prompts-v1', latencyMs: 1234, promptTokens: 100, completionTokens: 20, rawOutput: JSON.stringify(data) },
});
const inputRef = { pages: 1, imageBytes: [2048] };

async function documentRow(id: string) {
  const { rows } = await ctx.db.query(
    'SELECT document_type, status, issue, issue_detail, extracted_data FROM documents WHERE id = $1', [id]);
  return rows[0];
}
async function classificationsOf(documentId: string) {
  const { rows } = await ctx.db.query(
    'SELECT subject, predicted_value, confidence FROM classifications WHERE document_id = $1 ORDER BY subject', [documentId]);
  return rows;
}

describe('AnalysisRecorder', () => {
  it('documento válido: registra la llamada, actualiza el documento y guarda dos predicciones', async () => {
    const { claimId, documentId } = await seedDocument();
    const out = await recorder.recordDocumentAnalysis(ctx.db, {
      claimId, documentId, provider: 'nvidia', inputRef, result: result(analysis()),
    });

    expect(out.applied).toBe(true);
    const doc = await documentRow(documentId);
    expect(doc).toMatchObject({ document_type: 'formulario_sarlaft', status: 'valido', issue: null });
    expect(doc.extracted_data.policyVersion).toBe('policy-v1');

    const runs = await ctx.db.query('SELECT status, model, prompt_version, latency_ms, input_ref FROM ai_runs WHERE document_id = $1', [documentId]);
    expect(runs.rows).toHaveLength(1);
    expect(runs.rows[0]).toMatchObject({ status: 'ok', model: 'modelo-x', prompt_version: 'prompts-v1', latency_ms: 1234 });
    expect(JSON.stringify(runs.rows[0].input_ref)).not.toContain('Ana');

    const preds = await classificationsOf(documentId);
    expect(preds.map((p) => [p.subject, p.predicted_value])).toEqual([
      ['tipo_documento', 'formulario_sarlaft'],
      ['validez_documento', 'valido'],
    ]);
  });

  it('SARLAFT sin firma: el documento queda inválido con su motivo y la validez predicha es "invalido"', async () => {
    const { claimId, documentId } = await seedDocument();
    await recorder.recordDocumentAnalysis(ctx.db, {
      claimId, documentId, provider: 'nvidia', inputRef,
      result: result(analysis({ signed: f<boolean | null>(false) })),
    });
    expect(await documentRow(documentId)).toMatchObject({ status: 'invalido', issue: 'sin_firma' });
    const preds = await classificationsOf(documentId);
    expect(preds.find((p) => p.subject === 'validez_documento')?.predicted_value).toBe('invalido');
  });

  it('un reintento no pisa lo ya analizado ni duplica predicciones, pero la llamada sí queda registrada', async () => {
    const { claimId, documentId } = await seedDocument();
    await recorder.recordDocumentAnalysis(ctx.db, { claimId, documentId, provider: 'nvidia', inputRef, result: result(analysis()) });
    const second = await recorder.recordDocumentAnalysis(ctx.db, {
      claimId, documentId, provider: 'nvidia', inputRef,
      result: result(analysis({ signed: f<boolean | null>(false) })),
    });

    expect(second.applied).toBe(false);
    expect((await documentRow(documentId)).status).toBe('valido');
    expect(await classificationsOf(documentId)).toHaveLength(2);
    const runs = await ctx.db.query('SELECT 1 FROM ai_runs WHERE document_id = $1', [documentId]);
    expect(runs.rows).toHaveLength(2);
  });

  it('un fallo del modelo queda registrado y el documento no cambia', async () => {
    const { claimId, documentId } = await seedDocument();
    await recorder.recordFailure(ctx.db, {
      claimId, documentId, task: 'analizar_documento', provider: 'nvidia', fallbackModel: 'modelo-x', inputRef,
      error: new LlmError('timeout', 'El modelo no respondió en 120000 ms', { latencyMs: 120000 }),
    });
    const runs = await ctx.db.query('SELECT status, error, parsed_output, model FROM ai_runs WHERE document_id = $1', [documentId]);
    expect(runs.rows[0]).toMatchObject({ status: 'timeout', parsed_output: null, model: 'modelo-x' });
    expect(runs.rows[0].error).toContain('timeout');
    expect((await documentRow(documentId)).status).toBe('pendiente_analisis');
  });

  it('un error que no es del modelo también se registra', async () => {
    const { claimId, documentId } = await seedDocument();
    await recorder.recordFailure(ctx.db, {
      claimId, documentId, task: 'analizar_documento', provider: 'nvidia', fallbackModel: 'modelo-x', inputRef,
      error: new Error('PDF corrupto'),
    });
    const runs = await ctx.db.query('SELECT status FROM ai_runs WHERE document_id = $1', [documentId]);
    expect(runs.rows[0].status).toBe('error');
  });

  it('clasificación de la reclamación: guarda la predicción (sin documento) y devuelve la decisión', async () => {
    const { claimId } = await seedDocument();
    const data: ClaimClassification = { claimType: f('muerte_natural' as const, 0.93), evidence: 'Infarto' };
    const out = await recorder.recordClaimClassification(ctx.db, {
      claimId, provider: 'nvidia', inputRef: { narrativeLength: 40, documentTypes: [] },
      result: result(data), existing: { claimType: null, source: null },
    });
    expect(out.decision).toMatchObject({ claimType: 'muerte_natural', shouldWrite: true });
    const { rows } = await ctx.db.query(
      'SELECT subject, predicted_value, document_id FROM classifications WHERE claim_id = $1 AND subject = $2', [claimId, 'tipo_reclamacion']);
    expect(rows).toEqual([{ subject: 'tipo_reclamacion', predicted_value: 'muerte_natural', document_id: null }]);
  });

  it('pregunta 2: una corrección humana se refleja en la tasa de correcciones', async () => {
    const { claimId, documentId } = await seedDocument();
    await recorder.recordDocumentAnalysis(ctx.db, { claimId, documentId, provider: 'nvidia', inputRef, result: result(analysis()) });

    const analyst = await createAnalyst(ctx.db);
    await ctx.db.query(
      `UPDATE classifications SET final_value = 'invalido', reviewed_by = $1, reviewed_at = now()
        WHERE document_id = $2 AND subject = 'validez_documento'`, [analyst, documentId]);

    const { rows } = await ctx.db.query(
      `SELECT corrected, reviewed FROM v_model_correction_rate WHERE subject = 'validez_documento'`);
    expect(Number(rows[0].corrected)).toBeGreaterThanOrEqual(1);
    expect(Number(rows[0].reviewed)).toBeGreaterThanOrEqual(1);
  });
});