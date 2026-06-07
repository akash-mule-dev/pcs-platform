import { Injectable, Logger } from '@nestjs/common';
import type { ConversionQueue } from './conversion-queue.interface.js';
import { ConversionProcessor } from '../conversion.processor.js';

/**
 * In-process queue driver (default when no REDIS_URL). Runs the same processor
 * the BullMQ worker would, via setImmediate so the HTTP request returns
 * immediately. Work is not durable across restarts — use the BullMQ driver in
 * production.
 */
@Injectable()
export class InlineConversionQueue implements ConversionQueue {
  private readonly logger = new Logger(InlineConversionQueue.name);

  constructor(private readonly processor: ConversionProcessor) {}

  async enqueue(jobId: string): Promise<void> {
    this.logger.log(`Scheduling job ${jobId} (inline driver)`);
    setImmediate(() => {
      this.processor
        .process(jobId)
        .catch((e) => this.logger.error(`Inline job ${jobId} crashed: ${e?.message || e}`));
    });
  }
}
