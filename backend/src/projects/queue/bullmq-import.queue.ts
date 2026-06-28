import { Logger } from '@nestjs/common';
import { Queue, type ConnectionOptions } from 'bullmq';
import IORedis from 'ioredis';
import type { ImportQueue, ImportJobPayload } from './import-queue.interface.js';

/**
 * Durable import-pipeline queue backed by Redis (BullMQ). The API process is a
 * producer only; jobs are consumed by the standalone worker (npm run worker),
 * which runs the extraction + GLB conversion on a long-running host. Mirrors
 * BullMqConversionQueue so both pipeline stages share one Redis + driver switch.
 */
export class BullMqImportQueue implements ImportQueue {
  private readonly logger = new Logger(BullMqImportQueue.name);
  private readonly connection: IORedis;
  private readonly queue: Queue;

  constructor(redisUrl: string, queueName: string) {
    // Producer (non-blocking) connection. Bound connect + command time so a
    // Redis outage makes enqueue() FAIL FAST instead of hanging the serverless
    // import request indefinitely (the source is already stored durably, so a
    // thrown enqueue surfaces a clear, retryable failure — see dispatchPipeline).
    this.connection = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      connectTimeout: 10_000,
      commandTimeout: 10_000,
    });
    this.connection.on('error', (e) => this.logger.warn(`Redis (import queue) error: ${e.message}`));
    this.queue = new Queue(queueName, {
      connection: this.connection as unknown as ConnectionOptions,
    });
    this.logger.log(`BullMQ import queue '${queueName}' ready (producer)`);
  }

  async enqueue(payload: ImportJobPayload): Promise<void> {
    await this.queue.add('run', payload, {
      jobId: payload.importFileId, // dedupe: one BullMQ job per import (safe to re-enqueue on recovery)
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    });
  }

  async close(): Promise<void> {
    await this.queue.close();
    await this.connection.quit();
  }
}
