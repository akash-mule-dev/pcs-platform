import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkOrder } from '../work-orders/work-order.entity.js';
import { ProductionOrder } from '../projects/production-order.entity.js';
import { Project } from '../projects/project.entity.js';
import { Organization } from '../organization/organization.entity.js';
import { CostingService } from './costing.service.js';
import { CostingController } from './costing.controller.js';
import { AuditModule } from '../audit/audit.module.js';
import { MaterialPlanningModule } from '../projects/material-planning.module.js';

/**
 * Costing rolls labor (time entries × resolved rates), material (stamped
 * ledger costs) and overhead up the WO → order → project chain. Imports
 * MaterialPlanningModule for BOM-based material estimates (acyclic — that
 * module has entity-only deps).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([WorkOrder, ProductionOrder, Project, Organization]),
    AuditModule,
    MaterialPlanningModule,
  ],
  controllers: [CostingController],
  providers: [CostingService],
  exports: [CostingService],
})
export class CostingModule {}
