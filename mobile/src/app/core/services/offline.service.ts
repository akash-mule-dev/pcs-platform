import { Injectable } from '@angular/core';
import { Storage } from '@ionic/storage-angular';
import { BehaviorSubject } from 'rxjs';
import { ApiService } from './api.service';

interface PendingAction {
  id: string;
  type: 'clock-in' | 'clock-out';
  payload: any;
  timestamp: number;
}

@Injectable({ providedIn: 'root' })
export class OfflineService {
  private isOnlineSubject = new BehaviorSubject<boolean>(navigator.onLine);
  isOnline$ = this.isOnlineSubject.asObservable();
  private pendingActions: PendingAction[] = [];
  private syncing = false;

  constructor(private storage: Storage, private api: ApiService) {
    this.init();
    window.addEventListener('online', () => {
      this.isOnlineSubject.next(true);
      this.syncPendingActions();
    });
    window.addEventListener('offline', () => this.isOnlineSubject.next(false));
  }

  private async init(): Promise<void> {
    await this.storage.create();
    const stored = await this.storage.get('pending_actions');
    if (stored) this.pendingActions = stored;
    if (navigator.onLine) this.syncPendingActions();
  }

  get isOnline(): boolean {
    return this.isOnlineSubject.value;
  }

  /** Cache work orders locally for offline access */
  async cacheWorkOrders(workOrders: any[]): Promise<void> {
    await this.storage.set('cached_work_orders', workOrders);
    await this.storage.set('cached_wo_timestamp', Date.now());
  }

  async getCachedWorkOrders(): Promise<any[]> {
    return (await this.storage.get('cached_work_orders')) || [];
  }

  /** Cache time entries locally */
  async cacheTimeEntries(entries: any[]): Promise<void> {
    await this.storage.set('cached_time_entries', entries);
  }

  async getCachedTimeEntries(): Promise<any[]> {
    return (await this.storage.get('cached_time_entries')) || [];
  }

  /** Queue an action for later sync when offline */
  async queueAction(type: PendingAction['type'], payload: any): Promise<void> {
    const action: PendingAction = {
      id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      type,
      payload,
      timestamp: Date.now(),
    };
    this.pendingActions.push(action);
    await this.storage.set('pending_actions', this.pendingActions);
  }

  /** Get count of pending actions */
  get pendingCount(): number {
    return this.pendingActions.length;
  }

  /** Sync all pending actions to server */
  async syncPendingActions(): Promise<{ synced: number; failed: number }> {
    if (this.syncing || !this.isOnline || this.pendingActions.length === 0) {
      return { synced: 0, failed: 0 };
    }

    this.syncing = true;
    let synced = 0;
    let failed = 0;
    const remaining: PendingAction[] = [];

    for (const action of this.pendingActions) {
      try {
        if (action.type === 'clock-in') {
          await this.api.post('/time-tracking/clock-in', action.payload).toPromise();
        } else if (action.type === 'clock-out') {
          await this.api.post('/time-tracking/clock-out', action.payload).toPromise();
        }
        synced++;
      } catch {
        remaining.push(action);
        failed++;
      }
    }

    this.pendingActions = remaining;
    await this.storage.set('pending_actions', remaining);
    this.syncing = false;
    return { synced, failed };
  }
}
