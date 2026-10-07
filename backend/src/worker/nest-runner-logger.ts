import { Logger } from '@nestjs/common';
import type { RunnerLogger } from '../modules/jobs/job-runner';

/** Lleva los mensajes del runner al logger de la aplicación (pino), con el contexto como campos. */
export class NestRunnerLogger implements RunnerLogger {
  private readonly logger = new Logger('JobRunner');
  info(msg: string, context: Record<string, unknown> = {}) { this.logger.log({ msg, ...context }); }
  warn(msg: string, context: Record<string, unknown> = {}) { this.logger.warn({ msg, ...context }); }
  error(msg: string, context: Record<string, unknown> = {}) { this.logger.error({ msg, ...context }); }
}