import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable, interval, Subscription } from 'rxjs';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../../environments/environment';

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  type: string;
  priority: string;
  isRead: boolean;
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
}

@Injectable({ providedIn: 'root' })
export class NotificationService implements OnDestroy {
  private socket: Socket | null = null;
  private unreadCountSubject = new BehaviorSubject<number>(0);
  private notificationsSubject = new BehaviorSubject<AppNotification[]>([]);
  private pollSub?: Subscription;

  unreadCount$ = this.unreadCountSubject.asObservable();
  notifications$ = this.notificationsSubject.asObservable();

  constructor(private api: ApiService, private auth: AuthService) {
    this.auth.currentUser$.subscribe(user => {
      if (user) {
        this.connect(user.id);
        this.loadUnreadCount();
      } else {
        this.disconnect();
      }
    });
  }

  private connect(userId: string): void {
    if (this.socket) return;
    const wsUrl = environment.apiUrl.replace('/api', '');
    this.socket = io(wsUrl, { transports: ['websocket', 'polling'] });
    this.socket.emit('join-user', userId);

    this.socket.on('notification', (notification: AppNotification) => {
      const current = this.notificationsSubject.value;
      this.notificationsSubject.next([notification, ...current].slice(0, 50));
      this.unreadCountSubject.next(this.unreadCountSubject.value + 1);
    });

    this.socket.on('unread-count-update', () => {
      this.loadUnreadCount();
    });

    // Fallback polling every 60s
    this.pollSub = interval(60000).subscribe(() => this.loadUnreadCount());
  }

  private disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.pollSub?.unsubscribe();
    this.unreadCountSubject.next(0);
    this.notificationsSubject.next([]);
  }

  getSocket(): Socket | null {
    return this.socket;
  }

  loadNotifications(): void {
    this.api.get<AppNotification[]>('/notifications').subscribe({
      next: (data) => this.notificationsSubject.next(data || []),
    });
  }

  loadUnreadCount(): void {
    this.api.get<{ count: number }>('/notifications/unread-count').subscribe({
      next: (data) => this.unreadCountSubject.next(data.count),
    });
  }

  markAsRead(id: string): Observable<void> {
    return this.api.patch<void>(`/notifications/${id}/read`);
  }

  markAllAsRead(): Observable<void> {
    return this.api.post<void>('/notifications/read-all');
  }

  ngOnDestroy(): void {
    this.disconnect();
  }
}
