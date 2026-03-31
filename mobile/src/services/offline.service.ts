import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { PendingAction } from '../types';
import { timeTrackingService } from './time-tracking.service';

const PENDING_KEY = 'pending_actions';
const CACHED_WO_KEY = 'cached_work_orders';
const CACHED_WO_TS_KEY = 'cached_wo_timestamp';
const CACHED_TE_KEY = 'cached_time_entries';

let _isOnline = true;
let _listeners: ((online: boolean) => void)[] = [];

function notifyOnline() {
  _listeners.forEach((cb) => cb(_isOnline));
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

  async queueAction(type: 'clock-in' | 'clock-out', payload: any): Promise<void> {
    const raw = await AsyncStorage.getItem(PENDING_KEY);
    const actions: PendingAction[] = raw ? JSON.parse(raw) : [];
    const id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    actions.push({ id, type, payload, timestamp: Date.now() });
    await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(actions));
  },

  async syncPendingActions(): Promise<{ synced: number; failed: number }> {
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
        } else {
          await timeTrackingService.clockOut(action.payload.timeEntryId, action.payload.notes);
        }
        synced++;
      } catch {
        failed++;
        remaining.push(action);
      }
    }

    await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(remaining));
    return { synced, failed };
  },
};
