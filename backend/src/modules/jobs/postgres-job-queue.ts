import type { Queryable } from '../../database/queryable';
import type { ClaimedJob, JobKind, JobQueue } from './job-queue';
import type { JobsRepository } from './jobs.repository';

/** Conecta el runner con la base de datos. Sin transacciones: cada operación se confirma sola. */
export class PostgresJobQueue implements JobQueue {
  constructor(
    private readonly db: Queryable,
    private readonly repo: JobsRepository,
    private readonly leaseSeconds: number,
    private readonly kinds?: JobKind[],
  ) {}

  claimNext(workerId: string): Promise<ClaimedJob | null> {
    return this.repo.claimNext(this.db, workerId, { leaseSeconds: this.leaseSeconds, kinds: this.kinds });
  }
  complete(jobId: number, workerId: string) {
    return this.repo.complete(this.db, jobId, workerId);
  }
  retryLater(jobId: number, workerId: string, error: string, delaySeconds: number) {
    return this.repo.retryLater(this.db, jobId, workerId, error, delaySeconds);
  }
  failPermanently(jobId: number, workerId: string, error: string) {
    return this.repo.failPermanently(this.db, jobId, workerId, error);
  }
  sweep() {
    return this.repo.failExhausted(this.db, { leaseSeconds: this.leaseSeconds });
  }
}