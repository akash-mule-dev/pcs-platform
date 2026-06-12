import { Component, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ProjectWorkspaceStore, IMPORT_STAGE_LABELS } from './project-workspace.store';
import { ProjectsService, ImportFileRow, ImportDetail } from '../core/services/projects.service';

interface StepDef { key: string; label: string; icon: string; }

/**
 * Project monitoring tab — the live import pipeline + its full history.
 *
 * Top: one card per ACTIVE import with a stage stepper (Upload → Extract →
 * Build tree → Convert 3D), the overall %, and the latest pipeline message —
 * fed live by the store (websocket + polling fallback).
 *
 * Below: every package ever uploaded, newest first, with status, node count,
 * duration, uploader and error. A row expands into the per-import event
 * timeline (stage transitions with timestamps) and offers Retry for failures.
 */
@Component({
  selector: 'app-project-monitoring',
  standalone: true,
  imports: [CommonModule, RouterModule, MatIconModule, MatTooltipModule, MatProgressBarModule, MatProgressSpinnerModule],
  template: `
    <div class="mon">

      <!-- ── Live pipelines ─────────────────────────────────────────── -->
      @if (store.importing()) {
        <section class="live-card">
          <div class="live-head">
            <mat-icon class="file-ic">upload_file</mat-icon>
            <div class="live-id">
              <strong>Uploading…</strong>
              <span class="muted">The file is stored safely before processing begins</span>
            </div>
            <span class="live-pct">{{ store.uploadProgress() }}%</span>
          </div>
          <mat-progress-bar mode="determinate" [value]="store.uploadProgress()"></mat-progress-bar>
        </section>
      }

      @for (imp of store.activeImports(); track imp.id) {
        <section class="live-card">
          <div class="live-head">
            <mat-icon class="file-ic">deployed_code</mat-icon>
            <div class="live-id">
              <strong>{{ imp.originalName }}</strong>
              <span class="muted">{{ fmtBytes(imp.size) }} · started {{ ago(imp.startedAt || imp.createdAt) }}
                @if (imp.nodeCount > 0) { · {{ imp.nodeCount }} nodes extracted }
              </span>
            </div>
            <span class="live-pct">{{ imp.progress }}%</span>
          </div>

          <div class="stepper">
            @for (s of steps; track s.key; let i = $index) {
              <div class="step" [class.done]="stepState(imp, i) === 'done'"
                   [class.current]="stepState(imp, i) === 'current'"
                   [class.error]="stepState(imp, i) === 'error'">
                <div class="step-dot">
                  @switch (stepState(imp, i)) {
                    @case ('done') { <mat-icon>check</mat-icon> }
                    @case ('current') { <mat-spinner diameter="14"></mat-spinner> }
                    @case ('error') { <mat-icon>priority_high</mat-icon> }
                    @default { <span class="idle-dot"></span> }
                  }
                </div>
                <span class="step-lbl">{{ s.label }}</span>
                @if (i < steps.length - 1) { <div class="step-line" [class.lit]="stepState(imp, i) === 'done'"></div> }
              </div>
            }
          </div>

          <mat-progress-bar mode="determinate" [value]="imp.progress"></mat-progress-bar>
          @if (store.pipelineMessage(); as msg) { <p class="live-msg">{{ msg }}</p> }
        </section>
      }

      <!-- ── History ────────────────────────────────────────────────── -->
      <section class="hist">
        <div class="hist-head">
          <h3><mat-icon>history</mat-icon> Package upload history</h3>
          <div class="hist-meta">
            @if (kpis(); as k) {
              <span class="chip ok" matTooltip="Completed imports">{{ k.completed }} completed</span>
              @if (k.failed > 0) { <span class="chip bad" matTooltip="Failed imports">{{ k.failed }} failed</span> }
              @if (k.active > 0) { <span class="chip run">{{ k.active }} running</span> }
            }
            <button class="ghost-btn" (click)="store.refreshImports()" matTooltip="Refresh"><mat-icon>refresh</mat-icon></button>
            <input #fileInput type="file" hidden accept=".ifc" (change)="onFile($event)">
            <button class="ghost-btn primary" (click)="fileInput.click()" [disabled]="store.importing()">
              <mat-icon>upload_file</mat-icon><span>Import IFC</span>
            </button>
          </div>
        </div>

        @if (!store.importsLoaded()) {
          <div class="empty"><mat-spinner diameter="26"></mat-spinner></div>
        } @else if (store.imports().length === 0) {
          <div class="empty">
            <mat-icon>cloud_upload</mat-icon>
            <h4>No packages uploaded yet</h4>
            <p>Import an IFC to build this project's assembly tree and 3D model. Every upload and its processing pipeline will be tracked here.</p>
          </div>
        } @else {
          <div class="tbl">
            <div class="tr th">
              <span>Status</span><span>File</span><span class="num">Nodes</span><span>3D model</span>
              <span>Uploaded by</span><span>Started</span><span class="num">Duration</span><span></span>
            </div>
            @for (row of store.imports(); track row.id) {
              <div class="tr" [class.open]="expanded() === row.id" (click)="toggle(row.id)">
                <span><span class="st st-{{ rowState(row) }}"><span class="st-dot"></span>{{ rowStateLabel(row) }}</span></span>
                <span class="fname" [matTooltip]="row.originalName">
                  <mat-icon>description</mat-icon>
                  <span class="fname-txt">{{ row.originalName }}</span>
                  <em class="muted">{{ fmtBytes(row.size) }}</em>
                </span>
                <span class="num">{{ row.nodeCount || '—' }}</span>
                <span>
                  @if (row.modelId) {
                    <a class="mini-link" [routerLink]="['/projects', store.id(), 'assemblies']" (click)="$event.stopPropagation()">
                      <mat-icon>view_in_ar</mat-icon>View
                    </a>
                  } @else if (rowState(row) === 'running') { <span class="muted">building…</span> }
                  @else { <span class="muted">—</span> }
                </span>
                <span class="muted">{{ row.createdByName || '—' }}</span>
                <span class="muted" [matTooltip]="(((row.startedAt || row.createdAt) | date:'medium') || '')">{{ ago(row.startedAt || row.createdAt) }}</span>
                <span class="num muted">{{ fmtDuration(row) }}</span>
                <span class="row-actions">
                  @if (row.status === 'failed') {
                    <button class="ghost-btn warn" (click)="retry(row, $event)" matTooltip="Retry this import">
                      <mat-icon>replay</mat-icon><span>Retry</span>
                    </button>
                  }
                  <mat-icon class="chev">{{ expanded() === row.id ? 'expand_less' : 'expand_more' }}</mat-icon>
                </span>
              </div>

              @if (expanded() === row.id) {
                <div class="detail" (click)="$event.stopPropagation()">
                  @if (row.error) {
                    <div class="err-box">
                      <mat-icon>error_outline</mat-icon>
                      <div><strong>Failure</strong><p>{{ row.error }}</p></div>
                    </div>
                  }
                  @if (detail(); as d) {
                    @if (d.file.id === row.id) {
                      <div class="timeline">
                        @for (ev of d.events; track ev.id; let i = $index) {
                          <div class="tl-row" [class.tl-err]="ev.stage === 'failed'">
                            <div class="tl-rail">
                              <span class="tl-dot"></span>
                              @if (i < d.events.length - 1) { <span class="tl-line"></span> }
                            </div>
                            <div class="tl-body">
                              <div class="tl-top">
                                <span class="tl-stage">{{ stageLabel(ev.stage) }}</span>
                                <span class="tl-pct">{{ ev.progress }}%</span>
                                <span class="tl-time" [matTooltip]="((ev.createdAt | date:'medium') || '')">{{ ev.createdAt | date:'HH:mm:ss' }} ({{ delta(d.events, i) }})</span>
                              </div>
                              <p class="tl-msg">{{ ev.message }}</p>
                            </div>
                          </div>
                        }
                      </div>
                      @if (d.conversion; as c) {
                        <div class="conv-stats">
                          <span class="muted">Conversion job:</span>
                          <span class="chip">{{ c.status }} · {{ c.progress }}%</span>
                          @if (c.trianglesAfter) { <span class="chip">{{ c.trianglesAfter | number }} triangles</span> }
                          @if (c.outputSize) { <span class="chip">GLB {{ fmtBytes(c.outputSize) }}</span> }
                          @if (c.durationMs) { <span class="chip">{{ (c.durationMs / 1000) | number:'1.0-1' }}s</span> }
                        </div>
                      }
                    } @else { <div class="empty sm"><mat-spinner diameter="20"></mat-spinner></div> }
                  } @else { <div class="empty sm"><mat-spinner diameter="20"></mat-spinner></div> }
                </div>
              }
            }
          </div>
        }
      </section>
    </div>
  `,
  styles: [`
    .mon { display: flex; flex-direction: column; gap: 16px; }

    /* ── Live cards ─────────────────────────────────────────────── */
    .live-card {
      background: var(--clay-surface); border: 1px solid var(--clay-border);
      border-radius: var(--clay-radius); padding: 16px 18px 14px;
      display: flex; flex-direction: column; gap: 12px;
    }
    .live-head { display: flex; align-items: center; gap: 12px; }
    .file-ic { color: var(--clay-primary); }
    .live-id { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
    .live-id strong { font-size: 14px; color: var(--clay-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .live-pct { font-size: 20px; font-weight: 700; color: var(--clay-primary); font-family: 'Space Grotesk','Inter',sans-serif; }
    .live-msg { margin: 0; font-size: 12px; color: var(--clay-text-muted); }
    .muted { color: var(--clay-text-muted); font-size: 12px; font-style: normal; }

    .stepper { display: flex; align-items: flex-start; gap: 0; padding: 2px 4px; flex-wrap: wrap; }
    .step { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 120px; position: relative; }
    .step-dot {
      width: 26px; height: 26px; border-radius: 50%; flex-shrink: 0;
      border: 2px solid var(--clay-border); background: var(--clay-surface);
      display: flex; align-items: center; justify-content: center;
    }
    .step-dot mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .idle-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--clay-border); }
    .step.done .step-dot { background: var(--success-bg); border-color: var(--success-text); color: var(--success-text); }
    .step.current .step-dot { border-color: var(--clay-primary); }
    .step.error .step-dot { background: var(--danger-bg); border-color: var(--danger-text); color: var(--danger-text); }
    .step-lbl { font-size: 12px; font-weight: 600; color: var(--clay-text-muted); white-space: nowrap; }
    .step.done .step-lbl { color: var(--success-text); }
    .step.current .step-lbl { color: var(--clay-primary); }
    .step.error .step-lbl { color: var(--danger-text); }
    .step-line { flex: 1; height: 2px; background: var(--clay-border); margin: 0 10px; min-width: 14px; }
    .step-line.lit { background: var(--success-text); }

    /* ── History ────────────────────────────────────────────────── */
    .hist { background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius); overflow: hidden; }
    .hist-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 14px 18px; border-bottom: 1px solid var(--clay-border); flex-wrap: wrap; }
    .hist-head h3 { margin: 0; font-size: 15px; font-weight: 700; color: var(--clay-text); display: inline-flex; align-items: center; gap: 8px; }
    .hist-head h3 mat-icon { font-size: 19px; width: 19px; height: 19px; color: var(--clay-text-muted); }
    .hist-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

    .chip { display: inline-flex; align-items: center; gap: 4px; border-radius: 999px; padding: 3px 10px; font-size: 11.5px; font-weight: 600; background: var(--clay-bg-warm); color: var(--clay-text-secondary); }
    .chip.ok { background: var(--success-bg); color: var(--success-text); }
    .chip.bad { background: var(--danger-bg); color: var(--danger-text); }
    .chip.run { background: var(--info-bg); color: var(--info-text); }

    .ghost-btn {
      display: inline-flex; align-items: center; gap: 6px;
      border: 1px solid var(--clay-border); background: var(--clay-surface);
      color: var(--clay-text-secondary); border-radius: var(--clay-radius-sm);
      padding: 6px 10px; font-size: 12.5px; font-weight: 600; cursor: pointer; font-family: inherit;
      transition: all .15s;
    }
    .ghost-btn mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .ghost-btn:hover { border-color: var(--clay-primary); color: var(--clay-primary); }
    .ghost-btn.primary { background: var(--clay-primary); border-color: var(--clay-primary); color: #fff; }
    .ghost-btn.primary:hover { filter: brightness(1.08); }
    .ghost-btn.warn { color: var(--danger-text); border-color: var(--danger-text); }
    .ghost-btn.warn:hover { background: var(--danger-bg); }
    .ghost-btn:disabled { opacity: .55; cursor: default; }

    .tbl { display: flex; flex-direction: column; }
    .tr {
      display: grid; grid-template-columns: 130px minmax(180px,1.6fr) 70px 110px minmax(110px,1fr) 110px 90px 130px;
      gap: 10px; align-items: center; padding: 10px 18px; border-bottom: 1px solid var(--clay-border);
      cursor: pointer; transition: background .12s; font-size: 13px; color: var(--clay-text);
    }
    .tr:last-child { border-bottom: none; }
    .tr:not(.th):hover { background: var(--clay-surface-hover); }
    .tr.open { background: var(--clay-bg-warm); }
    .tr.th { cursor: default; font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--clay-text-muted); padding: 9px 18px; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }

    .st { display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; padding: 2px 10px 2px 8px; font-size: 11.5px; font-weight: 700; }
    .st-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
    .st-completed { background: var(--success-bg); color: var(--success-text); }
    .st-failed { background: var(--danger-bg); color: var(--danger-text); }
    .st-running { background: var(--info-bg); color: var(--info-text); }
    .st-running .st-dot { animation: pulse 1.2s ease-in-out infinite; }
    @keyframes pulse { 0%,100% { opacity: .35; } 50% { opacity: 1; } }

    .fname { display: inline-flex; align-items: center; gap: 7px; min-width: 0; }
    .fname mat-icon { font-size: 17px; width: 17px; height: 17px; color: var(--clay-text-muted); flex-shrink: 0; }
    .fname-txt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
    .mini-link { display: inline-flex; align-items: center; gap: 4px; color: var(--clay-primary); font-weight: 600; font-size: 12.5px; }
    .mini-link mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .row-actions { display: flex; align-items: center; justify-content: flex-end; gap: 6px; }
    .chev { color: var(--clay-text-muted); font-size: 20px; width: 20px; height: 20px; }

    /* ── Expanded detail ───────────────────────────────────────── */
    .detail { padding: 14px 18px 18px 32px; border-bottom: 1px solid var(--clay-border); background: var(--clay-bg-warm); }
    .err-box {
      display: flex; gap: 10px; align-items: flex-start;
      background: var(--danger-bg); color: var(--danger-text);
      border-radius: var(--clay-radius-sm); padding: 10px 14px; margin-bottom: 14px; font-size: 13px;
    }
    .err-box mat-icon { flex-shrink: 0; }
    .err-box p { margin: 2px 0 0; word-break: break-word; }

    .timeline { display: flex; flex-direction: column; }
    .tl-row { display: flex; gap: 12px; }
    .tl-rail { display: flex; flex-direction: column; align-items: center; width: 14px; }
    .tl-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--clay-primary); margin-top: 5px; flex-shrink: 0; }
    .tl-err .tl-dot { background: var(--danger-text); }
    .tl-line { flex: 1; width: 2px; background: var(--clay-border); min-height: 10px; }
    .tl-body { padding-bottom: 12px; min-width: 0; flex: 1; }
    .tl-top { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
    .tl-stage { font-size: 12px; font-weight: 700; color: var(--clay-text); }
    .tl-err .tl-stage { color: var(--danger-text); }
    .tl-pct { font-size: 11px; font-weight: 700; color: var(--clay-primary); font-variant-numeric: tabular-nums; }
    .tl-time { font-size: 11px; color: var(--clay-text-muted); }
    .tl-msg { margin: 2px 0 0; font-size: 12.5px; color: var(--clay-text-secondary); word-break: break-word; }
    .conv-stats { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 10px; }

    .empty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 40px 20px; text-align: center; color: var(--clay-text-muted); }
    .empty.sm { padding: 16px; }
    .empty mat-icon { font-size: 38px; width: 38px; height: 38px; opacity: .5; }
    .empty h4 { margin: 0; color: var(--clay-text); font-size: 15px; }
    .empty p { margin: 0; font-size: 13px; max-width: 420px; }

    @media (max-width: 900px) {
      .tr { grid-template-columns: 110px 1fr 60px 90px; }
      .tr > :nth-child(5), .tr > :nth-child(6), .tr > :nth-child(7) { display: none; }
    }
  `],
})
export class ProjectMonitoringComponent implements OnDestroy {
  store = inject(ProjectWorkspaceStore);
  private svc = inject(ProjectsService);

