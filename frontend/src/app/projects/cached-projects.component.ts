import { Component, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { ModelCacheService, CachedProjectEntry } from '../core/services/model-cache.service';
import { ConfirmDialogComponent } from '../shared/components/confirm-dialog/confirm-dialog.component';

/**
 * Cached Projects — the management surface for the on-device 3D model cache.
 *
 * Project models are cached automatically when you open them (the viewer reads
 * through the cache and the workspace records the project here), so repeat views
 * never re-download the GLB. The cache lives in IndexedDB and PERSISTS ACROSS
 * LOGOUT — clearing it is an explicit action on this page.
 */
@Component({
  selector: 'app-cached-projects',
  standalone: true,
  imports: [CommonModule, RouterModule, MatIconModule, MatDialogModule],
  template: `
    <div class="cached">
      <div class="page-header">
        <div class="header-left">
          <h1 class="page-title">Cached Projects</h1>
          <p class="page-subtitle">3D models saved on this device for instant, offline viewing. They persist after you log out — clear them here whenever you like.</p>
        </div>
        <div class="header-actions">
          @if (entries().length) {
            <button class="danger-btn" (click)="clearAll()"><mat-icon>delete_sweep</mat-icon>Clear all</button>
          }
        </div>
      </div>

      @if (!available()) {
        <div class="empty-state">
          <mat-icon>cloud_off</mat-icon>
          <h3>Caching unavailable</h3>
          <p>This browser can't store models locally (private mode or storage disabled), so nothing is cached here.</p>
        </div>
      } @else {
        <!-- Storage usage -->
        <div class="usage-card">
          <div class="usage-top">
            <span class="usage-lbl"><mat-icon>sd_storage</mat-icon>On-device cache</span>
            <span class="usage-val">{{ fmtBytes(cacheBytes()) }} across {{ entries().length }} model{{ entries().length === 1 ? '' : 's' }}</span>
          </div>
          @if (quota() > 0) {
            <div class="usage-bar"><span class="usage-fill" [style.width.%]="usagePct()"></span></div>
            <div class="usage-foot">
              <span>{{ fmtBytes(usage()) }} of {{ fmtBytes(quota()) }} browser storage used</span>
              @if (persisted()) {
                <span class="persist on"><mat-icon>verified_user</mat-icon>Persistent</span>
              } @else {
                <button class="persist-btn" (click)="makePersistent()" title="Ask the browser to keep this cache from being evicted under storage pressure">
                  <mat-icon>shield</mat-icon>Make persistent
                </button>
              }
            </div>
          }
          <div class="usage-cap">Up to {{ limits.maxEntries }} models · {{ fmtBytes(limits.maxBytes) }} — the least-recently-used are evicted past that. Models refresh automatically when a project is re-processed in the pipeline.</div>
        </div>

        @if (entries().length === 0) {
          <div class="empty-state">
            <mat-icon>cloud_download</mat-icon>
            <h3>No cached projects yet</h3>
            <p>Open a project with a 3D model and it'll be saved here automatically for faster, offline viewing.</p>
            <a class="cta" routerLink="/projects"><mat-icon>foundation</mat-icon>Go to Projects</a>
          </div>
        } @else {
          <div class="cache-list">
            @for (e of entries(); track e.projectId) {
              <div class="cache-row">
                <div class="row-main" (click)="open(e)">
                  <mat-icon class="p-ico">view_in_ar</mat-icon>
                  <div class="id-text">
                    <span class="p-name">{{ e.name }}</span>
                    <span class="p-sub">
                      @if (e.projectNumber) { <span class="mono">{{ e.projectNumber }}</span> }
                      @if (e.projectNumber && e.clientName) { <span class="dotsep">·</span> }
                      @if (e.clientName) { <span>{{ e.clientName }}</span> }
                      @if (!e.projectNumber && !e.clientName) { <span class="muted">Project model</span> }
                      @if (e.modelId) { <span class="dotsep">·</span><span class="mono muted" [title]="'Model ' + e.modelId">model {{ e.modelId.slice(0, 8) }}</span> }
                    </span>
                  </div>
                  <div class="row-meta">
                    <span class="m"><mat-icon>sd_storage</mat-icon>{{ fmtBytes(e.size) }}</span>
                    @if (e.nodeCount) { <span class="m"><mat-icon>account_tree</mat-icon>{{ e.nodeCount }} items</span> }
                    <span class="m muted"><mat-icon>schedule</mat-icon>Cached {{ e.cachedAt | date:'medium' }}</span>
                  </div>
                </div>
                <div class="row-actions">
                  <button class="act refresh" [disabled]="busy().has(e.projectId)" (click)="refreshOne(e)" [title]="busy().has(e.projectId) ? 'Refreshing…' : 'Re-download this model'">
                    <mat-icon [class.spin]="busy().has(e.projectId)">refresh</mat-icon>
                  </button>
                  <button class="act open" (click)="open(e)" title="Open this project"><mat-icon>open_in_new</mat-icon></button>
                  <button class="act remove" (click)="remove(e)" title="Remove from cache"><mat-icon>delete</mat-icon></button>
                </div>
              </div>
            }
          </div>
        }
      }
    </div>
  `,
  styles: [`
    .cached { max-width: 1100px; margin: 0 auto; }
    .page-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }
    .page-title { margin: 0 0 4px; font-size: 22px; font-weight: 700; letter-spacing: -0.02em; color: var(--clay-text); }
    .page-subtitle { margin: 0; font-size: 13px; color: var(--clay-text-muted); max-width: 640px; }
    .header-actions { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
    .danger-btn {
      display: inline-flex; align-items: center; gap: 6px;
      background: var(--clay-surface); color: var(--danger-text); border: 1px solid var(--clay-border);
      border-radius: var(--clay-radius-sm); padding: 9px 16px; font-size: 13px; font-weight: 600;
      cursor: pointer; font-family: inherit; transition: all .15s;
    }
    .danger-btn:hover { border-color: var(--danger); background: var(--danger-bg); }
    .danger-btn mat-icon { font-size: 18px; width: 18px; height: 18px; }

    /* ── Storage usage card ── */
    .usage-card {
      background: var(--clay-surface); border: 1px solid var(--clay-border);
      border-radius: var(--clay-radius); padding: 14px 18px; margin-bottom: 16px; box-shadow: var(--clay-shadow-soft);
    }
    .usage-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .usage-lbl { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 600; color: var(--clay-text); }
    .usage-lbl mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--clay-primary); }
    .usage-val { font-size: 13px; color: var(--clay-text-secondary); font-family: 'Space Grotesk','Inter',sans-serif; }
    .usage-bar { height: 7px; border-radius: 999px; background: var(--clay-bg-warm); overflow: hidden; margin: 10px 0 7px; }
    .usage-fill { display: block; height: 100%; background: var(--clay-primary); border-radius: 999px; transition: width .3s; }
    .usage-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; font-size: 12px; color: var(--clay-text-muted); }
    .persist { display: inline-flex; align-items: center; gap: 5px; font-weight: 600; }
    .persist.on { color: var(--success-text); }
    .persist mat-icon, .persist-btn mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .persist-btn {
      display: inline-flex; align-items: center; gap: 5px; background: none; border: 1px solid var(--clay-border);
      border-radius: var(--clay-radius-xs); padding: 4px 10px; font-size: 12px; font-weight: 600;
      color: var(--clay-text-secondary); cursor: pointer; font-family: inherit;
    }
    .persist-btn:hover { border-color: var(--clay-primary); color: var(--clay-primary); }
    .usage-cap { margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--clay-border); font-size: 11.5px; color: var(--clay-text-muted); }

    /* ── List ── */
    .cache-list {
      background: var(--clay-surface); border: 1px solid var(--clay-border);
      border-radius: var(--clay-radius); overflow: hidden; box-shadow: var(--clay-shadow-soft);
    }
    .cache-row { display: flex; align-items: center; gap: 12px; padding: 14px 18px; border-bottom: 1px solid var(--clay-border); }
    .cache-row:last-child { border-bottom: none; }
    .cache-row:hover { background: var(--clay-surface-hover); }
    .row-main { display: flex; align-items: center; gap: 14px; flex: 1; min-width: 0; cursor: pointer; }
    .p-ico { font-size: 22px; width: 22px; height: 22px; color: var(--clay-primary); flex-shrink: 0; }
    .id-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 0 1 280px; }
    .p-name { font-weight: 600; font-size: 14px; color: var(--clay-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .p-sub { font-size: 12px; color: var(--clay-text-muted); display: flex; align-items: center; gap: 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .p-sub .mono { font-family: 'Space Grotesk', monospace; }
    .dotsep { opacity: .5; } .muted { opacity: .7; }
    .row-meta { display: flex; align-items: center; gap: 6px 16px; flex-wrap: wrap; margin-left: auto; }
    .m { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--clay-text-secondary); white-space: nowrap; }
    .m mat-icon { font-size: 14px; width: 14px; height: 14px; color: var(--clay-text-muted); }
    .m.muted { color: var(--clay-text-muted); }
    .row-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
    .act {
      width: 34px; height: 34px; border-radius: var(--clay-radius-sm); border: 1px solid var(--clay-border);
      background: var(--clay-surface); color: var(--clay-text-muted); cursor: pointer; display: flex;
      align-items: center; justify-content: center; transition: all .15s;
    }
    .act mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .act:disabled { opacity: .55; cursor: default; }
    .act.refresh:hover:not(:disabled) { border-color: var(--clay-primary); color: var(--clay-primary); background: var(--info-bg); }
    .act.open:hover { border-color: var(--clay-primary); color: var(--clay-primary); background: var(--info-bg); }
    .act.remove:hover { border-color: var(--danger); color: var(--danger-text); background: var(--danger-bg); }
    .spin { animation: cp-spin 0.8s linear infinite; }
    @keyframes cp-spin { to { transform: rotate(360deg); } }

    /* ── Empty ── */
    .empty-state {
      display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center;
      padding: 56px 20px; background: var(--clay-surface); border: 1px solid var(--clay-border);
      border-radius: var(--clay-radius); color: var(--clay-text-muted);
    }
    .empty-state mat-icon { font-size: 44px; width: 44px; height: 44px; opacity: .5; }
    .empty-state h3 { margin: 6px 0 0; color: var(--clay-text); font-size: 16px; }
    .empty-state p { margin: 0; font-size: 13px; max-width: 420px; }
    .cta {
      display: inline-flex; align-items: center; gap: 6px; margin-top: 14px; background: var(--clay-primary);
      color: #fff; padding: 10px 18px; border-radius: var(--clay-radius-sm); font-size: 13px; font-weight: 600;
      text-decoration: none;
    }
    .cta mat-icon { font-size: 18px; width: 18px; height: 18px; opacity: 1; }

    @media (max-width: 720px) {
      .row-main { flex-wrap: wrap; }
      .row-meta { margin-left: 0; width: 100%; }
    }
  `],
})
export class CachedProjectsComponent {
  private cache = inject(ModelCacheService);
  private router = inject(Router);
  private dialog = inject(MatDialog);

  readonly available = signal(this.cache.available);
  readonly entries = signal<CachedProjectEntry[]>([]);
  readonly usage = signal(0);
  readonly quota = signal(0);
  readonly persisted = signal(false);
  /** Project ids currently being re-downloaded (drives the spinner). */
  readonly busy = signal<Set<string>>(new Set());
  readonly limits = this.cache.limits;

  constructor() {
    // Reload whenever the cache changes — covers initial load plus live updates
    // from removals, clear-all, and the tenant-wide eager invalidation.
    effect(() => {
      this.cache.cachedIds();
      void this.refresh();
    });
  }

  private async refresh(): Promise<void> {
    this.entries.set(await this.cache.listProjects());
    const e = await this.cache.estimate();
    this.usage.set(e.usage);
    this.quota.set(e.quota);
    this.persisted.set(e.persisted);
  }

  async refreshOne(e: CachedProjectEntry): Promise<void> {
    if (this.busy().has(e.projectId)) return;
    this.busy.set(new Set(this.busy()).add(e.projectId));
    try {
      await this.cache.refreshProject(e.projectId);
      await this.refresh();
    } finally {
      const next = new Set(this.busy());
      next.delete(e.projectId);
      this.busy.set(next);
    }
  }

  /** Total size of the cached project models (distinct from total browser usage). */
  cacheBytes(): number {
    return this.entries().reduce((s, e) => s + (e.size ?? 0), 0);
  }

  usagePct(): number {
    const q = this.quota();
    return q > 0 ? Math.min(100, Math.round((this.usage() / q) * 100)) : 0;
  }

  open(e: CachedProjectEntry): void {
    this.router.navigate(['/projects', e.projectId]);
  }

  async remove(e: CachedProjectEntry): Promise<void> {
    await this.cache.removeProject(e.projectId);
    await this.refresh();
  }

  clearAll(): void {
    this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Clear cached models?',
        message: `All ${this.entries().length} cached project model(s) will be removed from this device (${this.fmtBytes(this.cacheBytes())}). They'll be downloaded again the next time you open them.`,
        confirmText: 'Clear cache',
      },
    }).afterClosed().subscribe(async (ok: boolean) => {
      if (ok) { await this.cache.clearAll(); await this.refresh(); }
    });
  }

  async makePersistent(): Promise<void> {
    await this.cache.requestPersistence();
    await this.refresh();
  }

  fmtBytes(n: number | null | undefined): string {
    const b = n ?? 0;
    if (b >= 1073741824) return `${(b / 1073741824).toFixed(2)} GB`;
    if (b >= 1048576) return `${(b / 1048576).toFixed(1)} MB`;
    if (b >= 1024) return `${Math.round(b / 1024)} KB`;
    return `${b} B`;
  }
}
