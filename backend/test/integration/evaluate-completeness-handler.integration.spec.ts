import { randomBytes } from 'node:crypto';
import { createTestContext, seedDocument } from './helpers';
import type { ClaimType, DocumentIssue, DocumentStatus, DocumentType } from '../../src/common/domain/enums';
import { ClaimsRepository } from '../../src/modules/claims/claims.repository';
import { REQUIRED_DOCUMENTS, RULES_VERSION } from '../../src/modules/completeness/completeness.rules';
import { CompletenessEvaluationsRepository } from '../../src/modules/completeness/completeness-evaluations.repository';
import { EvaluateCompletenessHandler } from '../../src/modules/completeness/evaluate-completeness.handler';
import { DocumentsRepository } from '../../src/modules/documents/documents.repository';
import type { ClaimedJob } from '../../src/modules/jobs/job-queue';
import { JobsRepository } from '../../src/modules/jobs/jobs.repository';
import { computeDeadline } from '../../src/modules/legal-clock/legal-clock';

const ctx = createTestContext();
afterAll(async () => {
  await ctx.db.onModuleDestroy();
});

const handler = new EvaluateCompletenessHandler(
  ctx.db, new ClaimsRepository(), new DocumentsRepository(), new CompletenessEvaluationsRepository(), ctx.audit, new JobsRepository(),
);
const REQUIRED = REQUIRED_DOCUMENTS.muerte_natural;
const job = (claimId: string): ClaimedJob => ({
  id: 1, kind: 'evaluar_completitud', claimId, documentId: null, attempts: 1, maxAttempts: 5,
});

/** Caso con tipo (o sin él) y su primer documento en el estado indicado. */
async function prepareClaim(
  claimType: ClaimType | null,
  first: { type: DocumentType | null; status: DocumentStatus; issue?: DocumentIssue },
) {
  const { claimId, documentId } = await seedDocument(ctx.db);
  if (claimType) await ctx.db.query('UPDATE claims SET claim_type = $2 WHERE id = $1', [claimId, claimType]);
  await ctx.db.query('UPDATE documents SET document_type = $2, status = $3, issue = $4 WHERE id = $1',
    [documentId, first.type, first.status, first.issue ?? null]);
  return { claimId, documentId };
}

async function addDocument(claimId: string, type: DocumentType, status: DocumentStatus = 'valido') {
  const { rows } = await ctx.db.query('SELECT submission_id FROM documents WHERE claim_id = $1 LIMIT 1', [claimId]);
  const sha = randomBytes(32).toString('hex');
  await ctx.db.query(
    `INSERT INTO documents (claim_id, submission_id, original_filename, mime_type, size_bytes, sha256, storage_path, document_type, status)
     VALUES ($1, $2, 'x.pdf', 'application/pdf', 10, $3, $4, $5, $6)`,
    [claimId, rows[0].submission_id, sha, `${sha.slice(0, 2)}/${sha}.pdf`, type, status]);
}
const addRequired = async (claimId: string, types: readonly DocumentType[]) => {
  for (const t of types) await addDocument(claimId, t);
};

const claimRow = async (id: string) =>
  (await ctx.db.query('SELECT status, completed_at, deadline_date FROM claims WHERE id = $1', [id])).rows[0];
const evaluationsOf = async (id: string) =>
  (await ctx.db.query('SELECT claim_type, rules_version, is_complete, created_at FROM completeness_evaluations WHERE claim_id = $1 ORDER BY created_at', [id])).rows;
const eventsOf = async (id: string, type: string) =>
  (await ctx.db.query('SELECT payload FROM claim_events WHERE claim_id = $1 AND event_type = $2', [id, type])).rows;