  readonly steps: StepDef[] = [
    { key: 'uploaded', label: 'Upload', icon: 'cloud_upload' },
    { key: 'extracting', label: 'Extract structure', icon: 'schema' },
    { key: 'persisting', label: 'Build assembly tree', icon: 'account_tree' },
    { key: 'converting', label: 'Convert 3D model', icon: 'view_in_ar' },
  ];

  readonly expanded = signal<string | null>(null);
  readonly detail = signal<ImportDetail | null>(null);
  /** stage:progress snapshot of the expanded row — refetch the timeline when it moves. */
  private lastSnapshot = '';
  private refetchFx = effect(() => {
    const id = this.expanded();
    if (!id) return;
    const row = this.store.imports().find((r) => r.id === id);
    if (!row) return;
    const snap = `${row.id}:${row.stage}:${row.progress}:${row.status}`;
    if (snap !== this.lastSnapshot) {
      this.lastSnapshot = snap;
      this.fetchDetail(id);
    }
  });

  readonly kpis = computed(() => {
    const rows = this.store.imports();
    if (!rows.length) return null;
    return {
      completed: rows.filter((r) => r.status === 'completed').length,
      failed: rows.filter((r) => r.status === 'failed').length,
      active: rows.filter((r) => r.status !== 'completed' && r.status !== 'failed').length,
    };
  });

