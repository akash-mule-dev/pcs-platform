import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AlertsService } from './alerts.service.js';
import { WorkOrder } from '../work-orders/work-order.entity.js';
import { TimeEntry } from '../time-tracking/time-entry.entity.js';
import { User } from '../auth/entities/user.entity.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([WorkOrder, TimeEntry, User]),
    NotificationsModule,
  ],
  providers: [AlertsService],
  exports: [AlertsService],
})
export class AlertsModule {}
