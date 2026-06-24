import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AlertsService } from './alerts.service.js';
import { AlertsCronController } from './alerts-cron.controller.js';
import { WorkOrder } from '../work-orders/work-order.entity.js';
import { TimeEntry } from '../time-tracking/time-entry.entity.js';
import { User } from '../auth/entities/user.entity.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([WorkOrder, TimeEntry, User]),
    NotificationsModule,
  ],
  // The Vercel-Cron entrypoints are always registered; on an always-on host the
  // in-process @Cron jobs in AlertsService fire instead (the endpoints simply go
  // unused, and are CRON_SECRET-gated regardless). See AlertsCronController.
  controllers: [AlertsCronController],
  providers: [AlertsService],
  exports: [AlertsService],
})
export class AlertsModule {}
