import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductionOrder } from './production-order.entity.js';
import { Project } from './project.entity.js';
import { AssemblyNode } from './assembly-node.entity.js';
import { WorkOrder } from '../work-orders/work-order.entity.js';
import { WorkOrderStage } from '../work-orders/work-order-stage.entity.js';
import { StageEvent } from '../work-orders/stage-event.entity.js';
import { Stage } from '../stages/stage.entity.js';
import { QualityReport } from '../quality-reports/quality-report.entity.js';
import { ProductionOrderService } from './production-order.service.js';
import { ProductionOrderController } from './production-order.controller.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProductionOrder, Project, AssemblyNode, WorkOrder, WorkOrderStage, StageEvent, Stage, QualityReport]),
  ],
  controllers: [ProductionOrderController],
  providers: [ProductionOrderService],
  exports: [ProductionOrderService],
})
export class ProductionOrdersModule {}
