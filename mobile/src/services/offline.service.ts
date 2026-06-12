import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { PendingAction } from '../types';
import { timeTrackingService } from './time-tracking.service';
import { api } from './api.service';

const PENDING_KEY = 'pending_actions';
const CACHED_WO_KEY = 'cached_work_orders';
const CACHED_WO_TS_KEY = 'cached_wo_timestamp';
const CACHED_TE_KEY = 'cached_time_entries';

let _isOnline = true;
let _listeners: ((online: boolean) => void)[] = [];
let _pendingListeners: ((count: number) => void)[] = [];
let _syncing = false;

function notifyOnline() {
  _listeners.forEach((cb) => cb(_isOnline));
}

async function notifyPending() {
  const count = await offlineService.getPendingCount().catch(() => 0);
  _pendingListeners.forEach((cb) => cb(count));
}

/** Network-level failure (retry later) vs a server rejection (drop — retrying won't help). */
export function isNetworkError(e: any): boolean {
  return /network|fetch|timed? ?out|abort|ECONN|socket/i.test(String(e?.message ?? e ?? ''));
}

// Initialize NetInfo listener
NetInfo.addEventListener((state: NetInfoState) => {
  const wasOffline = !_isOnline;
  _isOnline = !!state.isConnected;
  notifyOnline();
  if (wasOffline && _isOnline) {
    offlineService.syncPendingActions();
  }
});

export const offlineService = {
  get isOnline(): boolean {
    return _isOnline;
  },

  subscribeOnline(cb: (online: boolean) => void): () => void {
    _listeners.push(cb);
    return () => {
      _listeners = _listeners.filter((l) => l !== cb);
    };
  },

  async getPendingCount(): Promise<number> {
    const raw = await AsyncStorage.getItem(PENDING_KEY);
    const actions: PendingAction[] = raw ? JSON.parse(raw) : [];
    return actions.length;
  },

  async cacheWorkOrders(workOrders: any[]): Promise<void> {
    await AsyncStorage.setItem(CACHED_WO_KEY, JSON.stringify(workOrders));
    await AsyncStorage.setItem(CACHED_WO_TS_KEY, Date.now().toString());
  },

  async getCachedWorkOrders(): Promise<any[]> {
    const raw = await AsyncStorage.getItem(CACHED_WO_KEY);
    return raw ? JSON.parse(raw) : [];
  },

  async cacheTimeEntries(entries: any[]): Promise<void> {
    await AsyncStorage.setItem(CACHED_TE_KEY, JSON.stringify(entries));
  },

  async getCachedTimeEntries(): Promise<any[]> {
    const raw = await AsyncStorage.getItem(CACHED_TE_KEY);
    return raw ? JSON.parse(raw) : [];
  },

  async queueAction(type: PendingAction['type'], payload: any): Promise<void> {
    const raw = await AsyncStorage.getItem(PENDING_KEY);
    const actions: PendingAction[] = raw ? JSON.parse(raw) : [];
    const id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    actions.push({ id, type, payload, timestamp: Date.now() });
    await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(actions));
    notifyPending();
  },

  /**
   * Queue a stage update for later sync. Updates are ABSOLUTE (qtyDone /
   * status), so only the LATEST queued change per stage row matters — earlier
   * queued entries for the same wosId are coalesced away.
   */
  async queueStageUpdate(orderId: string, wosId: string, body: { qtyDone?: number; status?: string }): Promise<void> {
    const raw = await AsyncStorage.getItem(PENDING_KEY);
    const actions: PendingAction[] = raw ? JSON.parse(raw) : [];
    const kept = actions.filter((a) => !(a.type === 'stage-update' && a.payload?.wosId === wosId));
    const id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    kept.push({ id, type: 'stage-update', payload: { orderId, wosId, body }, timestamp: Date.now() });
    await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(kept));
    notifyPending();
  },

  /** Stage rows with a queued offline update (for "queued" badges). */
  async pendingStageWosIds(): Promise<Set<string>> {
    const raw = await AsyncStorage.getItem(PENDING_KEY);
    const actions: PendingAction[] = raw ? JSON.parse(raw) : [];
    return new Set(actions.filter((a) => a.type === 'stage-update').map((a) => String(a.payload?.wosId)));
  },

  /** Notifies with the queue size whenever it changes (queue / sync). */
  subscribePending(cb: (count: number) => void): () => void {
    _pendingListeners.push(cb);
    return () => {
      _pendingListeners = _pendingListeners.filter((l) => l !== cb);
    };
  },

  async syncPendingActions(): Promise<{ synced: number; failed: number }> {
    if (_syncing) return { synced: 0, failed: 0 };
    _syncing = true;
    try {
      const raw = await AsyncStorage.getItem(PENDING_KEY);
      const actions: PendingAction[] = raw ? JSON.parse(raw) : [];
      if (actions.length === 0) return { synced: 0, failed: 0 };

      let synced = 0;
      let failed = 0;
      const remaining: PendingAction[] = [];

      for (const action of actions) {
        try {
          if (action.type === 'clock-in') {
            await timeTrackingService.clockIn(action.payload.workOrderStageId, action.payload.stationId);
          } else if (action.type === 'clock-out') {
            await timeTrackingService.clockOut(action.payload.timeEntryId, action.payload.notes);
          } else {
            // Replays carry their original intent; the server records source=mobile.
            await api.patch(
              `/orders/${action.payload.orderId}/stages/${action.payload.wosId}`,
              { ...action.payload.body, source: 'mobile' },
            );
          }
          synced++;
        } catch (e) {
          // Server rejections (validation, QC gate, 404) won't succeed on retry — drop them.
          if (isNetworkError(e)) {
            failed++;
            remaining.push(action);
          } else {
            failed++;
          }
        }
      }

      await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(remaining));
      notifyPending();
      return { synced, failed };
    } finally {
      _syncing = false;
    }
  },
};