describe('EvaluateCompletenessHandler', () => {
  it('expediente completo: arranca el reloj, con su fecha límite y la evidencia guardada', async () => {
    const { claimId } = await prepareClaim('muerte_natural', { type: REQUIRED[0], status: 'valido' });
    await addRequired(claimId, REQUIRED.slice(1));
    await handler.execute(job(claimId));

    const c = await claimRow(claimId);
    expect(c.status).toBe('completa');
    expect(c.completed_at).toBeInstanceOf(Date);
    expect(c.deadline_date).toBe(computeDeadline(c.completed_at));

    expect(await evaluationsOf(claimId)).toMatchObject([
      { claim_type: 'muerte_natural', rules_version: RULES_VERSION, is_complete: true },
    ]);
    expect(await eventsOf(claimId, 'expediente_evaluado')).toHaveLength(1);
    expect((await eventsOf(claimId, 'expediente_completo'))[0].payload).toMatchObject({ deadlineDate: c.deadline_date });
  });

  it('incompleto: el caso pasa a "incompleta", el reloj NO arranca y el evento dice qué hay', async () => {
    const { claimId } = await prepareClaim('muerte_natural', { type: 'formulario_sarlaft', status: 'invalido', issue: 'sin_firma' });
    await handler.execute(job(claimId));

    expect(await claimRow(claimId)).toMatchObject({ status: 'incompleta', completed_at: null, deadline_date: null });
    expect(await evaluationsOf(claimId)).toMatchObject([{ is_complete: false }]);
    const payload = (await eventsOf(claimId, 'expediente_evaluado'))[0].payload;
    expect(payload.invalid).toEqual([{ documentType: 'formulario_sarlaft', issue: 'sin_firma' }]);
    expect(payload.missing).toContain('certificacion_bancaria');
    expect(await eventsOf(claimId, 'expediente_completo')).toHaveLength(0);
  });

  it('el reloj arranca al completarse, no al radicar', async () => {
    const { claimId } = await prepareClaim('muerte_natural', { type: REQUIRED[0], status: 'valido' });
    await handler.execute(job(claimId));
    expect(await claimRow(claimId)).toMatchObject({ status: 'incompleta', completed_at: null });

    await addRequired(claimId, REQUIRED.slice(1));
    await handler.execute(job(claimId));
    const c = await claimRow(claimId);
    expect(c.status).toBe('completa');
    const evaluations = await evaluationsOf(claimId);
    expect(evaluations).toHaveLength(2);
    expect(c.completed_at.getTime()).toBeGreaterThanOrEqual(evaluations[1].created_at.getTime() - 1000);
  });

  it('con documentos aún sin analizar no evalúa nada', async () => {
    const { claimId } = await prepareClaim('muerte_natural', { type: null, status: 'pendiente_analisis' });
    await handler.execute(job(claimId));
    expect(await evaluationsOf(claimId)).toHaveLength(0);
    expect((await claimRow(claimId)).status).toBe('recibida');
  });

  it('sin tipo y con un documento reconocido: pide UNA reclasificación, aunque se evalúe varias veces', async () => {
    const { claimId } = await prepareClaim(null, { type: 'formulario_sarlaft', status: 'valido' });
    await handler.execute(job(claimId));
    await handler.execute(job(claimId));

    const { rows } = await ctx.db.query(`SELECT 1 FROM jobs WHERE dedupe_key = $1`, [`reclasificar:${claimId}`]);
    expect(rows).toHaveLength(1);
    expect(await evaluationsOf(claimId)).toHaveLength(0);
  });

  it('sin tipo y sin documentos reconocidos: no hace nada', async () => {
    const { claimId } = await prepareClaim(null, { type: 'no_identificado', status: 'requiere_revision' });
    await handler.execute(job(claimId));
    const { rows } = await ctx.db.query(`SELECT 1 FROM jobs WHERE dedupe_key = $1`, [`reclasificar:${claimId}`]);
    expect(rows).toHaveLength(0);
  });

  it('un caso ya completo no se vuelve a evaluar: el reloj no se mueve aunque un documento cambie', async () => {
    const { claimId, documentId } = await prepareClaim('muerte_natural', { type: REQUIRED[0], status: 'valido' });
    await addRequired(claimId, REQUIRED.slice(1));
    await handler.execute(job(claimId));
    const before = await claimRow(claimId);

    await ctx.db.query(`UPDATE documents SET status = 'invalido', issue = 'otro' WHERE id = $1`, [documentId]);
    await handler.execute(job(claimId));

    expect(await claimRow(claimId)).toEqual(before);
    expect(await evaluationsOf(claimId)).toHaveLength(1);
  });

  it('dos evaluaciones simultáneas: el reloj arranca una sola vez', async () => {
    const { claimId } = await prepareClaim('muerte_natural', { type: REQUIRED[0], status: 'valido' });
    await addRequired(claimId, REQUIRED.slice(1));
    await Promise.all([handler.execute(job(claimId)), handler.execute(job(claimId))]);

    expect(await eventsOf(claimId, 'expediente_completo')).toHaveLength(1);
    expect(await evaluationsOf(claimId)).toHaveLength(1);
  });
});