/**
 * Abstraction over the import-pipeline job backend, mirroring the conversion
 * module's CONVERSION_QUEUE. It decouples "an import needs processing" from
 * "where that processing runs":
 *
 *   - inline  (default, no REDIS_URL): IfcImportService keeps its in-process
 *     FIFO queue + bounded concurrency and runs the pipeline in-process. The
 *     IMPORT_QUEUE provider resolves to `null` in this mode, so the service
 *     falls back to that path — local dev and the current serverless deploy are
 *     completely unchanged.
 *   - bullmq  (REDIS_URL / CONVERSION_DRIVER=bullmq): the API process becomes a
 *     pure PRODUCER — startImport stores the source, writes the import row and
 *     enqueues the pipeline job, then returns. A separate long-running worker
 *     (npm run worker) consumes the durable queue and runs the heavy extraction
 *     + GLB conversion. This is what makes the import pipeline survive a
 *     serverless API (the function can freeze after responding; the worker
 *     finishes the job).
 *
 * This is the durable replacement for the in-memory pipelineQueue array — the
 * one weak spot that couldn't survive a restart or a stateless host.
 */
export interface ImportJobPayload {
  importFileId: string;
  organizationId: string;
  projectName: string;
}

export interface ImportQueue {
  /** Schedule an import pipeline run (idempotent by importFileId). */
  enqueue(payload: ImportJobPayload): Promise<void>;

  /** Optional graceful shutdown hook (BullMQ closes its Redis connection). */
  close?(): Promise<void>;
}

export const IMPORT_QUEUE = 'IMPORT_QUEUE';

/** Default BullMQ queue name for import-pipeline jobs (override: IMPORT_QUEUE_NAME). */
export const IMPORT_QUEUE_NAME_DEFAULT = 'pcs-import';

/**
 * Shared driver-selection logic so the import + conversion queues always agree
 * on inline-vs-bullmq (same REDIS_URL / CONVERSION_DRIVER switch).
 */
export function resolveQueueDriver(): 'inline' | 'bullmq' {
  const redisUrl = process.env.REDIS_URL;
  const driver = (process.env.CONVERSION_DRIVER || (redisUrl ? 'bullmq' : 'inline')).toLowerCase();
  return driver === 'bullmq' ? 'bullmq' : 'inline';
}
