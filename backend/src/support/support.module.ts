import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SupportTicket } from './entities/support-ticket.entity.js';
import { SupportTicketMessage } from './entities/support-ticket-message.entity.js';
import { User } from '../auth/entities/user.entity.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { SupportService } from './support.service.js';
import { SupportController } from './support.controller.js';
import { SupportDeskController } from './support-desk.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([SupportTicket, SupportTicketMessage, User]), NotificationsModule],
  controllers: [SupportController, SupportDeskController],
  providers: [SupportService],
  exports: [TypeOrmModule],
})
export class SupportModule {}
