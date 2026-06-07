import { Logger } from '@nestjs/common';
import { Queue, type ConnectionOptions } from 'bullmq';
import IORedis from 'ioredis';
import type { ConversionQueue } from './conversion-queue.interface.js';

/**
 * Durable queue driver backed by Redis (BullMQ). The API process is a producer
 * only; jobs are consumed by the separate worker process (npm run worker).
 */
export class BullMqConversionQueue implements ConversionQueue {
  private readonly logger = new Logger(BullMqConversionQueue.name);
  private readonly connection: IORedis;
  private readonly queue: Queue;

  constructor(redisUrl: string, queueName: string) {
    this.connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue(queueName, {
      connection: this.connection as unknown as ConnectionOptions,
    });
    this.logger.log(`BullMQ queue '${queueName}' ready (producer)`);
  }

  async enqueue(jobId: string): Promise<void> {
    await this.queue.add(
      'convert',
      { jobId },
      {
        jobId, // dedupe: one BullMQ job per conversion id
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    );
  }

  async close(): Promise<void> {
    await this.queue.close();
    await this.connection.quit();
  }
}