  constructor() {
    // Entering the tab always shows fresh history (ws keeps it live afterwards).
    this.store.refreshImports();
  }

  ngOnDestroy(): void { this.refetchFx.destroy(); }

  // ── Stepper helpers ──
  private stageIndex(row: ImportFileRow): number {
    const order = ['uploaded', 'extracting', 'persisting', 'converting'];
    if (row.stage === 'completed') return this.steps.length; // all done
    if (row.stage === 'failed') {
      // Where did it die? Reconstruct from how far progress got.
      if (row.modelId) return this.steps.length;
      if (row.conversionJobId) return 3;
      if (row.nodeCount > 0) return 2;
      return 1;
    }
    return Math.max(0, order.indexOf(row.stage));
  }

  stepState(row: ImportFileRow, i: number): 'done' | 'current' | 'error' | 'idle' {
    const cur = this.stageIndex(row);
    if (row.stage === 'failed') return i < cur ? 'done' : i === cur ? 'error' : 'idle';
    if (i < cur) return 'done';
    if (i === cur) return 'current';
    return 'idle';
  }

  // ── Row helpers ──
  rowState(row: ImportFileRow): 'completed' | 'failed' | 'running' {
    if (row.status === 'completed') return 'completed';
    if (row.status === 'failed') return 'failed';
    return 'running';
  }
  rowStateLabel(row: ImportFileRow): string {
    const s = this.rowState(row);
    if (s === 'running') return IMPORT_STAGE_LABELS[row.stage] ?? 'Processing';
    return s === 'completed' ? 'Completed' : 'Failed';
  }
  stageLabel(stage: string): string { return IMPORT_STAGE_LABELS[stage] ?? stage; }

