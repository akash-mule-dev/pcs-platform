import { useCallback, useEffect, useRef, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { projectsService, MImport, MImportProgress, isActiveImport } from '../services/projects.service';
import { socketService } from '../services/socket.service';
import { useSocketEvent } from './useSocketEvent';

/**
 * Live view of one project's import pipeline. Loads the import history, joins the
 * project's realtime room and merges `import:progress` events into the rows, and
 * polls every few seconds while anything is still active — the polling is the
 * resilient floor (it also covers the Ably transport, where the room-scoped event
 * isn't delivered). Returns the rows plus a manual refresh.
 */
export function useProjectImports(projectId: string) {
  const [imports, setImports] = useState<MImport[]>([]);
  const [loading, setLoading] = useState(true);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      setImports(await projectsService.getImports(projectId));
    } catch {
      /* keep last-known rows on a transient failure */
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  // Debounced reload — used when a progress event references a row we don't have
  // yet (a brand-new upload), so it appears without spamming the list endpoint.
  const reloadSoon = useCallback(() => {
    if (reloadTimer.current) return;
    reloadTimer.current = setTimeout(() => {
      reloadTimer.current = null;
      load();
    }, 600);
  }, [load]);

  // Join the project room for the lifetime of the screen.
  useEffect(() => {
    socketService.joinProject(projectId);
    return () => {
      socketService.leaveProject(projectId);
      if (reloadTimer.current) {
        clearTimeout(reloadTimer.current);
        reloadTimer.current = null;
      }
    };
  }, [projectId]);

  useSocketEvent('import:progress', (p: MImportProgress) => {
    if (!p || p.projectId !== projectId) return;
    const terminal = p.status === 'completed' || p.status === 'failed';
    setImports((prev) => {
      const idx = prev.findIndex((r) => r.id === p.importFileId);
      if (idx === -1) {
        reloadSoon();
        return prev;
      }
      const cur = prev[idx];
      // Drop stale/out-of-order frames (a slow poll may already have advanced the
      // row further) — never move backwards unless we're settling to a terminal state.
      if (!terminal && p.progress < (cur.progress ?? 0)) return prev;
      const next = [...prev];
      next[idx] = {
        ...cur,
        status: p.status,
        stage: p.stage,
        progress: Math.max(p.progress, cur.progress ?? 0),
        // Don't let an early-stage frame blank fields a later one already populated.
        nodeCount: p.nodeCount || cur.nodeCount,
        modelId: p.modelId ?? cur.modelId,
        conversionJobId: p.conversionJobId ?? cur.conversionJobId,
        error: p.error,
      };
      return next;
    });
    // The push payload lacks finishedAt/durationMs/format/size — reconcile from the
    // server once the pipeline settles so the history row isn't left half-filled.
    if (terminal) reloadSoon();
  });

  useEffect(() => {
    load();
  }, [load]);

  const isFocused = useIsFocused();
  const activeImports = imports.filter(isActiveImport);
  const activeCount = activeImports.length;

  // Fast cadence while something is mid-pipeline; torn down the moment it settles
  // or the screen loses focus.
  useEffect(() => {
    if (!isFocused || activeCount === 0) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [isFocused, activeCount, load]);

  // Baseline floor: when the transport can't push `import:progress` (Ably, or
  // before it's detected), a newly-appearing import (started on the web or by
  // another device) would otherwise never surface. Poll slowly while focused +
  // idle so it does. On Socket.IO the room push covers this, so we skip it.
  useEffect(() => {
    if (!isFocused || activeCount > 0 || socketService.importPushAvailable) return;
    const t = setInterval(load, 9000);
    return () => clearInterval(t);
  }, [isFocused, activeCount, load]);

  return { imports, activeImports, loading, refresh: load };
}
