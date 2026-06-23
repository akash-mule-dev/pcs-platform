import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { QualityReportsService, QualityReport, ReportTemplate } from '../core/services/quality-reports.service';
import { ProjectsService, DashboardOrderRow } from '../core/services/projects.service';
import { ToastService } from '../core/services/toast.service';

/**
 * QC Reports dashboard — every filled/in-progress report & NCR. Items needing
 * action (open NCRs + drafts) are grouped first; submitted reports and
 * closed/cancelled NCRs fall to the history below. Filter by work order, report
 * TYPE, and (for NCRs) lifecycle STATE. Also the place to start a new report.
 */
@Component({
  selector: 'app-reports-list',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <div class="page">
      <div class="head">
        <div>
          <h1>QC Reports</h1>
          <p class="sub">Inspection reports & non-conformances filled against work orders — from your drag-drop templates.</p>
        </div>
        <div class="head-links">
          <a class="ghost" routerLink="/templates"><mat-icon>dashboard_customize</mat-icon>Manage templates</a>
          <button class="primary" (click)="newOpen = !newOpen"><mat-icon>{{ newOpen ? 'close' : 'add' }}</mat-icon>{{ newOpen ? 'Cancel' : 'New report' }}</button>
        </div>
      </div>

      <!-- Summary / releasability strip -->
      @if (!loading && !error) {
        <section class="kpis">
          <div class="kpi"><span class="k-num">{{ reports.length }}</span><span class="k-lbl">Reports</span></div>
          <div class="kpi" [class.bad]="stats.openNcrs > 0">
            <span class="k-num">{{ stats.openNcrs }}</span><span class="k-lbl">Open NCRs</span>
          </div>
          <div class="kpi" [class.warn]="stats.drafts > 0"><span class="k-num">{{ stats.drafts }}</span><span class="k-lbl">Drafts</span></div>
          <div class="kpi"><span class="k-num">{{ stats.submitted }}</span><span class="k-lbl">Submitted</span></div>
          <div class="rel" [class.bad]="stats.openNcrs > 0" [class.ok]="stats.openNcrs === 0">
            <mat-icon>{{ stats.openNcrs > 0 ? 'gpp_maybe' : 'verified_user' }}</mat-icon>
            {{ stats.openNcrs > 0 ? (stats.openNcrs + ' open non-conformance' + (stats.openNcrs === 1 ? '' : 's') + ' to clear') : 'No open non-conformances' }}
          </div>
        </section>
      }

      @if (newOpen) {
        <section class="card new-card">
          <div class="new-row">
            <label>Template
              <select [(ngModel)]="newTemplateId">
                <option value="">— pick a template —</option>
                @for (t of templates; track t.id) { <option [value]="t.id">{{ t.name }} ({{ t.type }})</option> }
              </select>
            </label>
            <label>Work order
              <select [(ngModel)]="newOrderId">
                <option value="">— pick a work order —</option>
                @for (o of orders; track o.id) { <option [value]="o.id">{{ o.number }} — {{ o.project.name }}@if (o.customerName) { ({{ o.customerName }}) }</option> }
              </select>
            </label>
            <button class="primary start" [disabled]="creating || !newTemplateId || !newOrderId" (click)="startReport()">
              <mat-icon>play_arrow</mat-icon>{{ creating ? 'Starting…' : 'Start & fill' }}
            </button>
          </div>
          @if (templates.length === 0) { <p class="hint warn">No templates yet — <a routerLink="/templates">create one with the drag-drop builder</a> first.</p> }
          @if (newError) { <p class="hint err">{{ newError }}</p> }
        </section>
      }

      <section class="card table-card">
        <div class="tools">
          <div class="filters">
            <select class="wo-filter" [(ngModel)]="orderFilter" (ngModelChange)="applyFilters()">
              <option value="">All work orders</option>
              @for (o of orders; track o.id) { <option [value]="o.id">{{ o.number }} — {{ o.project.name }}</option> }
            </select>
            @for (t of typeFilters; track t.key) {
              <button class="fchip" [class.on]="typeFilter === t.key" (click)="setType(t.key)">{{ t.label }}</button>
            }
          </div>
          <div class="search">
            <mat-icon>search</mat-icon>
            <input type="text" placeholder="Search report, template, item…" [(ngModel)]="query">
          </div>
        </div>
        <!-- Context state chips: NCR lifecycle when type=NCR, else draft/submitted -->
        <div class="states">
          @for (s of stateFilters(); track s.key) {
            <button class="schip" [class.on]="stateFilter === s.key" (click)="setState(s.key)">{{ s.label }}</button>
          }
        </div>

        @if (loading) {
          <div class="center"><mat-spinner diameter="30"></mat-spinner></div>
        } @else if (error) {
          <div class="none" role="alert">
            <mat-icon class="err-ico">error_outline</mat-icon>
            <p>{{ error }}</p>
            <button class="fchip" (click)="load()" aria-label="Retry loading reports"><mat-icon>refresh</mat-icon> Retry</button>
          </div>
        } @else {
          <div class="thead">
            <span>Report</span><span>Template</span><span>Work order</span><span>Project</span><span>Item</span><span>Status</span><span>Date</span><span></span>
          </div>

          @if (attention().length) {
            <div class="grp grp-attn"><mat-icon>priority_high</mat-icon> Needs attention ({{ attention().length }})</div>
            @for (r of attention(); track r.id) { <ng-container *ngTemplateOutlet="row; context: { $implicit: r }"></ng-container> }
          }
          @if (history().length) {
            <div class="grp">History ({{ history().length }})</div>
            @for (r of history(); track r.id) { <ng-container *ngTemplateOutlet="row; context: { $implicit: r }"></ng-container> }
          }
          @if (!attention().length && !history().length) {
            <div class="none">
              <mat-icon>fact_check</mat-icon>
              <p>{{ query || orderFilter || typeFilter || stateFilter ? 'No reports match these filters.' : 'No reports yet — start one from a template above, or from the Quality tab of a work order.' }}</p>
            </div>
          }
        }
      </section>
    </div>

    <ng-template #row let-r>
      <a class="trow" [routerLink]="['/qr', r.id]" target="_blank">
        <span class="t-num">{{ r.number }}</span>
        <span class="t-tpl">{{ r.templateName }}@if (r.templateType === 'ncr') { <span class="ncr-tag">NCR</span> }</span>
        <span class="t-wo">{{ r.orderNumber || '—' }}</span>
        <span class="t-proj">{{ r.projectName || '—' }}</span>
        <span class="t-item">{{ r.itemMark || '—' }}</span>
        @if (r.templateType === 'ncr') {
          <span class="ncr-cell">
            <span class="pill ncr-{{ ncrKey(r) }}">{{ ncrLabel(r) }}</span>
            @if (severity(r); as sev) { <span class="sev sev-{{ sev.toLowerCase() }}">{{ sev }}</span> }
            @if (r.disposition && !r.resolvedAt) { <span class="disp-chip">{{ dispShort(r.disposition) }}</span> }
          </span>
        } @else {
          <span><span class="pill st-{{ r.status }}">{{ r.status === 'submitted' ? 'Submitted' : 'Draft' }}</span></span>
        }
        <span class="t-date">{{ (r.submittedAt || r.createdAt) | date:'MMM d, HH:mm' }}</span>
        <span class="t-open">Open<mat-icon>chevron_right</mat-icon></span>
      </a>
    </ng-template>
  `,
  styles: [`
    .page { max-width: 1320px; margin: 0 auto; }
    .head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 16px; flex-wrap: wrap; }
    .head h1 { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.02em; color: var(--clay-text); }
    .sub { margin: 4px 0 0; font-size: 13px; color: var(--clay-text-muted); }
    .head-links { display: flex; gap: 8px; }
    .head-links a, .head-links button { display: inline-flex; align-items: center; gap: 6px; border-radius: var(--clay-radius-sm); padding: 8px 14px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; text-decoration: none; }
    .head-links mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .ghost { border: 1px solid var(--clay-border); background: var(--clay-surface); color: var(--clay-text-secondary); }
    .ghost:hover { border-color: var(--clay-primary); color: var(--clay-primary); }
    .primary { background: var(--clay-primary); color: #fff; border: none; }
    .primary:disabled { opacity: .55; cursor: default; }
    .center { display: flex; justify-content: center; padding: 48px 0; }

    .kpis { display: flex; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; align-items: stretch; }
    .kpi { background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius); padding: 10px 16px; display: flex; flex-direction: column; min-width: 92px; box-shadow: var(--clay-shadow-soft); }
    .kpi .k-num { font-size: 22px; font-weight: 800; color: var(--clay-text); font-family: 'Space Grotesk', monospace; line-height: 1.1; }
    .kpi .k-lbl { font-size: 11px; font-weight: 600; color: var(--clay-text-muted); text-transform: uppercase; letter-spacing: .05em; margin-top: 2px; }
    .kpi.bad .k-num { color: var(--danger-text); }
    .kpi.warn .k-num { color: var(--warning-text); }
    .rel { display: inline-flex; align-items: center; gap: 8px; border-radius: var(--clay-radius); padding: 10px 16px; font-size: 13px; font-weight: 700; flex: 1; min-width: 200px; }
    .rel mat-icon { font-size: 20px; width: 20px; height: 20px; }
    .rel.ok { background: var(--success-bg); color: var(--success-text); }
    .rel.bad { background: var(--danger-bg); color: var(--danger-text); }

    .card { background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius); box-shadow: var(--clay-shadow-soft); }
    .new-card { padding: 14px 16px; margin-bottom: 14px; }
    .new-row { display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap; }
    .new-row label { display: flex; flex-direction: column; gap: 5px; font-size: 12px; font-weight: 600; color: var(--clay-text-secondary); min-width: 240px; flex: 1; max-width: 380px; }
    .new-row select { border: 1px solid var(--clay-border); border-radius: var(--clay-radius-xs); background: var(--clay-surface); color: var(--clay-text); padding: 9px 10px; font-size: 13px; font-family: inherit; }
    .start { padding: 9px 16px; }
    .hint { margin: 10px 0 0; font-size: 12px; color: var(--clay-text-muted); }
    .hint a { color: var(--clay-primary); font-weight: 600; }
    .hint.warn { color: var(--warning-text); }
    .hint.err { color: var(--danger-text); }

    .table-card { overflow: hidden; }
    .tools { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--clay-border); flex-wrap: wrap; }
    .filters { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .wo-filter { border: 1px solid var(--clay-border); border-radius: var(--clay-radius-sm); background: var(--clay-surface); color: var(--clay-text); padding: 7px 10px; font-size: 13px; font-family: inherit; max-width: 320px; }
    .fchip { border: 1px solid var(--clay-border); background: var(--clay-surface); color: var(--clay-text-secondary); border-radius: 999px; padding: 5px 12px; font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; }
    .fchip.on { background: var(--clay-primary); color: #fff; border-color: var(--clay-primary); }
    .states { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; padding: 10px 16px; border-bottom: 1px solid var(--clay-border); background: var(--clay-bg-warm); }
    .schip { border: 1px solid transparent; background: transparent; color: var(--clay-text-muted); border-radius: 999px; padding: 4px 11px; font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; }
    .schip.on { background: var(--clay-surface); color: var(--clay-text); border-color: var(--clay-border); }
    .search { display: flex; align-items: center; gap: 5px; border: 1px solid var(--clay-border); border-radius: var(--clay-radius-sm); padding: 5px 9px; }
    .search mat-icon { font-size: 17px; width: 17px; height: 17px; color: var(--clay-text-muted); }
    .search input { border: none; outline: none; background: transparent; font-size: 13px; color: var(--clay-text); font-family: inherit; width: 200px; }

    .grp { display: flex; align-items: center; gap: 6px; padding: 9px 16px; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .06em; color: var(--clay-text-muted); background: var(--clay-bg-warm); border-bottom: 1px solid var(--clay-border); }
    .grp mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .grp-attn { color: var(--danger-text); }

    .thead, .trow { display: grid; grid-template-columns: 1fr 1.5fr 1.1fr 1.3fr 0.9fr 130px 120px 70px; gap: 10px; align-items: center; padding: 10px 16px; }
    .thead { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--clay-text-muted); border-bottom: 1px solid var(--clay-border); background: var(--clay-bg-warm); }
    .trow { border-bottom: 1px solid var(--clay-border); text-decoration: none; transition: background .12s; }
    .trow:hover { background: var(--clay-surface-hover); }
    .trow:last-child { border-bottom: none; }
    .t-num { font-size: 13px; font-weight: 700; color: var(--clay-text); font-family: 'Space Grotesk', monospace; }
    .t-wo { font-size: 13px; color: var(--clay-text); font-family: 'Space Grotesk', monospace; }
    .t-tpl, .t-proj, .t-item { font-size: 13px; color: var(--clay-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pill { padding: 2px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; }
    .st-draft { background: var(--warning-bg); color: var(--warning-text); }
    .st-submitted { background: var(--success-bg); color: var(--success-text); }
    .ncr-cell { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .ncr-open { background: var(--danger-bg); color: var(--danger-text); }
    .ncr-under_review { background: var(--info-bg); color: var(--info-text); }
    .ncr-dispositioned { background: #ede9fe; color: #6d28d9; }
    .ncr-closed { background: var(--success-bg); color: var(--success-text); }
    .ncr-cancelled { background: var(--clay-bg-warm); color: var(--clay-text-muted); }
    .sev { padding: 1px 7px; border-radius: 5px; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: .03em; }
    .sev-critical, .sev-high { background: var(--danger-bg); color: var(--danger-text); }
    .sev-medium { background: var(--warning-bg); color: var(--warning-text); }
    .sev-low { background: var(--clay-bg-warm); color: var(--clay-text-secondary); }
    .disp-chip { padding: 1px 7px; border-radius: 5px; font-size: 10px; font-weight: 700; background: var(--clay-bg-warm); color: var(--clay-text-secondary); border: 1px solid var(--clay-border); }
    .ncr-tag { display: inline-block; margin-left: 6px; padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 700; background: var(--danger-bg); color: var(--danger-text); vertical-align: middle; }
    .t-date { font-size: 12px; color: var(--clay-text-muted); }
    .t-open { display: inline-flex; align-items: center; gap: 2px; font-size: 12px; font-weight: 600; color: var(--clay-primary); justify-content: flex-end; }
    .t-open mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .none { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 40px 0; color: var(--clay-text-muted); font-size: 13px; }
    .none mat-icon { font-size: 36px; width: 36px; height: 36px; opacity: .5; }
    .none .err-ico { color: var(--danger); opacity: 1; }
    .none .fchip { display: inline-flex; align-items: center; gap: 4px; min-height: 40px; margin-top: 4px; }
    .none .fchip mat-icon { font-size: 16px; width: 16px; height: 16px; opacity: 1; }
    @media (max-width: 760px) {
      .thead { display: none; }
      .trow { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; padding: 12px 14px; }
      .trow > span { font-size: 12.5px; }
      .t-num { font-weight: 700; font-size: 14px; flex: 1 1 auto; }
      .t-tpl, .t-wo, .t-proj, .t-item, .t-date { white-space: normal; }
      .t-proj, .t-item, .t-date { color: var(--clay-text-muted); }
      .t-open { margin-left: auto; }
    }
  `],
})
export class ReportsListComponent implements OnInit {
  private svc = inject(QualityReportsService);
  private projectsSvc = inject(ProjectsService);
  private router = inject(Router);
  private toast = inject(ToastService);

  reports: QualityReport[] = [];
  templates: ReportTemplate[] = [];
  orders: DashboardOrderRow[] = [];
  loading = true;
  error: string | null = null;

  query = '';
  orderFilter = '';
  typeFilter = '';
  stateFilter = '';
  readonly typeFilters = [
    { key: '', label: 'All' },
    { key: 'inspection', label: 'Inspection' },
    { key: 'ncr', label: 'NCR' },
    { key: 'checklist', label: 'Checklist' },
    { key: 'other', label: 'Other' },
  ];

  newOpen = false;
  newTemplateId = '';
  newOrderId = '';
  creating = false;
  newError: string | null = null;

  ngOnInit(): void {
    this.svc.listTemplates().subscribe({ next: (t) => (this.templates = t), error: () => {} });
    this.projectsSvc.ordersDashboard().subscribe({ next: (d) => (this.orders = d.orders), error: () => {} });
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error = null;
    this.svc.list(this.orderFilter ? { productionOrderId: this.orderFilter } : undefined).subscribe({
      next: (r) => { this.reports = r; this.loading = false; },
      error: () => { this.loading = false; this.error = 'Could not load reports. Check your connection and try again.'; },
    });
  }

  applyFilters(): void { this.load(); }
  setType(t: string): void { this.typeFilter = this.typeFilter === t ? '' : t; this.stateFilter = ''; }
  setState(s: string): void { this.stateFilter = this.stateFilter === s ? '' : s; }

  /** Context state chips: NCR lifecycle states when filtering NCRs, else draft/submitted. */
  stateFilters(): { key: string; label: string }[] {
    if (this.typeFilter === 'ncr') {
      return [
        { key: '', label: 'All' },
        { key: 'open', label: 'Open' },
        { key: 'under_review', label: 'Under review' },
        { key: 'dispositioned', label: 'Dispositioned' },
        { key: 'closed', label: 'Closed' },
        { key: 'cancelled', label: 'Cancelled' },
      ];
    }
    return [
      { key: '', label: 'All' },
      { key: 'draft', label: 'Drafts' },
      { key: 'submitted', label: 'Submitted' },
    ];
  }

  get stats(): { total: number; openNcrs: number; drafts: number; submitted: number } {
    let openNcrs = 0, drafts = 0, submitted = 0;
    for (const r of this.reports) {
      if (r.templateType === 'ncr' && !r.resolvedAt) openNcrs++;
      if (r.status === 'draft') drafts++; else if (r.status === 'submitted') submitted++;
    }
    return { total: this.reports.length, openNcrs, drafts, submitted };
  }

  private typeKey(r: QualityReport): string {
    const t = (r.templateType ?? '').toLowerCase();
    return ['inspection', 'ncr', 'checklist'].includes(t) ? t : 'other';
  }
  isNcr(r: QualityReport): boolean { return (r.templateType ?? '') === 'ncr'; }
  private isOpenNcr(r: QualityReport): boolean { return this.isNcr(r) && !r.resolvedAt; }
  private needsAttention(r: QualityReport): boolean { return this.isOpenNcr(r) || r.status === 'draft'; }

  ncrKey(r: QualityReport): string { return r.ncrStatus || (r.resolvedAt ? 'closed' : 'open'); }
  ncrLabel(r: QualityReport): string {
    return ({ open: 'Open NCR', under_review: 'Under review', dispositioned: 'Dispositioned', closed: 'Closed', cancelled: 'Cancelled' } as Record<string, string>)[this.ncrKey(r)] ?? 'Open NCR';
  }
  dispShort(d: string | null): string {
    return ({ rework: 'Rework', repair: 'Repair', use_as_is: 'Use as-is', scrap: 'Scrap', return_to_supplier: 'Return' } as Record<string, string>)[d ?? ''] ?? (d ?? '');
  }
  severity(r: QualityReport): string | null {
    const raw = r.data && typeof r.data === 'object' ? (r.data as any)['severity'] : null;
    if (raw == null) return null;
    const s = String(raw).trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : null;
  }

  private filtered(): QualityReport[] {
    let rows = this.reports;
    if (this.typeFilter) rows = rows.filter((r) => this.typeKey(r) === this.typeFilter);
    if (this.stateFilter) {
      rows = rows.filter((r) => (this.typeFilter === 'ncr' ? this.ncrKey(r) === this.stateFilter : r.status === this.stateFilter));
    }
    const term = this.query.trim().toLowerCase();
    if (term) {
      rows = rows.filter((r) =>
        r.number.toLowerCase().includes(term)
        || r.templateName.toLowerCase().includes(term)
        || (r.orderNumber ?? '').toLowerCase().includes(term)
        || (r.projectName ?? '').toLowerCase().includes(term)
        || (r.itemMark ?? '').toLowerCase().includes(term));
    }
    return rows;
  }

  attention(): QualityReport[] { return this.filtered().filter((r) => this.needsAttention(r)); }
  history(): QualityReport[] { return this.filtered().filter((r) => !this.needsAttention(r)); }

  startReport(): void {
    if (!this.newTemplateId || !this.newOrderId || this.creating) return;
    this.creating = true; this.newError = null;
    this.svc.create({ templateId: this.newTemplateId, productionOrderId: this.newOrderId }).subscribe({
      next: (r) => { this.creating = false; this.toast.success(`Report ${r.number} started`); this.router.navigate(['/qr', r.id]); },
      error: (e) => { this.creating = false; this.newError = e?.error?.message || 'Could not start the report.'; },
    });
  }
}
