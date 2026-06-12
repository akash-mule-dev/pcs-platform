import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../auth/entities/user.entity.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { QualityNotifyService } from './quality-notify.service.js';

/**
 * Shared eventing for the quality modules (quality-data + quality-ncr).
 * EventsGateway comes from the global WebsocketModule; notifications from
 * NotificationsModule. References the User ENTITY only (no auth-module dep),
 * keeping the module graph acyclic.
 */
@Module({
  imports: [TypeOrmModule.forFeature([User]), NotificationsModule],
  providers: [QualityNotifyService],
  exports: [QualityNotifyService],
})
export class QualityNotifyModule {}
