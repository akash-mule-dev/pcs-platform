import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConversionJob } from './conversion-job.entity.js';
import { ConversionController } from './conversion.controller.js';
import { ConversionService } from './conversion.service.js';
import { ConversionProcessor } from './conversion.processor.js';
import { ImportConversionLinkService } from './import-conversion-link.service.js';
import { ImportFile } from '../projects/import-file.entity.js';
import { ImportFileEvent } from '../projects/import-file-event.entity.js';
import { AssemblyNode } from '../projects/assembly-node.entity.js';
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
    // Projects entities are referenced entity-only (no module import → no cycle):
    // the processor mirrors job progress onto the import pipeline rows.
    TypeOrmModule.forFeature([ConversionJob, ImportFile, ImportFileEvent, AssemblyNode]),
    StorageModule,
    WebsocketModule,
    ModelsModule,
    CadConversionModule,
  ],
  controllers: [ConversionController],
  providers: [
    ConversionService,
    ConversionProcessor,
    ImportConversionLinkService,
    MeshConverter,
    GlbOptimizer,
    conversionQueueProvider,
  ],
  exports: [ConversionService, ConversionProcessor],
})
export class ConversionModule {}
