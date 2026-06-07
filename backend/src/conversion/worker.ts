/**
 * Standalone BullMQ worker entrypoint.
 *
 *   Build:  npm run build
 *   Run:    REDIS_URL=redis://... node dist/conversion/worker.js
 *   (dev):  npm run worker:dev
 *
 * Boots the Nest application context (DB, storage, converters) and consumes
 * conversion jobs. Deploy as a long-running process/container alongside the
 * API; scale horizontally for throughput.
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { Worker, type ConnectionOptions } from 'bullmq';
import IORedis from 'ioredis';
import { AppModule } from '../app.module.js';
import { ConversionProcessor } from './conversion.processor.js';

async function bootstrap() {
  const logger = new Logger('ConversionWorker');

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    logger.error('REDIS_URL is required to run the conversion worker.');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const processor = app.get(ConversionProcessor, { strict: false });

  const queueName = process.env.CONVERSION_QUEUE_NAME || 'pcs-conversion';
  const concurrency = parseInt(process.env.CONVERSION_CONCURRENCY || '2', 10);
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

  const worker = new Worker(
    queueName,
    async (job) => { await processor.process(job.data.jobId); },
    { connection: connection as unknown as ConnectionOptions, concurrency },
  );

  worker.on('completed', (job) => logger.log(`Job ${job.id} completed`));
  worker.on('failed', (job, err) => logger.error(`Job ${job?.id} failed: ${err?.message}`));

  logger.log(`Conversion worker listening on '${queueName}' (concurrency ${concurrency})`);

  const shutdown = async () => {
    logger.log('Shutting down conversion worker...');
    await worker.close();
    await connection.quit();
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Conversion worker failed to start:', err);
  process.exit(1);
});
