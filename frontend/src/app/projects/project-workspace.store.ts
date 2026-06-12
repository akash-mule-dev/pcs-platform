import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpEventType } from '@angular/common/http';
import { environment } from '../../environments/environment';
import {
  ProjectsService, Project, AssemblyNode, ProjectProgress, ProjectQualitySummary,
} from '../core/services/projects.service';

/**
 * Per-project workspace state, shared by the workspace shell (sticky header +
 * live stat strip) and every tab (Overview / Assemblies / Progress / Shipping /
 * Quality). Provided at the `projects/:id` route level, so one instance is
 * scoped to the open project and survives tab switches but resets when the
 * project changes. Centralising loads here keeps the header live as a tab acts
 * (generate work orders → progress + status update everywhere at once).
 */
@Injectable()
export class ProjectWorkspaceStore {
  private svc = inject(ProjectsService);

  readonly id = signal<string>('');
  readonly project = signal<Project | null>(null);
  readonly nodes = signal<AssemblyNode[]>([]);
  readonly progress = signal<ProjectProgress | null>(null);
  readonly quality = signal<ProjectQualitySummary | null>(null);
  readonly ordersCount = signal<number>(0);
  readonly processes = signal<{ id: string; name: string }[]>([]);
  readonly loading = signal<boolean>(true);
  readonly notFound = signal<boolean>(false);

  // IFC import (driven from the header or the Assemblies empty-state).
  readonly importing = signal<boolean>(false);
  readonly uploadProgress = signal<number>(0);
  readonly importError = signal<string | null>(null);

  // GLB conversion: true while a model is still building in the background.
  readonly modelPending = signal<boolean>(false);
  private pollTimer: any = null;

  // ── Derived (shared) ──────────────────────────────────────────────────────
  readonly hasNodes = computed(() => this.nodes().length > 0);
  readonly hasModel = computed(() => this.nodes().some((n) => n.modelId));
  readonly fullModelUrl = computed(() => {
    const withModel = this.nodes().find((n) => n.modelId);
    return withModel?.modelId ? `${environment.apiUrl}/models/${withModel.modelId}/file` : null;
  });
  readonly openNcr = computed(() => this.quality()?.totals?.openNcr ?? 0);

  /** Point the store at a project; resets and reloads when the id changes. */
  init(id: string): void {
    if (this.id() === id) {
      if (!this.project() && !this.loading()) this.reload();
      return;
    }
    this.id.set(id);
    this.project.set(null);
    this.nodes.set([]);
    this.progress.set(null);
    this.quality.set(null);
    this.ordersCount.set(0);
    this.notFound.set(false);
    this.stopPoll();
    this.loadProcesses();
    this.reload();
  }

  /** Link any finished background GLBs, then refetch everything. */
  reload(): void {
    const id = this.id();
    if (!id) return;
    this.loading.set(true);
    this.svc.resolveModels(id).subscribe({
      next: (r) => {
        this.modelPending.set((r?.pending ?? 0) > 0);
        if (this.modelPending()) this.startPoll();
        this.fetchAll();
      },
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

  /** Upload an IFC and rebuild the tree; progress is exposed via signals. */
  importIfc(file: File): void {
    const id = this.id();
    this.importError.set(null);
    this.importing.set(true);
    this.uploadProgress.set(0);
    this.svc.importIfc(id, file).subscribe({
      next: (ev) => {
        if (ev.type === HttpEventType.UploadProgress && ev.total) {
          this.uploadProgress.set(Math.round((100 * ev.loaded) / ev.total));
        } else if (ev.type === HttpEventType.Response) {
          this.importing.set(false);
          this.reload();
        }
      },
      error: (e) => {
        this.importing.set(false);
        this.importError.set(e?.error?.message || 'Import failed — the file may not be a valid IFC.');
      },
    });
  }

  private startPoll(): void {
    if (this.pollTimer) return;
    let tries = 0;
    this.pollTimer = setInterval(() => {
      tries++;
      this.svc.resolveModels(this.id()).subscribe({
        next: (r) => {
          this.modelPending.set((r?.pending ?? 0) > 0);
          if ((r?.linked ?? 0) > 0) this.refreshNodes();
          if (!this.modelPending() || tries >= 20) this.stopPoll();
        },
        error: () => this.stopPoll(),
      });
    }, 6000);
  }

  stopPoll(): void {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
  }
}
