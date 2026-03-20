import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Notification, NotificationType, NotificationPriority } from './notification.entity.js';
import { CreateNotificationDto } from './dto/create-notification.dto.js';
import { EventsGateway } from '../websocket/events.gateway.js';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification) private readonly repo: Repository<Notification>,
    private readonly eventsGateway: EventsGateway,
  ) {}

  async create(dto: CreateNotificationDto): Promise<Notification> {
    const notification = this.repo.create(dto);
    const saved = await this.repo.save(notification);
    this.eventsGateway.emitNotification(dto.userId, saved);
    return saved;
  }

  async createForUsers(userIds: string[], data: Omit<CreateNotificationDto, 'userId'>): Promise<Notification[]> {
    const notifications = userIds.map(userId => this.repo.create({ ...data, userId }));
    const saved = await this.repo.save(notifications);
    for (const n of saved) {
      this.eventsGateway.emitNotification(n.userId, n);
    }
    return saved;
  }

  async findByUser(userId: string, unreadOnly = false): Promise<Notification[]> {
    const where: any = { userId };
    if (unreadOnly) where.isRead = false;
    return this.repo.find({ where, order: { createdAt: 'DESC' }, take: 50 });
  }

  async getUnreadCount(userId: string): Promise<number> {
    return this.repo.count({ where: { userId, isRead: false } });
  }

  async markAsRead(id: string, userId: string): Promise<void> {
    await this.repo.update({ id, userId }, { isRead: true });
  }

  async markAllAsRead(userId: string): Promise<void> {
    await this.repo.update({ userId, isRead: false }, { isRead: true });
  }

  async remove(id: string, userId: string): Promise<void> {
    await this.repo.delete({ id, userId });
  }
}
