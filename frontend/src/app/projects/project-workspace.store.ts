import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import { HttpEventType } from '@angular/common/http';
import { Subscription } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  ProjectsService, Project, AssemblyNode, ProjectProgress, ProjectQualitySummary,
  ImportFileRow, ImportProgressEvent,
} from '../core/services/projects.service';
import { RealtimeService } from '../core/services/realtime.service';

/** Stages a live import walks through, in order (drives steppers/labels). */
export const IMPORT_STAGE_LABELS: Record<string, string> = {
  uploaded: 'Uploaded',
  queued: 'Queued',
  extracting: 'Extracting structure',
  persisting: 'Building assembly tree',
  converting: 'Converting 3D model',
  completed: 'Completed',
  failed: 'Failed',
};

/**
 * Per-project workspace state, shared by the workspace shell (sticky header +
 * live stat strip) and every tab (Overview / Assemblies / Orders / Monitoring).
 * Provided at the `projects/:id` route level, so one instance is scoped to the
 * open project and survives tab switches but resets when the project changes.
 *
 * Import pipeline: uploads report browser→server % via HttpEvents; once the
 * server stores the file it answers immediately and the pipeline continues in
 * the background. From there this store follows it live over the room-scoped
 * `import:progress` websocket event, with a 5s polling fallback while anything
 * is active — so progress survives socket drops and page reloads.
 */
@Injectable()
export class ProjectWorkspaceStore implements OnDestroy {
  private svc = inject(ProjectsService);
  private realtime = inject(RealtimeService);

  readonly id = signal<string>('');
  readonly project = signal<Project | null>(null);
  readonly nodes = signal<AssemblyNode[]>([]);
  readonly progress = signal<ProjectProgress | null>(null);
  readonly quality = signal<ProjectQualitySummary | null>(null);
  readonly ordersCount = signal<number>(0);
  readonly processes = signal<{ id: string; name: string }[]>([]);
  readonly loading = signal<boolean>(true);
  readonly notFound = signal<boolean>(false);

  // ── Import pipeline (upload leg + background pipeline) ────────────────────
  /** True while the browser is still pushing bytes to the server. */
  readonly importing = signal<boolean>(false);
  readonly uploadProgress = signal<number>(0);
  readonly importError = signal<string | null>(null);
  /** All imports of the project (monitoring history), newest first. */
  readonly imports = signal<ImportFileRow[]>([]);
  readonly importsLoaded = signal<boolean>(false);
  /** Last live pipeline message (e.g. "Optimizing 3D model for web & AR"). */
  readonly pipelineMessage = signal<string | null>(null);

  private wsSub?: Subscription;
  private importsPollTimer: any = null;
  private joinedProjectId: string | null = null;

  // ── Derived (shared) ──────────────────────────────────────────────────────
  readonly hasNodes = computed(() => this.nodes().length > 0);
  readonly hasModel = computed(() => this.nodes().some((n) => n.modelId));
  readonly fullModelUrl = computed(() => {
    const withModel = this.nodes().find((n) => n.modelId);
    return withModel?.modelId ? `${environment.apiUrl}/models/${withModel.modelId}/file` : null;
  });
  readonly openNcr = computed(() => this.quality()?.totals?.openNcr ?? 0);
  readonly isOverdue = computed(() => {
    const p = this.project();
    if (!p?.dueDate || p.status === 'completed' || p.status === 'archived') return false;
    return new Date(p.dueDate).getTime() < Date.now();
  });

  /** Imports still moving through the pipeline (server side). */
  readonly activeImports = computed(() =>
    this.imports().filter((i) => i.status !== 'completed' && i.status !== 'failed'));
  /** Header/pipeline bar: the upload leg, or the most recent active import. */
  readonly pipelineActive = computed(() => this.importing() || this.activeImports().length > 0);
  readonly currentImport = computed<ImportFileRow | null>(() => this.activeImports()[0] ?? null);
  readonly failedImports = computed(() => this.imports().filter((i) => i.status === 'failed').length);
  /** True while a GLB is still building (assemblies tab hint). */
  readonly modelPending = computed(() =>
    this.activeImports().some((i) => i.stage === 'converting') ||
    (this.activeImports().length > 0 && !this.hasModel()));

