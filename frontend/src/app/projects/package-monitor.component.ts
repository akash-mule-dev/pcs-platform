import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import {
  ProjectsService, Project, ImportsMonitor, MonitorActiveRow, HistoryRow,
} from '../core/services/projects.service';
import { IMPORT_STAGE_LABELS } from './project-workspace.store';

const PAGE = 25;

/**
 * Tenant-wide Package Monitor — the live answer to "what is the pipeline doing
 * right now?" across every project of the organization.
 *
 * In progress: every package currently in the pipeline, oldest first (= the
 * actual processing order), with its queue position ("N ahead"), live stage
 * and overall %. Refreshes every 4s while anything is active.
 *
 * History: every package ever uploaded in the org — filterable by project(s),
 * sortable by upload time, paged — with status, timings and quick retry for
 * failures. Clicking a row opens that project's Monitoring tab (full
 * per-import event timeline).
 */
@Component({
  selector: 'app-package-monitor',
  standalone: true,
  imports: [CommonModule, RouterModule, MatIconModule, MatMenuModule, MatTooltipModule, MatProgressBarModule, MatProgressSpinnerModule],
  template: `
    <div class="pm">
      <div class="page-header">
        <div class="header-left">
          <h1 class="page-title">Package Monitor</h1>
          <p class="page-subtitle">Live import pipeline and upload history across all projects in your organization.</p>
        </div>
        <a class="ghost-btn" routerLink="/projects"><mat-icon>foundation</mat-icon>Projects</a>
      </div>

      <!-- KPI strip -->
      @if (monitor(); as m) {
        <div class="kpi-grid">
          <div class="kpi">
            <div class="kpi-icon tone-blue"><mat-icon>conveyor_belt</mat-icon></div>
            <div class="kpi-text"><span class="kpi-num">{{ m.kpis.processing }}</span><span class="kpi-lbl">Processing now</span></div>
          </div>
          <div class="kpi">
            <div class="kpi-icon tone-orange"><mat-icon>hourglass_top</mat-icon></div>
            <div class="kpi-text"><span class="kpi-num">{{ m.kpis.queued }}</span><span class="kpi-lbl">Waiting in queue</span></div>
          </div>
          <div class="kpi">
            <div class="kpi-icon tone-green"><mat-icon>task_alt</mat-icon></div>
            <div class="kpi-text"><span class="kpi-num">{{ m.kpis.completedToday }}<small>/{{ m.kpis.completedTotal }}</small></span><span class="kpi-lbl">Completed today / total</span></div>
          </div>
          <div class="kpi" [class.alert]="m.kpis.failedToday > 0">
            <div class="kpi-icon" [class.tone-purple]="m.kpis.failedToday === 0" [class.tone-danger]="m.kpis.failedToday > 0"><mat-icon>error_outline</mat-icon></div>
            <div class="kpi-text"><span class="kpi-num">{{ m.kpis.failedToday }}<small>/{{ m.kpis.failedTotal }}</small></span><span class="kpi-lbl">Failed today / total</span></div>
          </div>
          <div class="kpi">
            <div class="kpi-icon tone-blue"><mat-icon>inventory_2</mat-icon></div>
            <div class="kpi-text"><span class="kpi-num">{{ m.kpis.totalPackages }}</span><span class="kpi-lbl">Packages all-time</span></div>
          </div>
        </div>
      }

      <!-- Tabs -->
      <div class="seg-tabs">
        <button class="seg" [class.active]="tab() === 'live'" (click)="tab.set('live')">
          <mat-icon>monitor_heart</mat-icon> Package(s) in progress
          @if (monitor()?.kpis?.inProgress; as c) { <span class="seg-badge">{{ c }}</span> }
        </button>
        <button class="seg" [class.active]="tab() === 'history'" (click)="setTab('history')">
          <mat-icon>history</mat-icon> Package history
        </button>
      </div>

      <!-- ── In progress ──────────────────────────────────────────── -->
      @if (tab() === 'live') {
        <section class="panel">
          <p class="note">Track every package as it moves through the pipeline: <strong>queued → extracting → building tree → converting 3D → completed</strong>. Packages are processed in upload order.</p>

          @if (!loadedMonitor()) {
            <div class="empty"><mat-spinner diameter="26"></mat-spinner></div>
          } @else if ((monitor()?.active ?? []).length === 0) {
            <div class="empty">
              <mat-icon>check_circle</mat-icon>
              <h4>No packages in progress</h4>
              <p>The pipeline is idle. Upload a model or ZIP package from a project (or create a new project) and it will appear here live.</p>
            </div>
          } @else {
            @for (row of monitor()!.active; track row.id) {
              <div class="live-row">
                <div class="lr-pos" [matTooltip]="row.stage === 'queued' ? row.ahead + ' package(s) ahead of this one' : 'Being processed'">
                  @if (row.stage === 'queued') { <span class="pos-chip">{{ row.ahead }} ahead</span> }
                  @else { <mat-spinner diameter="18"></mat-spinner> }
                </div>
                <div class="lr-id">
                  <a class="lr-project" [routerLink]="['/projects', row.projectId, 'monitoring']">{{ row.projectName || 'Project' }}</a>
                  <span class="lr-file"><mat-icon>description</mat-icon>{{ row.originalName }} <em>{{ fmtBytes(row.size) }}</em></span>
                </div>
                <div class="lr-stage">
                  <span class="st st-running"><span class="st-dot"></span>{{ stageLabel(row.stage) }}</span>
                  @if (row.nodeCount > 0) { <span class="lr-nodes">{{ row.nodeCount }} nodes</span> }
                </div>
                <div class="lr-bar">
                  <mat-progress-bar mode="determinate" [value]="row.progress"></mat-progress-bar>
                  <span class="lr-pct">{{ row.progress }}%</span>
                </div>
                <div class="lr-meta">
                  <span>{{ row.createdByName || '—' }}</span>
                  <span class="muted">started {{ ago(row.startedAt || row.createdAt) }}</span>
                </div>
                <a class="lr-open" [routerLink]="['/projects', row.projectId, 'monitoring']" matTooltip="Open the project's pipeline timeline"><mat-icon>open_in_new</mat-icon></a>
              </div>
            }
          }
        </section>
      }

      <!-- ── History ─────────────────────────────────────────────── -->
      @if (tab() === 'history') {
        <section class="panel">
          <div class="hist-toolbar">
            <button class="ghost-btn" [matMenuTriggerFor]="projMenu">
              <mat-icon>filter_list</mat-icon>
              {{ filterIds().length ? filterIds().length + ' project(s)' : 'All projects' }}
            </button>
            <mat-menu #projMenu="matMenu" class="pm-menu">
              <button mat-menu-item (click)="clearFilter(); $event.stopPropagation()">
                <mat-icon>{{ filterIds().length === 0 ? 'radio_button_checked' : 'radio_button_unchecked' }}</mat-icon>All projects
              </button>
              @for (p of projects(); track p.id) {
                <button mat-menu-item (click)="toggleFilter(p.id); $event.stopPropagation()">
                  <mat-icon>{{ filterIds().includes(p.id) ? 'check_box' : 'check_box_outline_blank' }}</mat-icon>{{ p.name }}
                </button>
              }
            </mat-menu>
            <button class="ghost-btn" (click)="toggleSort()" matTooltip="Sort by upload time">
              <mat-icon>{{ sort() === 'desc' ? 'south' : 'north' }}</mat-icon>{{ sort() === 'desc' ? 'Newest first' : 'Oldest first' }}
            </button>
            <span class="spacer"></span>
            <span class="muted">{{ history().length }} of {{ historyTotal() }}</span>
            <button class="ghost-btn" (click)="reloadHistory()" matTooltip="Refresh"><mat-icon>refresh</mat-icon></button>
          </div>

          @if (!loadedHistory()) {
            <div class="empty"><mat-spinner diameter="26"></mat-spinner></div>
          } @else if (history().length === 0) {
            <div class="empty">
              <mat-icon>inbox</mat-icon>
              <h4>No packages found</h4>
              <p>Nothing has been uploaded yet{{ filterIds().length ? ' for the selected projects' : '' }}.</p>
            </div>
          } @else {
            <div class="tbl">
              <div class="tr th">
                <span>Project</span><span>File name</span><span>Status</span><span class="num">Nodes</span>
                <span>Start time</span><span>End time</span><span class="num">Duration</span><span>By</span><span></span>
              </div>
              @for (row of history(); track row.id) {
                <div class="tr" (click)="openRow(row)">
                  <span class="cell-project">{{ row.projectName || '—' }}</span>
                  <span class="fname" [matTooltip]="row.originalName"><mat-icon>description</mat-icon><span class="fname-txt">{{ row.originalName }}</span></span>
                  <span><span class="st st-{{ rowState(row) }}"><span class="st-dot"></span>{{ rowStateLabel(row) }}</span></span>
                  <span class="num">{{ row.nodeCount || '—' }}</span>
                  <span class="muted time2">{{ row.startedAt || row.createdAt | date:'dd.MM.yyyy' }}<em>{{ row.startedAt || row.createdAt | date:'HH:mm:ss' }}</em></span>
                  <span class="muted time2">
                    @if (row.finishedAt) { {{ row.finishedAt | date:'dd.MM.yyyy' }}<em>{{ row.finishedAt | date:'HH:mm:ss' }}</em> } @else { — }
                  </span>
                  <span class="num muted">{{ fmtDuration(row.durationMs) }}</span>
                  <span class="muted">{{ row.createdByName || '—' }}</span>
                  <span class="row-actions">
                    @if (row.status === 'failed') {
                      <button class="icon-btn warn" (click)="retry(row, $event)" matTooltip="Retry this import"><mat-icon>replay</mat-icon></button>
                    }
                    <mat-icon class="chev">chevron_right</mat-icon>
                  </span>
                </div>
              }
            </div>
            @if (history().length < historyTotal()) {
              <div class="more"><button class="ghost-btn" (click)="loadMore()">Load more</button></div>
            }
          }
        </section>
      }
    </div>
  `,
  styles: [`
    .pm { max-width: 1320px; margin: 0 auto; }
    .page-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 18px; flex-wrap: wrap; }
    .page-title { margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.02em; color: var(--clay-text); }
    .page-subtitle { margin: 4px 0 0; color: var(--clay-text-muted); font-size: 13.5px; }
    .muted { color: var(--clay-text-muted); font-size: 12px; font-style: normal; }
    .spacer { flex: 1; }

    /* KPIs (mirrors the projects portfolio look) */
    .kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 16px; }
    .kpi { display: flex; align-items: center; gap: 12px; background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius); padding: 14px 16px; }
    .kpi.alert { border-color: var(--danger-text); }
    .kpi-icon { width: 40px; height: 40px; border-radius: 12px; display: flex; align-items: center; justify-content: center; }
    .kpi-icon mat-icon { font-size: 22px; width: 22px; height: 22px; }
    .tone-blue { background: var(--info-bg); color: var(--info-text); }
    .tone-green { background: var(--success-bg); color: var(--success-text); }
    .tone-orange { background: var(--warning-bg); color: var(--warning-text); }
    .tone-purple { background: var(--badge-progress-bg); color: var(--badge-progress-text); }
    .tone-danger { background: var(--danger-bg); color: var(--danger-text); }
    .kpi-text { display: flex; flex-direction: column; }
    .kpi-num { font-size: 20px; font-weight: 700; color: var(--clay-text); font-family: 'Space Grotesk','Inter',sans-serif; line-height: 1.1; }
    .kpi-num small { font-size: 12px; color: var(--clay-text-muted); font-weight: 600; }
    .kpi-lbl { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: var(--clay-text-muted); }

    /* Segmented tabs */
    .seg-tabs { display: flex; gap: 8px; margin-bottom: 0; }
    .seg {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 11px 18px; font-size: 13.5px; font-weight: 700; font-family: inherit;
      border: 1px solid var(--clay-border); border-bottom: none; cursor: pointer;
      background: var(--clay-bg-warm); color: var(--clay-text-muted);
      border-radius: var(--clay-radius) var(--clay-radius) 0 0; transition: all .15s;
    }
    .seg mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .seg:hover { color: var(--clay-text); }
    .seg.active { background: var(--clay-primary); border-color: var(--clay-primary); color: #fff; }
    .seg-badge { background: rgba(255,255,255,.25); border-radius: 999px; padding: 1px 8px; font-size: 11px; font-weight: 800; }
    .seg:not(.active) .seg-badge { background: var(--info-bg); color: var(--clay-primary); }

    .panel { background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: 0 var(--clay-radius) var(--clay-radius) var(--clay-radius); overflow: hidden; }
    .note { margin: 0; padding: 12px 18px; font-size: 12.5px; color: var(--clay-text-secondary); background: var(--clay-bg-warm); border-bottom: 1px solid var(--clay-border); }

    /* Live rows */
    .live-row {
      display: grid; grid-template-columns: 92px minmax(220px, 1.6fr) 200px minmax(160px, 1.2fr) 150px 40px;
      gap: 14px; align-items: center; padding: 14px 18px; border-bottom: 1px solid var(--clay-border);
    }
    .live-row:last-child { border-bottom: none; }
    .lr-pos { display: flex; justify-content: center; }
    .pos-chip { background: var(--warning-bg); color: var(--warning-text); border-radius: 999px; padding: 3px 10px; font-size: 11.5px; font-weight: 800; white-space: nowrap; }
    .lr-id { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .lr-project { font-weight: 700; font-size: 13.5px; color: var(--clay-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .lr-file { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; color: var(--clay-text-secondary); min-width: 0; }
    .lr-file mat-icon { font-size: 15px; width: 15px; height: 15px; color: var(--clay-text-muted); flex-shrink: 0; }
    .lr-file em { font-style: normal; color: var(--clay-text-muted); flex-shrink: 0; }
    .lr-stage { display: flex; flex-direction: column; gap: 4px; align-items: flex-start; }
    .lr-nodes { font-size: 11.5px; color: var(--clay-text-muted); }
    .lr-bar { display: flex; align-items: center; gap: 10px; }
    .lr-bar mat-progress-bar { flex: 1; }
    .lr-pct { font-size: 14px; font-weight: 700; color: var(--clay-primary); font-variant-numeric: tabular-nums; min-width: 42px; text-align: right; }
    .lr-meta { display: flex; flex-direction: column; gap: 2px; font-size: 12.5px; color: var(--clay-text-secondary); }
    .lr-open { color: var(--clay-text-muted); display: flex; }
    .lr-open:hover { color: var(--clay-primary); }

    /* Status chips */
    .st { display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; padding: 2px 10px 2px 8px; font-size: 11.5px; font-weight: 700; white-space: nowrap; }
    .st-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
    .st-completed { background: var(--success-bg); color: var(--success-text); }
    .st-failed { background: var(--danger-bg); color: var(--danger-text); }
    .st-running { background: var(--info-bg); color: var(--info-text); }
    .st-running .st-dot { animation: pulse 1.2s ease-in-out infinite; }
    @keyframes pulse { 0%,100% { opacity: .35; } 50% { opacity: 1; } }

    /* History */
    .hist-toolbar { display: flex; align-items: center; gap: 10px; padding: 12px 18px; border-bottom: 1px solid var(--clay-border); flex-wrap: wrap; }
    .ghost-btn {
      display: inline-flex; align-items: center; gap: 6px;
      border: 1px solid var(--clay-border); background: var(--clay-surface);
      color: var(--clay-text-secondary); border-radius: var(--clay-radius-sm);
      padding: 7px 12px; font-size: 12.5px; font-weight: 600; cursor: pointer; font-family: inherit; transition: all .15s;
    }
    .ghost-btn mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .ghost-btn:hover { border-color: var(--clay-primary); color: var(--clay-primary); }

    .tbl { display: flex; flex-direction: column; }
    .tr {
      display: grid; grid-template-columns: minmax(150px,1.2fr) minmax(180px,1.5fr) 130px 64px 120px 120px 84px minmax(90px,.8fr) 84px;
      gap: 10px; align-items: center; padding: 10px 18px; border-bottom: 1px solid var(--clay-border);
      cursor: pointer; transition: background .12s; font-size: 13px; color: var(--clay-text);
    }
    .tr:last-child { border-bottom: none; }
    .tr:not(.th):hover { background: var(--clay-surface-hover); }
    .tr.th { cursor: default; font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--clay-text-muted); padding: 9px 18px; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .cell-project { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .fname { display: inline-flex; align-items: center; gap: 7px; min-width: 0; }
    .fname mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--clay-text-muted); flex-shrink: 0; }
    .fname-txt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .time2 { display: flex; flex-direction: column; line-height: 1.25; }
    .time2 em { font-style: normal; font-size: 11px; }
    .row-actions { display: flex; align-items: center; justify-content: flex-end; gap: 4px; }
    .icon-btn { border: none; background: none; cursor: pointer; color: var(--clay-text-muted); display: flex; padding: 4px; border-radius: 6px; }
    .icon-btn:hover { background: var(--clay-surface-hover); }
    .icon-btn.warn { color: var(--danger-text); }
    .chev { color: var(--clay-text-muted); font-size: 19px; width: 19px; height: 19px; }
    .more { display: flex; justify-content: center; padding: 12px; }

    .empty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 44px 20px; text-align: center; color: var(--clay-text-muted); }
    .empty mat-icon { font-size: 38px; width: 38px; height: 38px; opacity: .5; }
    .empty h4 { margin: 0; color: var(--clay-text); font-size: 15px; }
    .empty p { margin: 0; font-size: 13px; max-width: 440px; }

    @media (max-width: 980px) {
      .live-row { grid-template-columns: 80px 1fr 110px; }
      .live-row > :nth-child(4), .live-row > :nth-child(5), .live-row > :nth-child(6) { display: none; }
      .tr { grid-template-columns: 1fr 1.2fr 110px 70px; }
      .tr > :nth-child(n+5) { display: none; }
    }
  `],
})
export class PackageMonitorComponent implements OnInit, OnDestroy {
  private svc = inject(ProjectsService);
  private router = inject(Router);

