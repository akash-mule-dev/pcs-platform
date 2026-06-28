import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Project } from './project.entity.js';
import { AssemblyNode } from './assembly-node.entity.js';
import { ImportFile } from './import-file.entity.js';
import { ImportFileEvent } from './import-file-event.entity.js';
import { ProjectsService } from './projects.service.js';
import { ProjectsController } from './projects.controller.js';
import { ProjectPurgeService } from './project-purge.service.js';
import { ProjectCronController } from './project-cron.controller.js';
import { IfcImportService } from './ifc-import.service.js';
import { ProjectImportController } from './project-import.controller.js';
import { ImportMonitorService } from './import-monitor.service.js';
import { ImportMonitorController } from './import-monitor.controller.js';
import { AssemblyDocument } from './assembly-document.entity.js';
import { PieceLotAssignment } from './piece-lot-assignment.entity.js';
import { ProjectInsightsService } from './project-insights.service.js';
import { ProjectDocumentService } from './project-document.service.js';
import { ProjectTraceabilityService } from './project-traceability.service.js';
import { ProjectInsightsController } from './project-insights.controller.js';
import { StorageModule } from '../storage/storage.module.js';
import { ProjectProgressService } from './project-progress.service.js';
import { ProjectModelService } from './project-model.service.js';
import { ProjectModelController } from './project-model.controller.js';
import { ModelsModule } from '../models/models.module.js';
import { ProjectQualityService } from './project-quality.service.js';
import { ProjectQualityController } from './project-quality.controller.js';
import { QualityDataModule } from '../quality-data/quality-data.module.js';
import { QualityReport } from '../quality-reports/quality-report.entity.js';
import { WorkOrder } from '../work-orders/work-order.entity.js';
import { ConversionModule } from '../conversion/conversion.module.js';
import { IMPORT_QUEUE, IMPORT_QUEUE_NAME_DEFAULT, resolveQueueDriver } from './queue/import-queue.interface.js';
import type { ImportQueue } from './queue/import-queue.interface.js';
import { BullMqImportQueue } from './queue/bullmq-import.queue.js';

/**
 * Selects the import-pipeline backend at runtime (same switch as the conversion
 * queue, so they always agree):
 *   - bullmq (REDIS_URL set): the API is a pure producer; the standalone worker
 *     runs the heavy pipeline — this is what lets import survive a serverless API.
 *   - inline (default): resolves to null, so IfcImportService keeps its existing
 *     in-process FIFO queue. Local dev + the current deploy are unchanged.
 */
const importQueueProvider = {
  provide: IMPORT_QUEUE,
  useFactory: (): ImportQueue | null => {
    if (resolveQueueDriver() !== 'bullmq') return null;
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) throw new Error('CONVERSION_DRIVER=bullmq requires REDIS_URL to be set');
    return new BullMqImportQueue(redisUrl, process.env.IMPORT_QUEUE_NAME || IMPORT_QUEUE_NAME_DEFAULT);
  },
};

@Module({
  imports: [
    TypeOrmModule.forFeature([Project, AssemblyNode, ImportFile, ImportFileEvent, WorkOrder, AssemblyDocument, PieceLotAssignment, QualityReport]),
    ConversionModule,
    ModelsModule,
    QualityDataModule,
    StorageModule,
  ],
  controllers: [ProjectsController, ProjectCronController, ProjectImportController, ImportMonitorController, ProjectInsightsController, ProjectModelController, ProjectQualityController],
  providers: [
    ProjectsService, ProjectPurgeService, IfcImportService, ImportMonitorService, ProjectProgressService, ProjectModelService, ProjectQualityService,
    ProjectInsightsService, ProjectDocumentService, ProjectTraceabilityService,
    importQueueProvider,
  ],
  exports: [ProjectsService, IfcImportService, TypeOrmModule],
})
export class ProjectsModule {}
