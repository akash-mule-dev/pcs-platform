import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { ProjectWorkspaceStore } from './project-workspace.store';
import { ProjectsService, AssemblyNode, NodeQualityStatus, QaStatus } from '../core/services/projects.service';
import { QualityReportsService, QualityReport, ReportTemplate } from '../core/services/quality-reports.service';

interface QaRow { node: AssemblyNode; q: NodeQualityStatus; flagged: boolean; }

/** Quality tab: record checks RIGHT HERE (search an item, act) and start QC
 *  reports (incl. NCR-type), plus the QC overview — totals + every inspected
 *  item, flagged ones first. NCRs are raised as NCR-type QC reports below. */
@Component({
  selector: 'app-project-quality',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule],
  template: `
    <!-- Record a check — no need to leave the order -->
    <section class="rec">
      <div class="rec-head"><mat-icon>fact_check</mat-icon><h3>Record a check</h3>
        <span class="rec-hint">Search an item, then mark it or save a measurement. To find it visually, use <a (click)="goInspect()">Assemblies &amp; 3D</a>.</span>
      </div>
      <div class="rec-row">
        <div class="picker">
          <input type="text" placeholder="Search item by mark or name…" [ngModel]="q()" (ngModelChange)="onQuery($event)" (focus)="openList.set(true)">
          @if (openList() && results().length > 0) {
            <div class="results">
              @for (n of results(); track n.id) {
                <button class="result" (click)="pick(n)">
                  <span class="r-mark">{{ n.mark || n.name }}</span>
                  <span class="r-type">{{ typeLabel(n.nodeType) }}</span>
                </button>
              }
            </div>
          }
        </div>
        @if (picked(); as p) {
          <span class="picked"><mat-icon>widgets</mat-icon>{{ p.mark || p.name }}<button class="x" (click)="clearPick()">×</button></span>
          @if (stages().length) {
            <select class="stage-select" [(ngModel)]="selectedStageId" title="Operation this check applies to">
              <option value="">At stage… (optional)</option>
              @for (s of stages(); track s.id) { <option [value]="s.id">{{ s.name }}</option> }
            </select>
          }
          <button class="qbtn pass" [disabled]="busy()" (click)="record('pass')">Pass</button>
          <button class="qbtn warn" [disabled]="busy()" (click)="record('warning')">Warning</button>
          <button class="qbtn fail" [disabled]="busy()" (click)="record('fail')">Fail</button>
          <button class="qbtn" [disabled]="busy()" (click)="measureOpen.set(!measureOpen())">Measure…</button>
        }
      </div>
      @if (picked() && measureOpen()) {
        <div class="rec-ncr">
          <input class="num" type="number" placeholder="Value" [(ngModel)]="meas.value">
          <input class="num" type="text" placeholder="Unit" [(ngModel)]="meas.unit">
          <input class="num" type="number" placeholder="Tol min" [(ngModel)]="meas.min">
          <input class="num" type="number" placeholder="Tol max" [(ngModel)]="meas.max">
          <input class="grow" type="text" placeholder="Defect / notes" [(ngModel)]="meas.notes">
          <button class="qbtn" [disabled]="busy() || meas.value == null" (click)="recordMeasure()">Save measurement</button>
          <span class="meas-hint">Out-of-tolerance auto-fails.</span>
        </div>
      }
      @if (msg()) { <p class="rec-msg" [class.err]="err()">{{ msg() }}</p> }
    </section>

    <!-- QC Reports — pick a template, a blank report opens full-screen to fill -->
    @if (orderId) {
      <section class="rec reports">
        <div class="rec-head"><mat-icon>description</mat-icon><h3>QC Reports</h3>
          <span class="rec-hint">Pick a template — a blank report opens against this work order@if (picked()) { for <strong>{{ picked()!.mark || picked()!.name }}</strong> }.</span>
        </div>
        <div class="rec-row">
          <select class="tpl-select" [(ngModel)]="reportTemplateId">
            <option value="">— pick a report template —</option>
            @for (t of templates(); track t.id) { <option [value]="t.id">{{ t.name }} ({{ t.type }})</option> }
          </select>
          @if (stages().length) {
            <select class="stage-select" [(ngModel)]="selectedStageId" title="Operation this report applies to">
              <option value="">At stage… (optional)</option>
              @for (s of stages(); track s.id) { <option [value]="s.id">{{ s.name }}</option> }
            </select>
          }
          <button class="qbtn start" [disabled]="reportBusy() || !reportTemplateId" (click)="startReport()">
            <mat-icon>play_arrow</mat-icon>{{ reportBusy() ? 'Starting…' : 'Start & fill' }}
          </button>
          @if (templates().length === 0) { <span class="rec-hint warn">No templates yet — create one under Quality → Report Templates.</span> }
        </div>
        @if (reportError()) { <p class="rec-msg err">{{ reportError() }}</p> }

        @if (reports().length > 0) {
          <div class="rep-list">
            @for (r of reports(); track r.id) {
              <button class="rep-row" (click)="openReport(r)">
                <span class="rep-num">{{ r.number }}</span>
                <span class="rep-tpl">{{ r.templateName }}</span>
                @if (r.itemMark) { <span class="rep-item">{{ r.itemMark }}</span> }
                <span class="spacer"></span>
                <span class="rep-pill st-{{ r.status }}">{{ r.status === 'submitted' ? 'Submitted' : 'Draft' }}</span>
                <span class="rep-date">{{ (r.submittedAt || r.createdAt) | date:'MMM d, HH:mm' }}</span>
                <mat-icon class="rep-go">chevron_right</mat-icon>
              </button>
            }
          </div>
        }
      </section>
    }

    @if ((store.quality()?.totals?.inspected ?? 0) === 0 && openNcr() === 0) {
      <div class="empty-state">
        <mat-icon>verified</mat-icon>
        <h3>No inspections yet</h3>
        <p>Record the first check above — quick pass/fail or a measurement — or start a QC report.</p>
      </div>
    } @else {
      <div class="kpi-grid">
        <div class="kpi"><div class="kpi-icon tone-blue"><mat-icon>fact_check</mat-icon></div><div class="kt"><span class="kn">{{ store.quality()?.totals?.inspected ?? 0 }}</span><span class="kl">Items inspected</span></div></div>
        <div class="kpi" [class.alert]="(store.quality()?.totals?.failed ?? 0) > 0"><div class="kpi-icon" [class.tone-green]="(store.quality()?.totals?.failed ?? 0) === 0" [class.tone-danger]="(store.quality()?.totals?.failed ?? 0) > 0"><mat-icon>cancel</mat-icon></div><div class="kt"><span class="kn">{{ store.quality()?.totals?.failed ?? 0 }}</span><span class="kl">Failed checks</span></div></div>
        <div class="kpi" [class.alert]="openNcr() > 0"><div class="kpi-icon" [class.tone-orange]="openNcr() === 0" [class.tone-danger]="openNcr() > 0"><mat-icon>report_problem</mat-icon></div><div class="kt"><span class="kn">{{ openNcr() }}</span><span class="kl">Open NCRs</span></div></div>
      </div>

      @if (flagged().length > 0) {
        <h3 class="section"><mat-icon>priority_high</mat-icon>Needs attention <span class="badge bad">{{ flagged().length }}</span></h3>
        <div class="qa-table">
          @for (r of flagged(); track r.node.id) { <ng-container *ngTemplateOutlet="row; context: { $implicit: r }"></ng-container> }
        </div>
      }

      @if (cleared().length > 0) {
        <h3 class="section ok"><mat-icon>check_circle</mat-icon>Cleared <span class="badge">{{ cleared().length }}</span></h3>
        <div class="qa-table">
          @for (r of cleared(); track r.node.id) { <ng-container *ngTemplateOutlet="row; context: { $implicit: r }"></ng-container> }
        </div>
      }
    }

    <ng-template #row let-r>
      <div class="qrow" [class.flagged]="r.flagged" (click)="inspect(r.node)">
        <span class="q-dot qb-{{ r.q.status || (r.q.openNcr > 0 ? 'fail' : 'pass') }}"></span>
        <div class="q-id">
          <span class="q-name">{{ r.node.mark || r.node.name }}</span>
          <span class="q-sub">{{ typeLabel(r.node.nodeType) }}@if (r.node.profile) { · {{ r.node.profile }} }</span>
        </div>
        <div class="q-tally">
          @if (r.q.pass > 0) { <span class="t pass"><mat-icon>check</mat-icon>{{ r.q.pass }}</span> }
          @if (r.q.warning > 0) { <span class="t warn"><mat-icon>warning</mat-icon>{{ r.q.warning }}</span> }
          @if (r.q.fail > 0) { <span class="t fail"><mat-icon>close</mat-icon>{{ r.q.fail }}</span> }
          @if (r.q.openNcr > 0) { <span class="ncr-chip">{{ r.q.openNcr }} NCR</span> }
        </div>
        <span class="q-when">@if (r.q.lastInspectedAt) { {{ r.q.lastInspectedAt | date:'MMM d' }} }</span>
        <span class="q-cta">View in 3D<mat-icon>chevron_right</mat-icon></span>
      </div>
    </ng-template>
  `,
  styles: [`
    /* Record-a-check panel */
    .rec { background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius); padding: 14px 16px; margin-bottom: 18px; box-shadow: var(--clay-shadow-soft); }
    .rec-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
    .rec-head mat-icon { color: var(--clay-primary); font-size: 20px; width: 20px; height: 20px; }
    .rec-head h3 { margin: 0; font-size: 14px; font-weight: 700; color: var(--clay-text); }
    .rec-hint { font-size: 12px; color: var(--clay-text-muted); }
    .rec-hint a { color: var(--clay-primary); cursor: pointer; font-weight: 600; }
    .rec-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .picker { position: relative; min-width: 240px; flex: 1; max-width: 360px; }
    .picker input { width: 100%; padding: 8px 10px; border: 1px solid var(--clay-border); border-radius: var(--clay-radius-sm); font-size: 13px; background: var(--clay-surface); color: var(--clay-text); font-family: inherit; box-sizing: border-box; }
    .results { position: absolute; top: 100%; left: 0; right: 0; z-index: 30; background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius-sm); box-shadow: var(--clay-shadow-soft); max-height: 260px; overflow-y: auto; }
    .result { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; padding: 8px 10px; background: none; border: none; border-bottom: 1px solid var(--clay-border); cursor: pointer; font-family: inherit; }
    .result:last-child { border-bottom: none; }
    .result:hover { background: var(--clay-surface-hover); }
    .r-mark { font-weight: 600; font-size: 13px; color: var(--clay-text); }
    .r-type { font-size: 11px; color: var(--clay-text-muted); }
    .picked { display: inline-flex; align-items: center; gap: 5px; background: var(--info-bg); color: var(--clay-primary); border-radius: 999px; padding: 4px 6px 4px 10px; font-size: 12px; font-weight: 700; }
    .picked mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .picked .x { background: none; border: none; color: var(--clay-primary); font-size: 14px; cursor: pointer; padding: 0 4px; font-weight: 700; }
    .qbtn { border: 1px solid var(--clay-border); background: var(--clay-surface); border-radius: var(--clay-radius-sm); padding: 7px 12px; font-size: 12px; font-weight: 600; cursor: pointer; color: var(--clay-text-secondary); font-family: inherit; }
    .qbtn:disabled { opacity: .5; cursor: default; }
    .qbtn.pass { color: var(--success-text); border-color: var(--success); }
    .qbtn.warn { color: var(--warning-text); border-color: var(--warning); }
    .qbtn.fail { color: var(--danger-text); border-color: var(--danger); }
    .qbtn.ncr { color: var(--clay-primary); border-color: var(--clay-primary); }
    .rec-ncr { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; align-items: center; }
    .rec-ncr input, .rec-ncr select { padding: 7px 9px; border: 1px solid var(--clay-border); border-radius: var(--clay-radius-xs); font-size: 12px; background: var(--clay-surface); color: var(--clay-text); font-family: inherit; }
    .rec-ncr .grow { flex: 1; min-width: 200px; }
    .rec-ncr .num { width: 84px; }
    .meas-hint { font-size: 11px; color: var(--clay-text-muted); }
    .stage-select { padding: 7px 9px; border: 1px solid var(--clay-border); border-radius: var(--clay-radius-sm); font-size: 12px; background: var(--clay-surface); color: var(--clay-text); font-family: inherit; max-width: 180px; }
    .rec-msg { margin: 8px 0 0; font-size: 12px; font-weight: 600; color: var(--success-text); }
    .rec-msg.err { color: var(--danger-text); }

    .kpi-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 22px; }
    .kpi { display: flex; align-items: center; gap: 14px; background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius); padding: 16px 18px; box-shadow: var(--clay-shadow-soft); }
    .kpi.alert { border-color: var(--danger); }
    .kpi-icon { width: 44px; height: 44px; border-radius: var(--clay-radius-sm); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .kpi-icon mat-icon { font-size: 23px; width: 23px; height: 23px; }
    .tone-blue { background: var(--kpi-blue-bg); color: var(--kpi-blue-fg); }
    .tone-green { background: var(--kpi-green-bg); color: var(--kpi-green-fg); }
    .tone-orange { background: var(--kpi-orange-bg); color: var(--kpi-orange-fg); }
    .tone-danger { background: var(--danger-bg); color: var(--danger); }
    .kt { display: flex; flex-direction: column; gap: 2px; }
    .kn { font-size: 24px; font-weight: 700; color: var(--clay-text); font-family: 'Space Grotesk','Inter',sans-serif; line-height: 1.05; }
    .kl { font-size: 12px; color: var(--clay-text-muted); }

    /* QC reports section */
    .rec.reports .tpl-select { border: 1px solid var(--clay-border); border-radius: var(--clay-radius-sm); background: var(--clay-surface); color: var(--clay-text); padding: 8px 10px; font-size: 13px; font-family: inherit; min-width: 260px; max-width: 380px; }
    .qbtn.start { display: inline-flex; align-items: center; gap: 4px; color: #fff; background: var(--clay-primary); border-color: var(--clay-primary); }
    .qbtn.start mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .rec-hint.warn { color: var(--warning-text); }
    .rep-list { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
    .rep-row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid var(--clay-border); border-radius: var(--clay-radius-sm); background: var(--clay-surface); cursor: pointer; font-family: inherit; text-align: left; transition: border-color .15s; }
    .rep-row:hover { border-color: var(--clay-primary); }
    .rep-num { font-size: 12px; font-weight: 700; color: var(--clay-text); font-family: 'Space Grotesk', monospace; }
    .rep-tpl { font-size: 12px; color: var(--clay-text-secondary); }
    .rep-item { font-size: 11px; color: var(--clay-primary); background: var(--info-bg); border-radius: 999px; padding: 1px 7px; font-weight: 700; }
    .spacer { flex: 1; }
    .rep-pill { padding: 1px 8px; border-radius: 999px; font-size: 10px; font-weight: 700; }
    .rep-pill.st-draft { background: var(--warning-bg); color: var(--warning-text); }
    .rep-pill.st-submitted { background: var(--success-bg); color: var(--success-text); }
    .rep-date { font-size: 11px; color: var(--clay-text-muted); }
    .rep-go { font-size: 16px; width: 16px; height: 16px; color: var(--clay-text-muted); }

    .section { display: flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 700; color: var(--clay-text); margin: 0 0 10px; text-transform: uppercase; letter-spacing: .04em; }
    .section mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--danger); }
    .section.ok { margin-top: 22px; } .section.ok mat-icon { color: var(--success); }
    .badge { background: var(--clay-bg-warm); color: var(--clay-text-secondary); border-radius: 999px; padding: 1px 8px; font-size: 11px; font-weight: 700; }
    .badge.bad { background: var(--danger-bg); color: var(--danger-text); }

    .qa-table { background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius); overflow: hidden; box-shadow: var(--clay-shadow-soft); }
    .qrow { display: grid; grid-template-columns: 14px minmax(180px, 1.6fr) auto 70px 90px; align-items: center; gap: 14px; padding: 12px 16px; border-bottom: 1px solid var(--clay-border); cursor: pointer; transition: background .15s; }
    .qrow:last-child { border-bottom: none; }
    .qrow:hover { background: var(--clay-surface-hover); }
    .qrow.flagged { background: color-mix(in srgb, var(--danger-bg) 35%, transparent); }
    .qrow.flagged:hover { background: var(--danger-bg); }
    .q-dot { width: 11px; height: 11px; border-radius: 50%; }
    .qb-pass { background: var(--success); } .qb-warning { background: var(--warning); } .qb-fail { background: var(--danger); }
    .q-id { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
    .q-name { font-weight: 600; font-size: 13px; color: var(--clay-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .q-sub { font-size: 11px; color: var(--clay-text-muted); text-transform: capitalize; }
    .q-tally { display: flex; align-items: center; gap: 8px; }
    .t { display: inline-flex; align-items: center; gap: 2px; font-size: 12px; font-weight: 700; }
    .t mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .t.pass { color: var(--success-text); } .t.warn { color: var(--warning-text); } .t.fail { color: var(--danger-text); }
    .ncr-chip { background: var(--danger-bg); color: var(--danger-text); border-radius: 999px; padding: 1px 8px; font-size: 11px; font-weight: 700; }
    .q-when { font-size: 12px; color: var(--clay-text-muted); text-align: right; }
    .q-cta { display: inline-flex; align-items: center; gap: 2px; font-size: 12px; font-weight: 600; color: var(--clay-primary); justify-content: flex-end; }
    .q-cta mat-icon { font-size: 16px; width: 16px; height: 16px; }
    @media (max-width: 720px) { .kpi-grid { grid-template-columns: 1fr; } .qrow { grid-template-columns: 14px 1fr auto; } .q-when, .q-cta { display: none; } }
  `],
})
export class ProjectQualityComponent implements OnInit {
  store = inject(ProjectWorkspaceStore);
  private svc = inject(ProjectsService);
  private reportsSvc = inject(QualityReportsService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  openNcr = this.store.openNcr;

  // ── QC reports (order-scoped) ──
  orderId = '';
  reportTemplateId = '';
  templates = signal<ReportTemplate[]>([]);
  reports = signal<QualityReport[]>([]);
  reportBusy = signal(false);
  reportError = signal<string | null>(null);

  // The order's routing stages — lets a check / NCR be tagged to the OPERATION
  // it was found at (so a hold point gates that stage; final QC consolidates).
  stages = signal<{ id: string; name: string; sequence: number }[]>([]);
  selectedStageId = '';

  ngOnInit(): void {
    // This tab renders under /projects/:id/orders/:orderId/quality — climb for the order.
    let r: ActivatedRoute | null = this.route;
    while (r && !this.orderId) { this.orderId = r.snapshot.paramMap.get('orderId') ?? ''; r = r.parent; }
    if (this.orderId) {
      this.reportsSvc.listTemplates().subscribe({ next: (t) => this.templates.set(t), error: () => {} });
      this.svc.orderBoard(this.orderId).subscribe({ next: (b) => this.stages.set(b.stages ?? []), error: () => {} });
      this.loadReports();
    }
  }

  private loadReports(): void {
    this.reportsSvc.list({ productionOrderId: this.orderId }).subscribe({
      next: (r) => this.reports.set(r),
      error: () => {},
    });
  }

  startReport(): void {
    if (!this.reportTemplateId || this.reportBusy() || !this.orderId) return;
    this.reportBusy.set(true); this.reportError.set(null);
    this.reportsSvc.create({
      templateId: this.reportTemplateId,
      productionOrderId: this.orderId,
      assemblyNodeId: this.picked()?.id,
      stageId: this.selectedStageId || undefined,
    }).subscribe({
      next: (r) => { this.reportBusy.set(false); this.router.navigate(['/qr', r.id]); },
      error: (e) => { this.reportBusy.set(false); this.reportError.set(e?.error?.message || 'Could not start the report.'); },
    });
  }

  openReport(r: QualityReport): void { window.open(this.reportsSvc.fillUrl(r.id), '_blank'); }

  // ── Record-a-check panel ──
  q = signal('');
  openList = signal(false);
  picked = signal<AssemblyNode | null>(null);
  busy = signal(false);
  msg = signal<string | null>(null);
  err = signal(false);
  measureOpen = signal(false);
  meas: { value: number | null; unit: string; min: number | null; max: number | null; notes: string } = { value: null, unit: 'mm', min: null, max: null, notes: '' };

  results = computed<AssemblyNode[]>(() => {
    const term = this.q().trim().toLowerCase();
    if (term.length < 1) return [];
    const out: AssemblyNode[] = [];
    for (const n of this.store.nodes()) {
      if (n.nodeType === 'group') continue;
      const hay = `${n.mark ?? ''} ${n.name ?? ''}`.toLowerCase();
      if (hay.includes(term)) { out.push(n); if (out.length >= 8) break; }
    }
    return out;
  });

  onQuery(v: string): void { this.q.set(v); this.openList.set(true); }
  pick(n: AssemblyNode): void {
    this.picked.set(n); this.openList.set(false); this.q.set('');
    this.msg.set(null); this.measureOpen.set(false);
  }
  clearPick(): void { this.picked.set(null); this.measureOpen.set(false); this.msg.set(null); }

  record(status: QaStatus): void {
    const n = this.picked(); if (!n || this.busy()) return;
    this.busy.set(true); this.msg.set(null); this.err.set(false);
    this.svc.recordQuality(this.store.id(), n.id, { status, stageId: this.selectedStageId || undefined }).subscribe({
      next: () => { this.busy.set(false); this.msg.set(`Recorded ${status} for ${n.mark || n.name}.`); this.store.refreshQuality(); },
      error: (e) => { this.busy.set(false); this.err.set(true); this.msg.set(e?.error?.message || 'Could not record.'); },
    });
  }

  recordMeasure(): void {
    const n = this.picked(); if (!n || this.meas.value == null || this.busy()) return;
    this.busy.set(true); this.msg.set(null); this.err.set(false);
    this.svc.recordQuality(this.store.id(), n.id, {
      status: 'pass', measurementValue: this.meas.value, measurementUnit: this.meas.unit || undefined,
      toleranceMin: this.meas.min ?? undefined, toleranceMax: this.meas.max ?? undefined, notes: this.meas.notes || undefined,
      stageId: this.selectedStageId || undefined,
    }).subscribe({
      next: (q) => {
        this.busy.set(false); this.measureOpen.set(false);
        this.meas = { value: null, unit: 'mm', min: null, max: null, notes: '' };
        this.msg.set(`Recorded ${q.status}${q.measurementValue != null ? ` (${q.measurementValue}${q.measurementUnit || ''})` : ''} for ${n.mark || n.name}.`);
        this.store.refreshQuality();
      },
      error: (e) => { this.busy.set(false); this.err.set(true); this.msg.set(e?.error?.message || 'Could not record.'); },
    });
  }

  // ── Overview rows ──
  private rows = computed<QaRow[]>(() => {
    const q = this.store.quality();
    if (!q) return [];
    const out: QaRow[] = [];
    for (const n of this.store.nodes()) {
      const e = q.nodes[n.id];
      if (!e || (e.total === 0 && e.openNcr === 0)) continue;
      const flagged = e.status === 'fail' || e.status === 'warning' || e.openNcr > 0;
      out.push({ node: n, q: e, flagged });
    }
    return out.sort((a, b) => (b.q.lastInspectedAt ?? '').localeCompare(a.q.lastInspectedAt ?? ''));
  });

  flagged = computed(() => this.rows().filter((r) => r.flagged));
  cleared = computed(() => this.rows().filter((r) => !r.flagged));

  typeLabel(t: string): string {
    return { group: 'Group', assembly: 'Assembly', subassembly: 'Sub-assembly', part: 'Part' }[t] ?? t;
  }

  inspect(node: AssemblyNode): void {
    this.router.navigate(['/projects', this.store.id(), 'assemblies'], { queryParams: { focus: node.id } });
  }
  goInspect(): void {
    this.router.navigate(['/projects', this.store.id(), 'assemblies']);
  }
}
