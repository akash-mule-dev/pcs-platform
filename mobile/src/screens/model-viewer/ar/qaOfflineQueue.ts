// Offline queue for AR QA captures. The shared offline.service is hard-wired to
// time-tracking clock in/out, so QA capture gets its own lightweight queue.
//
// Two kinds of queued action:
//  - 'create':   a quality-data create (plus optional local evidence image to
//                attach once the entry exists server-side),
//  - 'evidence': an evidence upload for an entry that ALREADY exists (used when
//                the entry saved but its image upload failed — retried here).
//
// Creates carry a client-generated idempotency key (input.clientKey), so a
// replay after a network drop mid-request can never duplicate the record —
// the backend returns the already-saved row for a repeated key.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { offlineService } from '../../../services/offline.service';
import type { CreateQualityInput } from './useQualityData';
import { createQuality, uploadEvidence } from './qaApi';

const QUEUE_KEY = 'pcs_ar_qa_queue';

export interface QueuedQaAction {
  id: string;
  kind?: 'create' | 'evidence'; // legacy items have no kind → 'create'
  input?: CreateQualityInput;   // kind: create
  entryId?: string;             // kind: evidence
  evidenceUri?: string;
  queuedAt: number;
  attempts?: number;
}

let _listeners: ((count: number) => void)[] = [];
let _flushing = false;

/** RFC4122-shaped v4 uuid — crypto.randomUUID when available, Math.random fallback. */
export function uuid4(): string {
  const c: any = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c?.randomUUID) return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
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
    // Stamp the idempotency key at enqueue time so EVERY replay reuses it.
    const withKey: CreateQualityInput = { ...input, clientKey: input.clientKey ?? uuid4() };
    const action: QueuedQaAction = { id: uuid4(), kind: 'create', input: withKey, evidenceUri, queuedAt: Date.now() };
    const queue = await readQueue();
    queue.push(action);
    await writeQueue(queue);
    return action;
  },

  /** Queue an evidence upload for an entry that already exists server-side. */
  async enqueueEvidence(entryId: string, evidenceUri: string): Promise<QueuedQaAction> {
    const action: QueuedQaAction = { id: uuid4(), kind: 'evidence', entryId, evidenceUri, queuedAt: Date.now() };
    const queue = await readQueue();
    queue.push(action);
    await writeQueue(queue);
    return action;
  },

  /**
   * Replay queued actions oldest-first. Stops on the first network failure and
   * keeps that action (and the rest) for the next attempt; drops actions that
   * fail validation (4xx) so a permanently-bad record can't wedge the queue.
   * Evidence uploads retry up to 5 times before being dropped.
   */
  async flush(): Promise<{ synced: number; failed: number }> {
    if (_flushing || !offlineService.isOnline) return { synced: 0, failed: 0 };
    _flushing = true;
    try {
      const queue = await readQueue();
      let synced = 0;
      let failed = 0;
      const remaining: QueuedQaAction[] = [];

      for (let i = 0; i < queue.length; i++) {
        const action = queue[i];
        try {
          if ((action.kind ?? 'create') === 'create') {
            if (!action.input) { failed++; continue; } // malformed legacy item
            const created = await createQuality(action.input);
            if (action.evidenceUri) {
              try {
                await uploadEvidence(created.id, action.evidenceUri);
              } catch {
                // Entry saved — requeue JUST the evidence for a later retry.
                remaining.push({ id: uuid4(), kind: 'evidence', entryId: created.id, evidenceUri: action.evidenceUri, queuedAt: Date.now(), attempts: 1 });
              }
            }
          } else {
            if (!action.entryId || !action.evidenceUri) { failed++; continue; }
            await uploadEvidence(action.entryId, action.evidenceUri);
          }
          synced++;
        } catch (e) {
          const msg = e instanceof Error ? e.message : '';
          const isClientError = /HTTP 4\d\d|must be a JPEG/i.test(msg);
          if (isClientError) {
            failed++; // drop — bad record / bad image
          } else if ((action.kind ?? 'create') === 'evidence' && (action.attempts ?? 0) >= 5) {
            failed++; // evidence retried enough — give up, the entry itself is safe
          } else {
            // network/5xx: keep this and all following actions, preserve order.
            remaining.push({ ...action, attempts: (action.attempts ?? 0) + 1 }, ...queue.slice(i + 1));
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
