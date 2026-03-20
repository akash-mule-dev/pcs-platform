import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DashboardService } from './dashboard.service.js';
import { DashboardController } from './dashboard.controller.js';
import { MemoryCacheInterceptor } from '../common/interceptors/cache.interceptor.js';
import { WorkOrder } from '../work-orders/work-order.entity.js';
import { WorkOrderStage } from '../work-orders/work-order-stage.entity.js';
import { TimeEntry } from '../time-tracking/time-entry.entity.js';
import { QualityData } from '../quality-data/quality-data.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([WorkOrder, WorkOrderStage, TimeEntry, QualityData])],
  controllers: [DashboardController],
  providers: [DashboardService, MemoryCacheInterceptor],
  exports: [DashboardService],
})
export class DashboardModule {}
