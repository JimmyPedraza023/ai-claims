export type JobKind = 'analizar_documento' | 'clasificar_reclamacion' | 'evaluar_completitud';

export interface ClaimedJob {
  id: number;
  kind: JobKind;
  claimId: string;
  documentId: string | null;
  /** Ya incluye este intento: la primera vez vale 1. */
  attempts: number;
  maxAttempts: number;
}

/** Lo que el runner necesita de la cola. Sin Nest ni base de datos: se prueba con una cola falsa. */
export interface JobQueue {
  claimNext(workerId: string): Promise<ClaimedJob | null>;
  /** false si el trabajo ya no es de este worker (venció su lease y lo tomó otro). */
  complete(jobId: number, workerId: string): Promise<boolean>;
  /** Devuelve el estado resultante, o null si el trabajo ya no es de este worker. */
  retryLater(jobId: number, workerId: string, error: string, delaySeconds: number): Promise<'pendiente' | 'fallido' | null>;
  failPermanently(jobId: number, workerId: string, error: string): Promise<boolean>;
  /** Marca como fallidos los trabajos abandonados que ya agotaron sus intentos. Devuelve cuántos. */
  sweep(): Promise<number>;
}