  /** Point the store at a project; resets and reloads when the id changes. */
  init(id: string): void {
    if (this.id() === id) {
      if (!this.project() && !this.loading()) this.reload();
      return;
    }
    this.leaveProjectRoom();
    this.id.set(id);
    this.project.set(null);
    this.nodes.set([]);
    this.progress.set(null);
    this.quality.set(null);
    this.ordersCount.set(0);
    this.notFound.set(false);
    this.imports.set([]);
    this.importsLoaded.set(false);
    this.pipelineMessage.set(null);
    this.stopImportsPoll();
    this.joinProjectRoom(id);
    this.loadProcesses();
    this.reload();
  }

  /** Heal any finished background GLBs, then refetch everything. */
  reload(): void {
    const id = this.id();
    if (!id) return;
    this.loading.set(true);
    this.svc.resolveModels(id).subscribe({
      next: () => this.fetchAll(),
      error: () => this.fetchAll(),
    });
  }

  private fetchAll(): void {
    const id = this.id();
    this.svc.get(id).subscribe({
      next: (p) => { this.project.set(p); },
      error: () => { this.project.set(null); this.notFound.set(true); this.loading.set(false); },
    });
    this.svc.nodes(id).subscribe({
      next: (n) => { this.nodes.set(n); this.loading.set(false); },
      error: () => { this.loading.set(false); },
    });
    this.refreshProgress();
    this.refreshQuality();
    this.refreshOrders();
    this.refreshImports();
  }

  refreshProgress(): void {
    this.svc.getProgress(this.id()).subscribe({ next: (g) => this.progress.set(g), error: () => {} });
  }
  refreshQuality(): void {
    this.svc.qualitySummary(this.id()).subscribe({ next: (q) => this.quality.set(q), error: () => {} });
  }
  refreshNodes(): void {
    this.svc.nodes(this.id()).subscribe({ next: (n) => this.nodes.set(n), error: () => {} });
  }
  /** Production work orders (customer runs) — drives the header count and tab badge. */
  refreshOrders(): void {
    this.svc.listOrders(this.id()).subscribe({ next: (o) => this.ordersCount.set(o?.length ?? 0), error: () => {} });
  }
  loadProcesses(): void {
    this.svc.listProcesses().subscribe({ next: (p) => this.processes.set(p), error: () => {} });
  }
  setProject(p: Project): void { this.project.set(p); }

  /** Import history + live states; (re)arms the polling fallback while active. */
  refreshImports(): void {
    const id = this.id();
    if (!id) return;
    this.svc.imports(id).subscribe({
      next: (rows) => {
        this.imports.set(rows ?? []);
        this.importsLoaded.set(true);
        if (this.activeImports().length > 0) this.startImportsPoll(); else this.stopImportsPoll();
      },
      error: () => { this.importsLoaded.set(true); },
    });
  }

  /**
   * Upload an IFC. Browser→server progress via HttpEvents; the response
   * arrives as soon as the file is stored — the pipeline then reports itself
   * through the websocket / polling.
   */
  importIfc(file: File): void {
    this.importError.set(null);
    this.importing.set(true);
    this.uploadProgress.set(0);
    this.pipelineMessage.set(null);
    this.svc.importIfc(this.id(), file).subscribe({
      next: (ev) => {
        if (ev.type === HttpEventType.UploadProgress && ev.total) {
          this.uploadProgress.set(Math.round((100 * ev.loaded) / ev.total));
        } else if (ev.type === HttpEventType.Response) {
          this.importing.set(false);
          this.pipelineMessage.set('File stored — processing started');
          this.refreshImports(); // pulls the new row; ws/poll take it from here
        }
      },
      error: (e) => {
        this.importing.set(false);
        this.importError.set(e?.error?.message || 'Upload failed — the file could not be stored.');
        this.refreshImports();
      },
    });
  }

