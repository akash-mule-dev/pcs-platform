import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Project } from './project.entity.js';
import { AssemblyNode } from './assembly-node.entity.js';
import { ImportFile } from './import-file.entity.js';
import { ProjectsService } from './projects.service.js';
import { ProjectsController } from './projects.controller.js';
import { IfcImportService } from './ifc-import.service.js';
import { ProjectImportController } from './project-import.controller.js';
import { WorkOrderGenService } from './work-order-gen.service.js';
import { StatusRollupService } from './status-rollup.service.js';
import { ProjectWorkOrderController } from './project-work-order.controller.js';
import { ProjectProgressService } from './project-progress.service.js';
import { ProjectStageService } from './project-stage.service.js';
import { ProjectModelService } from './project-model.service.js';
import { ProjectModelController } from './project-model.controller.js';
import { ModelsModule } from '../models/models.module.js';
import { ProjectQualityService } from './project-quality.service.js';
import { ProjectQualityController } from './project-quality.controller.js';
import { QualityDataModule } from '../quality-data/quality-data.module.js';
import { QualityNcrModule } from '../quality-ncr/quality-ncr.module.js';
import { WorkOrder } from '../work-orders/work-order.entity.js';
import { WorkOrdersModule } from '../work-orders/work-orders.module.js';
import { ProductsModule } from '../products/products.module.js';
import { ConversionModule } from '../conversion/conversion.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Project, AssemblyNode, ImportFile, WorkOrder]),
    forwardRef(() => WorkOrdersModule),
    ProductsModule,
    ConversionModule,
    ModelsModule,
    QualityDataModule,
    QualityNcrModule,
  ],
  controllers: [ProjectsController, ProjectImportController, ProjectWorkOrderController, ProjectModelController, ProjectQualityController],
  providers: [ProjectsService, IfcImportService, WorkOrderGenService, StatusRollupService, ProjectProgressService, ProjectStageService, ProjectModelService, ProjectQualityService],
  exports: [ProjectsService, IfcImportService, StatusRollupService, TypeOrmModule],
})
export class ProjectsModule {}
