import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { QualityReportsService, QualityReport, ReportTemplate } from '../core/services/quality-reports.service';
import { ProjectsService, DashboardOrderRow } from '../core/services/projects.service';

/**
 * QC Reports — every filled/in-progress report, filterable by work order.
 * Also the place to start a new report: pick a template + work order → a blank
 * report opens on the full-screen fill page.
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
          <p class="sub">Quality reports filled against work orders — from your drag-drop templates.</p>
        </div>
        <div class="head-links">
          <a class="ghost" routerLink="/templates"><mat-icon>dashboard_customize</mat-icon>Manage templates</a>
          <button class="primary" (click)="newOpen = !newOpen"><mat-icon>{{ newOpen ? 'close' : 'add' }}</mat-icon>{{ newOpen ? 'Cancel' : 'New report' }}</button>
        </div>
      </div>

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
            @for (s of statusFilters; track s.key) {
              <button class="fchip" [class.on]="statusFilter === s.key" (click)="setStatus(s.key)">{{ s.label }}</button>
            }
          </div>
          <div class="search">
            <mat-icon>search</mat-icon>
            <input type="text" placeholder="Search report, template, item…" [(ngModel)]="query">
          </div>
        </div>

        @if (loading) {
          <div class="center"><mat-spinner diameter="30"></mat-spinner></div>
        } @else {
          <div class="thead">
            <span>Report</span><span>Template</span><span>Work order</span><span>Project</span><span>Item</span><span>Status</span><span>Date</span><span></span>
          </div>
          @for (r of filtered(); track r.id) {
            <a class="trow" [routerLink]="['/qr', r.id]" target="_blank">
              <span class="t-num">{{ r.number }}</span>
              <span class="t-tpl">{{ r.templateName }}</span>
              <span class="t-wo">{{ r.orderNumber || '—' }}</span>
              <span class="t-proj">{{ r.projectName || '—' }}</span>
              <span class="t-item">{{ r.itemMark || '—' }}</span>
              <span><span class="pill st-{{ r.status }}">{{ r.status === 'submitted' ? 'Submitted' : 'Draft' }}</span></span>
              <span class="t-date">{{ (r.submittedAt || r.createdAt) | date:'MMM d, HH:mm' }}</span>
              <span class="t-open">Open<mat-icon>chevron_right</mat-icon></span>
            </a>
          } @empty {
            <div class="none">
              <mat-icon>fact_check</mat-icon>
              <p>{{ query || orderFilter || statusFilter ? 'No reports match.' : 'No reports yet — start one from a template above, or from the Quality tab of a work order.' }}</p>
            </div>
          }
        }
      </section>
    </div>
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
    .search { display: flex; align-items: center; gap: 5px; border: 1px solid var(--clay-border); border-radius: var(--clay-radius-sm); padding: 5px 9px; }
    .search mat-icon { font-size: 17px; width: 17px; height: 17px; color: var(--clay-text-muted); }
    .search input { border: none; outline: none; background: transparent; font-size: 13px; color: var(--clay-text); font-family: inherit; width: 200px; }

    .thead, .trow { display: grid; grid-template-columns: 1fr 1.5fr 1.1fr 1.3fr 0.9fr 100px 120px 70px; gap: 10px; align-items: center; padding: 10px 16px; }
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
    .t-date { font-size: 12px; color: var(--clay-text-muted); }
    .t-open { display: inline-flex; align-items: center; gap: 2px; font-size: 12px; font-weight: 600; color: var(--clay-primary); justify-content: flex-end; }
    .t-open mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .none { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 40px 0; color: var(--clay-text-muted); font-size: 13px; }
    .none mat-icon { font-size: 36px; width: 36px; height: 36px; opacity: .5; }
    @media (max-width: 900px) { .thead { display: none; } .trow { grid-template-columns: 1fr 1fr; } }
  `],
})
export class ReportsListComponent implements OnInit {
  private svc = inject(QualityReportsService);
  private projectsSvc = inject(ProjectsService);
  private router = inject(Router);

  reports: QualityReport[] = [];
  templates: ReportTemplate[] = [];
  orders: DashboardOrderRow[] = [];
  loading = true;

  query = '';
  orderFilter = '';
  statusFilter = '';
  readonly statusFilters = [
    { key: '', label: 'All' },
    { key: 'draft', label: 'Drafts' },
    { key: 'submitted', label: 'Submitted' },
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
    this.svc.list(this.orderFilter ? { productionOrderId: this.orderFilter } : undefined).subscribe({
      next: (r) => { this.reports = r; this.loading = false; },
      error: () => { this.loading = false; },
    });
  }

  applyFilters(): void { this.load(); }
  setStatus(s: string): void { this.statusFilter = this.statusFilter === s ? '' : s; }

  filtered(): QualityReport[] {
    let rows = this.reports;
    if (this.statusFilter) rows = rows.filter((r) => r.status === this.statusFilter);
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

  startReport(): void {
    if (!this.newTemplateId || !this.newOrderId || this.creating) return;
    this.creating = true; this.newError = null;
    this.svc.create({ templateId: this.newTemplateId, productionOrderId: this.newOrderId }).subscribe({
      next: (r) => { this.creating = false; this.router.navigate(['/qr', r.id]); },
      error: (e) => { this.creating = false; this.newError = e?.error?.message || 'Could not start the report.'; },
    });
  }
}