  toggle(id: string): void {
    if (this.expanded() === id) { this.expanded.set(null); this.detail.set(null); this.lastSnapshot = ''; return; }
    this.expanded.set(id);
    this.detail.set(null);
    this.lastSnapshot = '';
  }

  private fetchDetail(id: string): void {
    this.svc.importDetail(this.store.id(), id).subscribe({
      next: (d) => { if (this.expanded() === d.file.id) this.detail.set(d); },
      error: () => {},
    });
  }

  retry(row: ImportFileRow, ev: Event): void {
    ev.stopPropagation();
    this.store.retryImport(row.id);
  }

  onFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files && input.files.length ? input.files[0] : null;
    if (file) this.store.importIfc(file);
    input.value = '';
  }

  // ── Formatting ──
  fmtBytes(n: number | null): string {
    if (n == null) return '—';
    if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
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

  fmtDuration(row: ImportFileRow): string {
    let ms = row.durationMs;
    if (ms == null && row.status !== 'completed' && row.status !== 'failed' && (row.startedAt || row.createdAt)) {
      ms = Date.now() - new Date(row.startedAt || row.createdAt).getTime(); // live elapsed
    }
    if (ms == null) return '—';
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
  }

  /** Time offset of event i from the first event ("+12.4s"). */
  delta(events: { createdAt: string }[], i: number): string {
    if (i === 0 || !events.length) return '+0s';
    const d = (new Date(events[i].createdAt).getTime() - new Date(events[0].createdAt).getTime()) / 1000;
    return d < 60 ? `+${d.toFixed(1)}s` : `+${Math.floor(d / 60)}m ${Math.round(d % 60)}s`;
  }
}