  readonly tab = signal<'live' | 'history'>('live');
  readonly monitor = signal<ImportsMonitor | null>(null);
  readonly loadedMonitor = signal(false);
  readonly history = signal<HistoryRow[]>([]);
  readonly historyTotal = signal(0);
  readonly loadedHistory = signal(false);
  readonly projects = signal<Project[]>([]);
  readonly filterIds = signal<string[]>([]);
  readonly sort = signal<'asc' | 'desc'>('desc');

  readonly activeCount = computed(() => this.monitor()?.kpis.inProgress ?? 0);

  private pollTimer: any = null;
  private lastActiveIds = '';

  ngOnInit(): void {
    this.refreshMonitor();
    this.svc.list().subscribe({ next: (p) => this.projects.set(p), error: () => {} });
    this.reloadHistory();
    this.pollTimer = setInterval(() => this.refreshMonitor(), 4000);
  }

  ngOnDestroy(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  setTab(t: 'live' | 'history'): void {
    this.tab.set(t);
    if (t === 'history') this.reloadHistory();
  }

  refreshMonitor(): void {
    this.svc.importsMonitor().subscribe({
      next: (m) => {
        this.monitor.set(m);
        this.loadedMonitor.set(true);
        // A package just finished → the history changed too.
        const ids = m.active.map((a) => a.id).sort().join(',');
        if (this.lastActiveIds && ids !== this.lastActiveIds) this.reloadHistory(true);
        this.lastActiveIds = ids;
      },
      error: () => this.loadedMonitor.set(true),
    });
  }

  reloadHistory(silent = false): void {
    if (!silent) this.loadedHistory.set(false);
    this.svc.importsHistory({ projectIds: this.filterIds(), sort: this.sort(), limit: PAGE, offset: 0 }).subscribe({
      next: (h) => { this.history.set(h.rows); this.historyTotal.set(h.total); this.loadedHistory.set(true); },
      error: () => this.loadedHistory.set(true),
    });
  }

  loadMore(): void {
    this.svc.importsHistory({ projectIds: this.filterIds(), sort: this.sort(), limit: PAGE, offset: this.history().length }).subscribe({
      next: (h) => { this.history.set([...this.history(), ...h.rows]); this.historyTotal.set(h.total); },
      error: () => {},
    });
  }

  toggleFilter(id: string): void {
    const cur = this.filterIds();
    this.filterIds.set(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
    this.reloadHistory();
  }
  clearFilter(): void { this.filterIds.set([]); this.reloadHistory(); }
  toggleSort(): void { this.sort.set(this.sort() === 'desc' ? 'asc' : 'desc'); this.reloadHistory(); }

  openRow(row: HistoryRow): void {
    this.router.navigate(['/projects', row.projectId, 'monitoring']);
  }

  retry(row: HistoryRow, ev: Event): void {
    ev.stopPropagation();
    this.svc.retryImport(row.projectId, row.id).subscribe({
      next: () => { this.refreshMonitor(); this.reloadHistory(true); this.tab.set('live'); },
      error: () => {},
    });
  }

  // ── formatting ──
  stageLabel(stage: string): string { return IMPORT_STAGE_LABELS[stage] ?? stage; }
  rowState(row: HistoryRow): 'completed' | 'failed' | 'running' {
    return row.status === 'completed' ? 'completed' : row.status === 'failed' ? 'failed' : 'running';
  }
  rowStateLabel(row: HistoryRow): string {
    const s = this.rowState(row);
    return s === 'running' ? (IMPORT_STAGE_LABELS[row.stage] ?? 'Processing') : s === 'completed' ? 'Completed' : 'Failed';
  }
  fmtBytes(n: number | null): string {
    if (n == null) return '';
    if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
    if (n >= 1024) return `${Math.round(n / 1024)} KB`;
    return `${n} B`;
  }
  ago(iso: string | null): string {
    if (!iso) return '—';
    const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  }
  fmtDuration(ms: number | null): string {
    if (ms == null) return '—';
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
  }
}
