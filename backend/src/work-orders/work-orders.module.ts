import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkOrder } from './work-order.entity.js';
import { WorkOrderStage } from './work-order-stage.entity.js';
import { Stage } from '../stages/stage.entity.js';
import { Ncr } from '../quality-ncr/entities/ncr.entity.js';
import { AssemblyNode } from '../projects/assembly-node.entity.js';
import { WorkOrdersService } from './work-orders.service.js';
import { WorkOrdersController } from './work-orders.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([WorkOrder, WorkOrderStage, Stage, Ncr, AssemblyNode])],
  controllers: [WorkOrdersController],
  providers: [WorkOrdersService],
  exports: [WorkOrdersService, TypeOrmModule],
})
export class WorkOrdersModule {}
