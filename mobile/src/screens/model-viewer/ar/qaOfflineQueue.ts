// Offline queue for AR QA captures. The shared offline.service is hard-wired to
// time-tracking clock in/out, so QA capture gets its own lightweight queue.
//
// A queued action is a quality-data create plus an optional local evidence image
// to attach once the entry exists server-side. On reconnect we replay each:
// create the entry, then upload its evidence — so the create→attach link that
// can't happen offline (the entry id doesn't exist yet) is deferred intact.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { offlineService } from '../../../services/offline.service';
import type { CreateQualityInput } from './useQualityData';
import { createQuality, uploadEvidence } from './qaApi';

const QUEUE_KEY = 'pcs_ar_qa_queue';

export interface QueuedQaAction {
  id: string;
  input: CreateQualityInput;
  evidenceUri?: string;
  queuedAt: number;
}

let _listeners: ((count: number) => void)[] = [];
let _flushing = false;

function genId(): string {
  return typeof crypto !== 'undefined' && (crypto as any).randomUUID
    ? (crypto as any).randomUUID()
    : `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
}

async function readQueue(): Promise<QueuedQaAction[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  return raw ? (JSON.parse(raw) as QueuedQaAction[]) : [];
}

async function writeQueue(actions: QueuedQaAction[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(actions));
  _listeners.forEach((cb) => cb(actions.length));
}

export const qaOfflineQueue = {
  subscribe(cb: (count: number) => void): () => void {
    _listeners.push(cb);
    void this.count().then(cb);
    return () => {
      _listeners = _listeners.filter((l) => l !== cb);
    };
  },

  async count(): Promise<number> {
    return (await readQueue()).length;
  },

  async enqueue(input: CreateQualityInput, evidenceUri?: string): Promise<QueuedQaAction> {
    const action: QueuedQaAction = { id: genId(), input, evidenceUri, queuedAt: Date.now() };
    const queue = await readQueue();
    queue.push(action);
    await writeQueue(queue);
    return action;
  },

  /**
   * Replay queued actions oldest-first. Stops on the first network failure and
   * keeps that action (and the rest) for the next attempt; drops actions that
   * fail validation (4xx) so a permanently-bad record can't wedge the queue.
   */
  async flush(): Promise<{ synced: number; failed: number }> {
    if (_flushing || !offlineService.isOnline) return { synced: 0, failed: 0 };
    _flushing = true;
    try {
      let queue = await readQueue();
      let synced = 0;
      let failed = 0;
      const remaining: QueuedQaAction[] = [];

      for (let i = 0; i < queue.length; i++) {
        const action = queue[i];
        try {
          const created = await createQuality(action.input);
          if (action.evidenceUri) {
            try {
              await uploadEvidence(created.id, action.evidenceUri);
            } catch {
              // Entry saved; evidence can be re-attached later. Don't re-queue
              // the whole create (it already succeeded).
            }
          }
          synced++;
        } catch (e) {
          const msg = e instanceof Error ? e.message : '';
          const isClientError = /HTTP 4\d\d/.test(msg);
          if (isClientError) {
            failed++; // drop — bad record
          } else {
            // network/5xx: keep this and all following actions, preserve order
            remaining.push(...queue.slice(i));
            break;
          }
        }
      }

      await writeQueue(remaining);
      return { synced, failed };
    } finally {
      _flushing = false;
    }
  },
};

// Flush automatically when connectivity returns.
offlineService.subscribeOnline((online) => {
  if (online) void qaOfflineQueue.flush();
});
