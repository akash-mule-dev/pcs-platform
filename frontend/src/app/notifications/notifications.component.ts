import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { NotificationService, AppNotification } from '../core/services/notification.service';

@Component({
  selector: 'app-notifications',
  standalone: true,
  imports: [CommonModule, RouterModule, MatCardModule, MatIconModule, MatButtonModule, MatChipsModule],
  template: `
    <div class="notif-header">
      <h2>Notifications</h2>
      <button mat-raised-button (click)="markAllRead()">
        <mat-icon>done_all</mat-icon> Mark all read
      </button>
    </div>

    <div class="notif-list">
      @for (n of notifications; track n.id) {
        <mat-card class="notif-card" [class.unread]="!n.isRead" (click)="onNotificationClick(n)">
          <div class="notif-icon-wrap" [class]="n.priority">
            <mat-icon>{{ getIcon(n.type) }}</mat-icon>
          </div>
          <div class="notif-body">
            <div class="notif-title">{{ n.title }}</div>
            <div class="notif-message">{{ n.message }}</div>
            <div class="notif-meta">
              <span class="notif-time">{{ n.createdAt | date:'short' }}</span>
              <span class="notif-type-badge">{{ n.type.replace('_', ' ') }}</span>
            </div>
          </div>
          @if (!n.isRead) {
            <div class="unread-dot"></div>
          }
        </mat-card>
      }
      @if (notifications.length === 0) {
        <div class="empty-state">
          <mat-icon>notifications_none</mat-icon>
          <p>No notifications yet</p>
        </div>
      }
    </div>
  `,
  styles: [`
    .notif-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
    h2 { margin: 0; color: var(--clay-text); font-weight: 700; }
    .notif-list { display: flex; flex-direction: column; gap: 10px; max-width: 700px; }
    .notif-card {
      display: flex; align-items: flex-start; gap: 14px; padding: 16px !important;
      cursor: pointer; transition: all var(--clay-transition);
      border-radius: var(--clay-radius-sm) !important;
    }
    .notif-card:hover { box-shadow: var(--clay-shadow-hover) !important; transform: translateY(-1px); }
    .notif-card.unread { background: var(--clay-surface) !important; border-left: 3px solid var(--clay-accent); }
    .notif-icon-wrap {
      width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    .notif-icon-wrap.low { background: var(--success-bg); color: var(--success-text); }
    .notif-icon-wrap.medium { background: var(--warning-bg); color: var(--warning-text); }
    .notif-icon-wrap.high { background: var(--danger-bg); color: var(--danger-text); }
    .notif-icon-wrap.critical { background: var(--danger); color: white; }
    .notif-body { flex: 1; }
    .notif-title { font-weight: 600; font-size: 14px; color: var(--clay-text); }
    .notif-message { font-size: 13px; color: var(--clay-text-secondary); margin: 4px 0; }
    .notif-meta { display: flex; gap: 12px; align-items: center; }
    .notif-time { font-size: 11px; color: var(--clay-text-muted); }
    .notif-type-badge {
      font-size: 10px; padding: 2px 8px; border-radius: 8px;
      background: var(--clay-bg-warm); color: var(--clay-text-muted);
      text-transform: capitalize;
    }
    .unread-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--clay-accent); flex-shrink: 0; margin-top: 4px; }
    .empty-state {
      text-align: center; padding: 48px; color: var(--clay-text-muted);
    }
    .empty-state mat-icon { font-size: 48px; width: 48px; height: 48px; opacity: 0.3; }
  `]
})
export class NotificationsComponent implements OnInit {
  notifications: AppNotification[] = [];

  constructor(
    private notifService: NotificationService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.notifService.loadNotifications();
    this.notifService.notifications$.subscribe(n => this.notifications = n);
  }

  getIcon(type: string): string {
    const icons: Record<string, string> = {
      work_order_assigned: 'assignment_ind',
      work_order_status: 'assignment',
      work_order_overdue: 'warning',
      quality_fail: 'error',
      quality_signoff: 'verified',
      efficiency_drop: 'trending_down',
      station_idle: 'timer_off',
      shift_summary: 'summarize',
      system: 'info',
    };
    return icons[type] || 'notifications';
  }

  onNotificationClick(n: AppNotification): void {
    if (!n.isRead) {
      this.notifService.markAsRead(n.id).subscribe(() => n.isRead = true);
    }
    if (n.entityType === 'work_order' && n.entityId) {
      this.router.navigate(['/work-orders', n.entityId]);
    }
  }

  markAllRead(): void {
    this.notifService.markAllAsRead().subscribe(() => {
      this.notifications.forEach(n => n.isRead = true);
    });
  }
}
