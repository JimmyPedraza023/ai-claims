import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';
import { DatabaseService } from '../database/database.service';
import { AnalyzeDocumentHandler } from '../modules/classification/analyze-document.handler';
import { ClassifyClaimHandler } from '../modules/classification/classify-claim.handler';
import type { JobKind } from '../modules/jobs/job-queue';
import { JobRunner, type JobHandlers } from '../modules/jobs/job-runner';
import { JobsRepository } from '../modules/jobs/jobs.repository';
import { PostgresJobQueue } from '../modules/jobs/postgres-job-queue';
import { NestRunnerLogger } from './nest-runner-logger';
import { EvaluateCompletenessHandler } from '../modules/completeness/evaluate-completeness.handler';
import { SendNotificationHandler } from '../modules/notifications/send-notification.handler';

@Injectable()
export class WorkerService {
  private readonly logger = new Logger(WorkerService.name);

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly db: DatabaseService,
    private readonly jobs: JobsRepository,
    private readonly analyze: AnalyzeDocumentHandler,
    private readonly classify: ClassifyClaimHandler,
    private readonly evaluate: EvaluateCompletenessHandler,
    private readonly sendNotice: SendNotificationHandler,
  ) {}

  /** Corre hasta que se cancela la señal. Los trabajos en curso terminan antes de salir. */
  async run(signal: AbortSignal): Promise<void> {
    const handlers: JobHandlers = {
      analizar_documento: (job, s) => this.analyze.execute(job, s),
      clasificar_reclamacion: (job, s) => this.classify.execute(job, s),
      evaluar_completitud: (job) => this.evaluate.execute(job),
      enviar_aviso: (job) => this.sendNotice.execute(job),
    };
    const kinds = Object.keys(handlers) as JobKind[];
    const get = <K extends keyof Env>(key: K) => this.config.get(key, { infer: true });

    const options = {
      workerId: `${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`,
      concurrency: get('WORKER_CONCURRENCY'),
      pollIntervalMs: get('WORKER_POLL_MS'),
      jobTimeoutMs: get('JOB_TIMEOUT_MS'),
      leaseSeconds: get('JOB_LEASE_SECONDS'),
    };
    const queue = new PostgresJobQueue(this.db, this.jobs, options.leaseSeconds, kinds);
    const runner = new JobRunner(queue, handlers, options, new NestRunnerLogger());

    this.logger.log({ msg: 'Worker iniciado', ...options, kinds });
    await runner.run(signal);
    this.logger.log('Worker detenido');
  }
}