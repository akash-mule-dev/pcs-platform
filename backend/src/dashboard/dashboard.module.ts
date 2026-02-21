import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DashboardService } from './dashboard.service.js';
import { DashboardController } from './dashboard.controller.js';
import { WorkOrder } from '../work-orders/work-order.entity.js';
import { WorkOrderStage } from '../work-orders/work-order-stage.entity.js';
import { TimeEntry } from '../time-tracking/time-entry.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([WorkOrder, WorkOrderStage, TimeEntry])],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
