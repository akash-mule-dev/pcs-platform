import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TimeEntry } from './time-entry.entity.js';
import { WorkOrderStage } from '../work-orders/work-order-stage.entity.js';
import { WorkOrder } from '../work-orders/work-order.entity.js';
import { User } from '../auth/entities/user.entity.js';
import { Station } from '../stations/station.entity.js';
import { Organization } from '../organization/organization.entity.js';
import { TimeTrackingService } from './time-tracking.service.js';
import { TimeTrackingController } from './time-tracking.controller.js';
import { WebsocketModule } from '../websocket/websocket.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([TimeEntry, WorkOrderStage, WorkOrder, User, Station, Organization]),
    forwardRef(() => WebsocketModule),
  ],
  controllers: [TimeTrackingController],
  providers: [TimeTrackingService],
  exports: [TimeTrackingService, TypeOrmModule],
})
export class TimeTrackingModule {}
