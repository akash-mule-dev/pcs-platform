import { api } from './api.service';

export interface MNotification {
  id: string;
  title: string;
  message: string;
  type: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  isRead: boolean;
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
}

export const notificationsService = {
  list: (unreadOnly = false) =>
    api.getList<MNotification>('/notifications', unreadOnly ? { unreadOnly: 'true' } : undefined),
  unreadCount: () => api.get<{ count: number }>('/notifications/unread-count'),
  markRead: (id: string) => api.patch<{ ok: true }>(`/notifications/${id}/read`),
  markAllRead: () => api.post<{ ok: true }>('/notifications/read-all'),
};
