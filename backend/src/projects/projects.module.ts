import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Project } from './project.entity.js';
import { AssemblyNode } from './assembly-node.entity.js';
import { ImportFile } from './import-file.entity.js';
import { ImportFileEvent } from './import-file-event.entity.js';
import { ProjectsService } from './projects.service.js';
import { ProjectsController } from './projects.controller.js';
import { IfcImportService } from './ifc-import.service.js';
import { ProjectImportController } from './project-import.controller.js';
import { ImportMonitorService } from './import-monitor.service.js';
import { ImportMonitorController } from './import-monitor.controller.js';
import { ProjectProgressService } from './project-progress.service.js';
import { ProjectModelService } from './project-model.service.js';
import { ProjectModelController } from './project-model.controller.js';
import { ModelsModule } from '../models/models.module.js';
import { ProjectQualityService } from './project-quality.service.js';
import { ProjectQualityController } from './project-quality.controller.js';
import { QualityDataModule } from '../quality-data/quality-data.module.js';
import { QualityNcrModule } from '../quality-ncr/quality-ncr.module.js';
import { WorkOrder } from '../work-orders/work-order.entity.js';
import { ConversionModule } from '../conversion/conversion.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Project, AssemblyNode, ImportFile, ImportFileEvent, WorkOrder]),
    ConversionModule,
    ModelsModule,
    QualityDataModule,
    QualityNcrModule,
  ],
  controllers: [ProjectsController, ProjectImportController, ImportMonitorController, ProjectModelController, ProjectQualityController],
  providers: [ProjectsService, IfcImportService, ImportMonitorService, ProjectProgressService, ProjectModelService, ProjectQualityService],
  exports: [ProjectsService, IfcImportService, TypeOrmModule],
})
export class ProjectsModule {}