  /** Retry a failed import from the monitoring tab. */
  retryImport(importId: string): void {
    this.svc.retryImport(this.id(), importId).subscribe({
      next: () => this.refreshImports(),
      error: (e) => this.importError.set(e?.error?.message || 'Retry failed'),
    });
  }

  // ── Live pipeline feed ────────────────────────────────────────────────────

  private joinProjectRoom(id: string): void {
    if (!id) return;
    this.joinedProjectId = id;
    this.realtime.joinRoom('join-project', id);
    this.wsSub?.unsubscribe();
    this.wsSub = this.realtime.on<ImportProgressEvent>('import:progress').subscribe((ev) => {
      if (!ev || ev.projectId !== this.id()) return;
      this.applyImportEvent(ev);
    });
  }

  private leaveProjectRoom(): void {
    if (this.joinedProjectId) {
      this.realtime.leaveRoom('join-project', 'leave-project', this.joinedProjectId);
      this.joinedProjectId = null;
    }
    this.wsSub?.unsubscribe();
    this.wsSub = undefined;
  }

  /** Merge a live event into the imports list + trigger the right refreshes. */
  private applyImportEvent(ev: ImportProgressEvent): void {
    const rows = this.imports();
    const idx = rows.findIndex((r) => r.id === ev.importFileId);
    if (idx === -1) { this.refreshImports(); return; } // new upload from another client
    const prev = rows[idx];
    const next: ImportFileRow = {
      ...prev,
      status: ev.status,
      stage: ev.stage,
      progress: ev.progress,
      nodeCount: ev.nodeCount ?? prev.nodeCount,
      modelId: ev.modelId ?? prev.modelId,
      conversionJobId: ev.conversionJobId ?? prev.conversionJobId,
      error: ev.error ?? null,
    };
    const copy = [...rows];
    copy[idx] = next;
    this.imports.set(copy);
    if (ev.message) this.pipelineMessage.set(ev.message);

    // Structure became available → show the tree without waiting for the GLB.
    const treeReady = prev.nodeCount === 0 && (ev.nodeCount ?? 0) > 0;
    const justFinished = prev.status !== ev.status && (ev.status === 'completed' || ev.status === 'failed');
    if (treeReady || (ev.stage === 'converting' && prev.stage !== 'converting')) {
      this.refreshNodes();
      this.refreshProgress();
    }
    if (justFinished) {
      this.refreshNodes(); // modelId now stamped on the tree (or final failure)
      this.refreshProgress();
      if (this.activeImports().length === 0) this.stopImportsPoll();
    }
  }

  /** Fallback while imports are active: keeps progress moving if the socket drops. */
  private startImportsPoll(): void {
    if (this.importsPollTimer) return;
    this.importsPollTimer = setInterval(() => {
      const hadModel = this.hasModel();
      this.svc.imports(this.id()).subscribe({
        next: (rows) => {
          this.imports.set(rows ?? []);
          if (this.activeImports().length === 0) {
            this.stopImportsPoll();
            this.refreshNodes();
            this.refreshProgress();
          } else if (!hadModel && rows?.some((r) => r.modelId)) {
            this.refreshNodes();
          }
        },
        error: () => {},
      });
    }, 5000);
  }

  private stopImportsPoll(): void {
    if (this.importsPollTimer) { clearInterval(this.importsPollTimer); this.importsPollTimer = null; }
  }

  /** Kept for templates/components that called the old poll API. */
  stopPoll(): void { this.stopImportsPoll(); }

  ngOnDestroy(): void {
    this.leaveProjectRoom();
    this.stopImportsPoll();
  }
}
