/**
 * Standalone BullMQ worker entrypoint.
 *
 *   Build:  npm run build
 *   Run:    REDIS_URL=redis://... node dist/conversion/worker.js
 *   (dev):  npm run worker:dev
 *
 * Boots the Nest application context (DB, storage, converters) and consumes
 * BOTH pipeline queues:
 *   - 'pcs-import'     → the IFC/CAD import pipeline (extract structure + persist
 *                        the assembly tree, then enqueue the GLB conversion)
 *   - 'pcs-conversion' → the GLB conversion + optimization
 * Deploy as a long-running process/container alongside the (serverless) API;
 * this is the persistent compute that the heavy, spawn-based pipeline needs.
 * Scale horizontally for throughput.
 */
import 'dotenv/config'; // load backend/.env for local runs (the API's main.ts does the same); on a host, env comes from the platform
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { Worker, type ConnectionOptions } from 'bullmq';
import IORedis from 'ioredis';
import { AppModule } from '../app.module.js';
import { ConversionProcessor } from './conversion.processor.js';
import { IfcImportService } from '../projects/ifc-import.service.js';
import { IMPORT_QUEUE_NAME_DEFAULT } from '../projects/queue/import-queue.interface.js';

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
  const ifcImport = app.get(IfcImportService, { strict: false });

  // Separate Redis connections per worker — BullMQ workers issue blocking
  // commands, so they must not share one connection.
  const conversionConn = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  const importConn = new IORedis(redisUrl, { maxRetriesPerRequest: null });

  // 1. GLB conversion queue.
  const conversionQueueName = process.env.CONVERSION_QUEUE_NAME || 'pcs-conversion';
  const conversionConcurrency = parseInt(process.env.CONVERSION_CONCURRENCY || '2', 10);
  const conversionWorker = new Worker(
    conversionQueueName,
    async (job) => { await processor.process(job.data.jobId); },
    { connection: conversionConn as unknown as ConnectionOptions, concurrency: conversionConcurrency },
  );
  conversionWorker.on('completed', (job) => logger.log(`Conversion job ${job.id} completed`));
  conversionWorker.on('failed', (job, err) => logger.error(`Conversion job ${job?.id} failed: ${err?.message}`));

  // 2. Import pipeline queue (structure extraction + tree persist → conversion).
  const importQueueName = process.env.IMPORT_QUEUE_NAME || IMPORT_QUEUE_NAME_DEFAULT;
  const importConcurrency = parseInt(process.env.IMPORT_CONCURRENCY || process.env.IMPORT_PIPELINE_CONCURRENCY || '2', 10);
  const importWorker = new Worker(
    importQueueName,
    async (job) => { await ifcImport.runImportJob(job.data); },
    { connection: importConn as unknown as ConnectionOptions, concurrency: importConcurrency },
  );
  importWorker.on('completed', (job) => logger.log(`Import job ${job.id} completed`));
  importWorker.on('failed', (job, err) => logger.error(`Import job ${job?.id} failed: ${err?.message}`));

  logger.log(`Worker listening on '${importQueueName}' (concurrency ${importConcurrency}) + '${conversionQueueName}' (concurrency ${conversionConcurrency})`);

  const shutdown = async () => {
    logger.log('Shutting down worker...');
    await Promise.allSettled([conversionWorker.close(), importWorker.close()]);
    await Promise.allSettled([conversionConn.quit(), importConn.quit()]);
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
