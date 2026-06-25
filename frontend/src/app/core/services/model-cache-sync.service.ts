import { Injectable, inject } from '@angular/core';
import { RealtimeService } from './realtime.service';
import { ModelCacheService } from './model-cache.service';

/**
 * Keeps the on-device model cache in sync with the import pipeline ACROSS
 * PROJECTS. Subscribes to the tenant-wide `project-model-updated` websocket
 * event (emitted on `org:<id>`, so it arrives on both the Socket.IO and Ably
 * transports). When a project is re-processed in the pipeline, its cached model
 * is now stale, so we evict it — the next time the user opens that project the
 * read-through cache re-downloads the new geometry.
 *
 * The project the user is CURRENTLY viewing is skipped: its own
 * `ProjectWorkspaceStore` re-caches it version-aware as part of the live
 * pipeline feed, and dropping it here would race/clobber that.
 *
 * Started once from the authenticated shell (LayoutComponent) so it listens for
 * the whole session; it's a no-op where IndexedDB isn't available.
 */
@Injectable({ providedIn: 'root' })
export class ModelCacheSyncService {
  private realtime = inject(RealtimeService);
  private cache = inject(ModelCacheService);
  private started = false;

  start(): void {
    if (this.started || !this.cache.available) return;
    this.started = true;
    this.realtime.on<{ projectId?: string }>('project-model-updated').subscribe((ev) => {
      const projectId = ev?.projectId;
      if (!projectId) return;
      if (projectId === this.cache.activeProjectId()) return; // kept fresh by its workspace store
      if (this.cache.isCached(projectId)) void this.cache.removeProject(projectId);
    });
  }
}
