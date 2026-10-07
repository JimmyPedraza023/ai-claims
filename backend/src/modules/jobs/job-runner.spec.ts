import { JobRunner, type JobHandlers, type RunnerLogger } from './job-runner';
import { isFinalFailure, type ClaimedJob, JobQueue } from './job-queue';


class FakeQueue implements JobQueue {
  readonly completed: number[] = [];
  readonly retried: Array<{ id: number; error: string; delay: number }> = [];
  readonly failed: Array<{ id: number; error: string }> = [];
  sweeps = 0;
  retryResult: 'pendiente' | 'fallido' | null = 'pendiente';
  completeResult = true;
  constructor(private pending: ClaimedJob[]) {}

  async claimNext() { return this.pending.shift() ?? null; }
  async complete(id: number) { this.completed.push(id); return this.completeResult; }
  async retryLater(id: number, _w: string, error: string, delay: number) {
    this.retried.push({ id, error, delay });
    return this.retryResult;
  }
  async failPermanently(id: number, _w: string, error: string) { this.failed.push({ id, error }); return true; }
  async sweep() { this.sweeps++; return 0; }
}

const job = (attempts: number, maxAttempts = 5): ClaimedJob => ({
  id: 1, kind: 'analizar_documento', claimId: 'c', documentId: 'd', notificationId: null, attempts, maxAttempts,
});

const logger: RunnerLogger = { info() {}, warn() {}, error() {} };
const options = { workerId: 'w1', concurrency: 1, pollIntervalMs: 10, jobTimeoutMs: 1000, leaseSeconds: 5 };
const noSleep = async () => {};

const make = (queue: FakeQueue, handlers: JobHandlers, sleep = noSleep) =>
  new JobRunner(queue, handlers, options, logger, sleep);

describe('JobRunner.runOnce', () => {
  it('sin trabajos devuelve false', async () => {
    expect(await make(new FakeQueue([]), {}).runOnce()).toBe(false);
  });

  it('un trabajo exitoso se completa', async () => {
    const q = new FakeQueue([job(1)]);
    expect(await make(q, { analizar_documento: async () => {} }).runOnce()).toBe(true);
    expect(q.completed).toEqual([1]);
  });

  it('un error reintentable programa un reintento con espera creciente', async () => {
    const q = new FakeQueue([job(3)]);
    await make(q, { analizar_documento: async () => { throw new Error('se cayó la red'); } }).runOnce();
    expect(q.retried).toEqual([{ id: 1, error: 'se cayó la red', delay: 120 }]);
    expect(q.completed).toEqual([]);
  });

  it('un error con retryable:false falla sin reintento', async () => {
    const q = new FakeQueue([job(1)]);
    const err = Object.assign(new Error('clave inválida'), { kind: 'bad_request', retryable: false });
    await make(q, { analizar_documento: async () => { throw err; } }).runOnce();
    expect(q.failed).toEqual([{ id: 1, error: 'bad_request: clave inválida' }]);
    expect(q.retried).toEqual([]);
  });

  it('un rate_limited espera al menos 60 segundos', async () => {
    const q = new FakeQueue([job(1)]);
    const err = Object.assign(new Error('429'), { kind: 'rate_limited', retryable: true });
    await make(q, { analizar_documento: async () => { throw err; } }).runOnce();
    expect(q.retried[0].delay).toBe(60);
  });

  it('un tipo de trabajo sin manejador falla sin reintento', async () => {
    const q = new FakeQueue([job(1)]);
    await make(q, {}).runOnce();
    expect(q.failed[0].error).toContain('evaluar_completitud');
  });

  it('un trabajo que no respeta el tiempo máximo se reporta como timeout', async () => {
    const q = new FakeQueue([job(1)]);
    const fast = new JobRunner(q, {
      analizar_documento: (_j, signal) =>
        new Promise((_res, reject) => signal.addEventListener('abort', () => reject(new Error('abortado')))),
    }, { ...options, jobTimeoutMs: 20 }, logger, noSleep);
    await fast.runOnce();
    expect(q.retried[0].error).toContain('timeout');
  });

  it('si el trabajo ya no era suyo al terminar, no falla', async () => {
    const q = new FakeQueue([job(1)]);
    q.completeResult = false;
    await expect(make(q, { analizar_documento: async () => {} }).runOnce()).resolves.toBe(true);
  });

  it('rechaza una configuración donde el lease no cubre el timeout', () => {
    expect(() => new JobRunner(new FakeQueue([]), {}, { ...options, leaseSeconds: 1 }, logger)).toThrow(/lease/);
  });
});

describe('JobRunner.run', () => {
  it('procesa los trabajos pendientes y se detiene al cancelar la señal', async () => {
    const q = new FakeQueue([job(1), job(2)]);
    const controller = new AbortController();
    const runner = make(q, {
      analizar_documento: async (j) => { if (j.id === 2) controller.abort(); },
    });
    await runner.run(controller.signal);
    expect(q.completed).toEqual([1, 2]);
  });

  it('cuando no hay trabajos, limpia los abandonados y espera', async () => {
    const q = new FakeQueue([]);
    const controller = new AbortController();
    await make(q, {}, async () => controller.abort()).run(controller.signal);
    expect(q.sweeps).toBe(1);
  });
});

describe('isFinalFailure', () => {
  it('con intentos disponibles y un error reintentable, no es definitivo', () => {
    expect(isFinalFailure(job(2), new Error('red'))).toBe(false);
  });
  it('en el último intento sí lo es', () => {
    expect(isFinalFailure(job(5), new Error('red'))).toBe(true);
  });
  it('un error sin remedio es definitivo desde el primer intento', () => {
    expect(isFinalFailure(job(1), Object.assign(new Error('clave inválida'), { retryable: false }))).toBe(true);
  });
});