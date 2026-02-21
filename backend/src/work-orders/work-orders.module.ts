import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkOrder } from './work-order.entity.js';
import { WorkOrderStage } from './work-order-stage.entity.js';
import { Stage } from '../stages/stage.entity.js';
import { WorkOrdersService } from './work-orders.service.js';
import { WorkOrdersController } from './work-orders.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([WorkOrder, WorkOrderStage, Stage])],
  controllers: [WorkOrdersController],
  providers: [WorkOrdersService],
  exports: [WorkOrdersService, TypeOrmModule],
})
export class WorkOrdersModule {}
