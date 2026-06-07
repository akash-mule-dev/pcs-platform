import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConversionJob } from './conversion-job.entity.js';
import { ConversionController } from './conversion.controller.js';
import { ConversionService } from './conversion.service.js';
import { ConversionProcessor } from './conversion.processor.js';
import { MeshConverter } from './converters/mesh-converter.js';
import { GlbOptimizer } from './optimize/glb-optimizer.js';
import { CONVERSION_QUEUE } from './queue/conversion-queue.interface.js';
import type { ConversionQueue } from './queue/conversion-queue.interface.js';
import { InlineConversionQueue } from './queue/inline.queue.js';
import { BullMqConversionQueue } from './queue/bullmq.queue.js';
import { ModelsModule } from '../models/models.module.js';
import { CadConversionModule } from '../cad-conversion/cad-conversion.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { WebsocketModule } from '../websocket/websocket.module.js';

/**
 * Selects the queue backend at runtime, mirroring the STORAGE_TYPE pattern:
 *   - bullmq  (auto when REDIS_URL is set): durable, consumed by `npm run worker`
 *   - inline  (default): in-process, no extra infra
 */
const conversionQueueProvider = {
  provide: CONVERSION_QUEUE,
  inject: [ConversionProcessor],
  useFactory: (processor: ConversionProcessor): ConversionQueue => {
    const redisUrl = process.env.REDIS_URL;
    const driver = (process.env.CONVERSION_DRIVER || (redisUrl ? 'bullmq' : 'inline')).toLowerCase();
    if (driver === 'bullmq') {
      if (!redisUrl) throw new Error('CONVERSION_DRIVER=bullmq requires REDIS_URL to be set');
      return new BullMqConversionQueue(redisUrl, process.env.CONVERSION_QUEUE_NAME || 'pcs-conversion');
    }
    return new InlineConversionQueue(processor);
  },
};

@Module({
  imports: [
    TypeOrmModule.forFeature([ConversionJob]),
    StorageModule,
    WebsocketModule,
    ModelsModule,
    CadConversionModule,
  ],
  controllers: [ConversionController],
  providers: [
    ConversionService,
    ConversionProcessor,
    MeshConverter,
    GlbOptimizer,
    conversionQueueProvider,
  ],
  exports: [ConversionService, ConversionProcessor],
})
export class ConversionModule {}
