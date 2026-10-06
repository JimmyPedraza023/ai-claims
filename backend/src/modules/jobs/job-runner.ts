import { backoffSeconds } from './backoff';
import type { ClaimedJob, JobKind, JobQueue } from './job-queue';

/** Recibe el trabajo y una señal que se cancela al vencer el tiempo máximo: el handler debe pasarla al modelo. */
export type JobHandler = (job: ClaimedJob, signal: AbortSignal) => Promise<void>;
export type JobHandlers = Partial<Record<JobKind, JobHandler>>;

export interface RunnerLogger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export type Sleep = (ms: number, signal: AbortSignal) => Promise<void>;

export interface RunnerOptions {
  workerId: string;
  /** Trabajos en paralelo. Con ~50 s por llamada al modelo, 2 o 3 es lo razonable. */
  concurrency: number;
  pollIntervalMs: number;
  /** Tiempo máximo de un trabajo completo (rasterizar + modelo + guardar). */
  jobTimeoutMs: number;
  /** Cuánto "reserva" un worker un trabajo. Debe superar jobTimeoutMs. */
  leaseSeconds: number;
}

const abortableSleep: Sleep = (ms, signal) =>
  new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });

const RATE_LIMIT_MIN_DELAY_SECONDS = 60;

function field(e: unknown, name: string): unknown {
  return typeof e === 'object' && e !== null ? (e as Record<string, unknown>)[name] : undefined;
}

function describeError(e: unknown): string {
  const kind = field(e, 'kind');
  const message = e instanceof Error ? e.message : 'error desconocido';
  return (typeof kind === 'string' ? `${kind}: ${message}` : message).slice(0, 500);
}

export class JobRunner {
  constructor(
    private readonly queue: JobQueue,
    private readonly handlers: JobHandlers,
    private readonly options: RunnerOptions,
    private readonly logger: RunnerLogger,
    private readonly sleep: Sleep = abortableSleep,
  ) {
    if (options.leaseSeconds * 1000 <= options.jobTimeoutMs) {
      throw new Error('leaseSeconds debe ser mayor que jobTimeoutMs: si no, otro worker tomaría un trabajo aún en curso');
    }
  }

  /** Corre hasta que se cancela la señal. Los trabajos en curso terminan antes de salir. */
  async run(signal: AbortSignal): Promise<void> {
    await Promise.all(Array.from({ length: this.options.concurrency }, (_, i) => this.loop(signal, i)));
  }

  /** Toma y procesa un trabajo. Devuelve false si no había ninguno. */
  async runOnce(): Promise<boolean> {
    const { workerId, jobTimeoutMs } = this.options;
    const job = await this.queue.claimNext(workerId);
    if (!job) return false;

    const context = { jobId: job.id, kind: job.kind, claimId: job.claimId, attempt: job.attempts };
    const handler = this.handlers[job.kind];
    if (!handler) {
      this.logger.error('No hay manejador para este tipo de trabajo', context);
      await this.queue.failPermanently(job.id, workerId, `no hay manejador para ${job.kind}`);
      return true;
    }

    const signal = AbortSignal.timeout(jobTimeoutMs);
    try {
      await handler(job, signal);
      const owned = await this.queue.complete(job.id, workerId);
      if (owned) this.logger.info('Trabajo completado', context);
      else this.logger.warn('El trabajo terminó, pero ya no era de este worker (venció su lease)', context);
    } catch (e) {
      await this.handleFailure(job, e, signal, context);
    }
    return true;
  }

  private async handleFailure(
    job: ClaimedJob, e: unknown, signal: AbortSignal, context: Record<string, unknown>,
  ): Promise<void> {
    const { workerId } = this.options;
    const timedOut = signal.aborted && typeof field(e, 'kind') !== 'string';
    const message = timedOut ? 'timeout: el trabajo superó su tiempo máximo' : describeError(e);

    if (field(e, 'retryable') === false) {
      this.logger.error('Trabajo fallido sin reintento', { ...context, error: message });
      await this.queue.failPermanently(job.id, workerId, message);
      return;
    }

    const minDelay = field(e, 'kind') === 'rate_limited' ? RATE_LIMIT_MIN_DELAY_SECONDS : 0;
    const delay = backoffSeconds(job.attempts, minDelay);
    const state = await this.queue.retryLater(job.id, workerId, message, delay);
    if (state === 'fallido') {
      this.logger.error('Trabajo fallido: agotó sus intentos', { ...context, error: message });
    } else {
      this.logger.warn('Trabajo fallido, se reintentará', { ...context, error: message, retryInSeconds: delay });
    }
  }

  private async loop(signal: AbortSignal, index: number): Promise<void> {
    while (!signal.aborted) {
      let worked = false;
      try {
        worked = await this.runOnce();
      } catch (e) {
        // Por ejemplo, la base de datos no responde: se registra y se espera, sin girar en vacío.
        this.logger.error('Fallo inesperado en el ciclo del worker', { error: describeError(e) });
      }
      if (!worked) {
        if (index === 0) await this.sweepSafely();
        await this.sleep(this.options.pollIntervalMs, signal);
      }
    }
  }

  private async sweepSafely(): Promise<void> {
    try {
      const failed = await this.queue.sweep();
      if (failed > 0) this.logger.error('Trabajos abandonados que agotaron sus intentos', { count: failed });
    } catch (e) {
      this.logger.error('Falló la limpieza de trabajos abandonados', { error: describeError(e) });
    }
  }
}