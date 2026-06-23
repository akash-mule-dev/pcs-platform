/**
 * Local draft persistence + offline submit queue for native QC report fill.
 *
 * - Drafts autosave to AsyncStorage so typed values survive an app kill / offline.
 * - Save/Submit while offline are queued and replayed (PATCH /quality-reports/:id)
 *   on reconnect. PATCH is idempotent by the report id (last-write-wins), so a
 *   replay never duplicates — no clientKey needed (unlike quality_data creates).
 *
 * A report must be CREATED online (server allocates the QR-YYYY-NNNN number);
 * once open, filling + submitting tolerate going offline.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../../../services/api.service';
import { offlineService, isNetworkError } from '../../../services/offline.service';

const DRAFT_PREFIX = 'pcs_qc_draft_';
const QUEUE_KEY = 'pcs_qc_sync_queue';

export interface QueuedReportSync {
  reportId: string;
  data: Record<string, any>;
  status?: 'submitted';
  queuedAt: number;
}

let _flushing = false;

async function readQueue(): Promise<QueuedReportSync[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  if (!raw) return [];
  try { return JSON.parse(raw) as QueuedReportSync[]; } catch { return []; }
}
async function writeQueue(q: QueuedReportSync[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(q));
}

export const qcDraftStore = {
  // ── local draft (autosave) ──
  async saveDraft(reportId: string, data: Record<string, any>): Promise<void> {
    await AsyncStorage.setItem(DRAFT_PREFIX + reportId, JSON.stringify({ data, at: nowSafe() }));
  },
  async getDraft(reportId: string): Promise<Record<string, any> | null> {
    const raw = await AsyncStorage.getItem(DRAFT_PREFIX + reportId);
    if (!raw) return null;
    try { return (JSON.parse(raw).data ?? null) as Record<string, any> | null; } catch { return null; }
  },
  async clearDraft(reportId: string): Promise<void> {
    await AsyncStorage.removeItem(DRAFT_PREFIX + reportId);
  },

  /**
   * Persist a save/submit. Tries the network first; on a network error (or while
   * offline) it queues for replay and the local draft is kept. Returns whether it
   * reached the server.
   */
  async persist(reportId: string, data: Record<string, any>, status?: 'submitted'): Promise<{ synced: boolean }> {
    await this.saveDraft(reportId, data);
    if (!offlineService.isOnline) {
      await this.enqueue({ reportId, data, status });
      return { synced: false };
    }
    try {
      await api.patch(`/quality-reports/${reportId}`, status ? { data, status } : { data });
      if (status === 'submitted') await this.clearDraft(reportId);
      return { synced: true };
    } catch (e) {
      if (isNetworkError(e)) {
        await this.enqueue({ reportId, data, status });
        return { synced: false };
      }
      throw e; // real server/validation error → surface it
    }
  },

  async enqueue(item: Omit<QueuedReportSync, 'queuedAt'>): Promise<void> {
    const q = await readQueue();
    // Coalesce: keep only the latest queued sync per report (last-write-wins).
    const next = q.filter((x) => x.reportId !== item.reportId);
    next.push({ ...item, queuedAt: nowSafe() });
    await writeQueue(next);
  },

  async pendingReportIds(): Promise<Set<string>> {
    return new Set((await readQueue()).map((x) => x.reportId));
  },

  /** Replay queued saves/submits oldest-first; stop at the first network failure. */
  async flush(): Promise<{ synced: number; failed: number }> {
    if (_flushing || !offlineService.isOnline) return { synced: 0, failed: 0 };
    _flushing = true;
    let synced = 0, failed = 0;
    try {
      const q = (await readQueue()).sort((a, b) => a.queuedAt - b.queuedAt);
      const keep: QueuedReportSync[] = [];
      let broke = false;
      for (const item of q) {
        if (broke) { keep.push(item); continue; } // don't attempt anything after a network break
        try {
          await api.patch(`/quality-reports/${item.reportId}`, item.status ? { data: item.data, status: item.status } : { data: item.data });
          if (item.status === 'submitted') await this.clearDraft(item.reportId);
          synced++;
        } catch (e) {
          failed++;
          if (isNetworkError(e)) { keep.push(item); broke = true; } // keep + stop; real errors drop
        }
      }
      await writeQueue(keep);
      return { synced, failed };
    } finally {
      _flushing = false;
    }
  },
};

// new Date().getTime() without argless Date() (kept testable / lint-safe).
function nowSafe(): number { return Date.now(); }

// Flush whenever connectivity returns.
offlineService.subscribeOnline((online) => { if (online) void qcDraftStore.flush(); });
