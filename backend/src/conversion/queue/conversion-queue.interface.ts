/**
 * Abstraction over the job backend so the rest of the code is agnostic to
 * whether conversions run in-process (inline driver) or via BullMQ + a separate
 * worker (Redis driver). Mirrors the STORAGE_PROVIDER pattern.
 */
export interface ConversionQueue {
  /** Schedule a persisted job (by id) for processing. */
  enqueue(jobId: string): Promise<void>;

  /** Optional graceful shutdown hook (BullMQ closes its Redis connection). */
  close?(): Promise<void>;
}

export const CONVERSION_QUEUE = 'CONVERSION_QUEUE';
