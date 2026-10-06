import { randomUUID } from 'node:crypto';
import { createTestContext, seedDocument } from './helpers';
import { JobsRepository } from '../../src/modules/jobs/jobs.repository';

const ctx = createTestContext();
const jobs = new JobsRepository();
const A = 'worker-a';
const B = 'worker-b';

afterAll(async () => {
  await ctx.db.onModuleDestroy();
});

/** Un caso con un solo trabajo pendiente, aislado del resto de las pruebas. */
async function newJob(): Promise<string> {
  const { claimId, documentId } = await seedDocument(ctx.db);
  await ctx.db.query(`UPDATE jobs SET status = 'completado' WHERE claim_id = $1`, [claimId]); // por si el seed encoló algo
  await jobs.enqueue(ctx.db, { kind: 'analizar_documento', claimId, documentId, dedupeKey: randomUUID() });
  return claimId;
}

const take = (claimId: string, worker = A) =>
  jobs.claimNext(ctx.db, worker, { leaseSeconds: 180, onlyClaimId: claimId });

async function row(id: number) {
  const { rows } = await ctx.db.query(
    'SELECT status, attempts, locked_by, last_error, finished_at FROM jobs WHERE id = $1', [id]);
  return rows[0];
}

describe('cola de trabajos', () => {
  it('toma un trabajo pendiente: queda en proceso, con su dueño y un intento contado', async () => {
    const claimId = await newJob();
    const job = await take(claimId);
    expect(job).toMatchObject({ kind: 'analizar_documento', claimId, attempts: 1, maxAttempts: 5 });
    expect(await row(job!.id)).toMatchObject({ status: 'en_proceso', attempts: 1, locked_by: A });
  });

  it('dos workers a la vez: solo uno se lleva el trabajo', async () => {
    const claimId = await newJob();
    const [x, y] = await Promise.all([take(claimId, A), take(claimId, B)]);
    expect([x, y].filter((j) => j !== null)).toHaveLength(1);
  });

  it('completar: el dueño puede; otro worker no', async () => {
    const claimId = await newJob();
    const job = (await take(claimId))!;
    expect(await jobs.complete(ctx.db, job.id, B)).toBe(false);
    expect(await jobs.complete(ctx.db, job.id, A)).toBe(true);
    expect(await row(job.id)).toMatchObject({ status: 'completado', locked_by: null });
  });

  it('reintento: no se toma antes de su hora y sí después, con el intento contado', async () => {
    const claimId = await newJob();
    const job = (await take(claimId))!;
    expect(await jobs.retryLater(ctx.db, job.id, A, 'timeout: lento', 3600)).toBe('pendiente');
    expect(await take(claimId)).toBeNull();

    await ctx.db.query(`UPDATE jobs SET run_at = now() - interval '1 second' WHERE id = $1`, [job.id]);
    const again = await take(claimId);
    expect(again).toMatchObject({ id: job.id, attempts: 2 });
    expect((await row(job.id)).last_error).toBe('timeout: lento');
  });

  it('agotados los intentos, el trabajo pasa a fallido', async () => {
    const claimId = await newJob();
    const first = (await take(claimId))!;
    await ctx.db.query('UPDATE jobs SET max_attempts = 2 WHERE id = $1', [first.id]);
    expect(await jobs.retryLater(ctx.db, first.id, A, 'error 1', 0)).toBe('pendiente');
    const second = (await take(claimId))!;
    expect(second.attempts).toBe(2);
    expect(await jobs.retryLater(ctx.db, second.id, A, 'error 2', 0)).toBe('fallido');
    expect(await row(first.id)).toMatchObject({ status: 'fallido', last_error: 'error 2' });
    expect((await row(first.id)).finished_at).not.toBeNull();
    expect(await take(claimId)).toBeNull();
  });

  it('un worker muerto: al vencer su lease otro retoma el trabajo y el resultado tardío del primero se ignora', async () => {
    const claimId = await newJob();
    const job = (await take(claimId, A))!;
    expect(await take(claimId, B)).toBeNull(); // el lease sigue vigente

    await ctx.db.query(`UPDATE jobs SET locked_at = now() - interval '10 minutes' WHERE id = $1`, [job.id]);
    const retaken = await take(claimId, B);
    expect(retaken).toMatchObject({ id: job.id, attempts: 2 });

    expect(await jobs.complete(ctx.db, job.id, A)).toBe(false); // A despierta tarde: ya no es suyo
    expect(await jobs.complete(ctx.db, job.id, B)).toBe(true);
  });

  it('un trabajo abandonado que ya agotó sus intentos pasa a fallido y no se retoma', async () => {
    const claimId = await newJob();
    const job = (await take(claimId))!;
    await ctx.db.query(
      `UPDATE jobs SET max_attempts = 1, locked_at = now() - interval '10 minutes' WHERE id = $1`, [job.id]);

    expect(await take(claimId, B)).toBeNull();
    expect(await jobs.failExhausted(ctx.db, { leaseSeconds: 180, onlyClaimId: claimId })).toBe(1);
    expect(await row(job.id)).toMatchObject({ status: 'fallido' });
  });

  it('un fallo sin reintento queda registrado', async () => {
    const claimId = await newJob();
    const job = (await take(claimId))!;
    expect(await jobs.failPermanently(ctx.db, job.id, A, 'bad_request: clave inválida')).toBe(true);
    expect(await row(job.id)).toMatchObject({ status: 'fallido', last_error: 'bad_request: clave inválida' });
  });
});