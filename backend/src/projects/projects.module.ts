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
import { CadConversionModule } from '../cad-conversion/cad-conversion.module.js';
import { ModelsModule } from '../models/models.module.js';
import { WorkOrdersModule } from '../work-orders/work-orders.module.js';
import { ProductsModule } from '../products/products.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Project, AssemblyNode, ImportFile]),
    CadConversionModule,
    ModelsModule,
    forwardRef(() => WorkOrdersModule),
    ProductsModule,
  ],
  controllers: [ProjectsController, ProjectImportController, ProjectWorkOrderController],
  providers: [ProjectsService, IfcImportService, WorkOrderGenService, StatusRollupService],
  exports: [ProjectsService, IfcImportService, StatusRollupService, TypeOrmModule],
})
export class ProjectsModule {}
