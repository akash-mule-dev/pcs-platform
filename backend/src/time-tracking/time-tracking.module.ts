import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TimeEntry } from './time-entry.entity.js';
import { WorkOrderStage } from '../work-orders/work-order-stage.entity.js';
import { TimeTrackingService } from './time-tracking.service.js';
import { TimeTrackingController } from './time-tracking.controller.js';
import { WebsocketModule } from '../websocket/websocket.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([TimeEntry, WorkOrderStage]),
    forwardRef(() => WebsocketModule),
  ],
  controllers: [TimeTrackingController],
  providers: [TimeTrackingService],
  exports: [TimeTrackingService, TypeOrmModule],
})
export class TimeTrackingModule {}
