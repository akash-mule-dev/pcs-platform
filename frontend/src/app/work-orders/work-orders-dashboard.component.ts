import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ProjectsService, OrdersDashboard, DashboardOrderRow, OrderStatus } from '../core/services/projects.service';

type Filter = 'all' | 'active' | 'planned' | 'in_progress' | 'completed' | 'late' | 'holds';

const STATUS_LABEL: Record<string, string> = {
  planned: 'Planned', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled',
};

/**
 * Work Orders dashboard — the shop-wide production cockpit: KPIs, the stage
 * funnel (where units are stuck), and every order with live progress. Each row
 * opens that order's workspace (board / progress / quality / shipping).
 */
@Component({
  selector: 'app-work-orders-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule],
  template: `
    <div class="page">
      <div class="head">
        <div>
          <h1>Work Orders</h1>
          <p class="sub">Production runs across every project — progress, bottlenecks and holds at a glance.</p>
        </div>
        <div class="head-links">
          <a class="ghost" routerLink="/work-orders/kanban"><mat-icon>view_kanban</mat-icon>Kanban</a>
          <a class="ghost" routerLink="/work-orders/legacy"><mat-icon>inventory</mat-icon>Product work orders</a>
          <a class="primary" routerLink="/projects"><mat-icon>add</mat-icon>New work order</a>
        </div>
      </div>

      @if (loading && !data) {
        <div class="center"><mat-spinner diameter="36"></mat-spinner></div>
      } @else if (!data) {
        <div class="empty-state"><mat-icon>receipt_long</mat-icon><h3>Couldn't load the dashboard</h3><p>{{ error || 'Try reloading.' }}</p></div>
      } @else {
        <!-- KPIs -->
        <div class="kpis">
          <button class="kpi" [class.on]="filter === 'active'" (click)="setFilter('active')">
            <div class="ki tone-blue"><mat-icon>bolt</mat-icon></div>
            <div class="kt"><span class="kn">{{ data.kpis.planned + data.kpis.inProgress }}</span><span class="kl">Active orders</span></div>
          </button>
          <div class="kpi static">
            <div class="ki tone-purple"><mat-icon>widgets</mat-icon></div>
            <div class="kt">
              <span class="kn">{{ data.kpis.unitsDone | number }}<em>/{{ data.kpis.unitsTotal | number }}</em></span>
              <span class="kl">Units done (active orders)</span>
              <span class="mini-bar"><span class="mini-fill" [style.width.%]="unitsPct()"></span></span>
            </div>
          </div>
          <button class="kpi" [class.on]="filter === 'late'" [class.alert]="data.kpis.late > 0" (click)="setFilter('late')">
            <div class="ki" [class.tone-green]="data.kpis.late === 0" [class.tone-danger]="data.kpis.late > 0"><mat-icon>schedule</mat-icon></div>
            <div class="kt"><span class="kn">{{ data.kpis.late }}</span><span class="kl">Late orders</span></div>
          </button>
          <button class="kpi" [class.on]="filter === 'holds'" [class.alert]="data.kpis.openNcrs > 0" (click)="setFilter('holds')">
            <div class="ki" [class.tone-green]="data.kpis.openNcrs === 0" [class.tone-danger]="data.kpis.openNcrs > 0"><mat-icon>report_problem</mat-icon></div>
            <div class="kt"><span class="kn">{{ data.kpis.openNcrs }}</span><span class="kl">Open NCRs</span></div>
          </button>
          <button class="kpi" [class.on]="filter === 'completed'" (click)="setFilter('completed')">
            <div class="ki tone-green"><mat-icon>task_alt</mat-icon></div>
            <div class="kt"><span class="kn">{{ data.kpis.completed }}</span><span class="kl">Completed</span></div>
          </button>
        </div>

        <div class="grid">
          <!-- Stage funnel -->
          <section class="card funnel">
            <div class="card-head"><h3>Stage funnel</h3><span class="hint">Units through each stage — active orders</span></div>
            @if (data.funnel.length === 0) {
              <p class="none">No active production right now.</p>
            } @else {
              @for (f of data.funnel; track f.sequence + f.name) {
                <div class="frow">
                  <span class="fname">{{ f.name }}</span>
                  <div class="fbar"><div class="ffill" [style.width.%]="f.percent"></div></div>
                  <span class="fnum">{{ f.done | number }}/{{ f.total | number }}</span>
                  <span class="fpct">{{ f.percent }}%</span>
                </div>
              }
            }
          </section>

          <!-- Needs attention -->
          <section class="card attention">
            <div class="card-head"><h3>Needs attention</h3></div>
            @if (attention().length === 0) {
              <p class="none"><mat-icon>task_alt</mat-icon>Nothing is late or on hold.</p>
            } @else {
              @for (o of attention(); track o.id) {
                <a class="att-row" [routerLink]="['/work-orders', o.id]">
                  <span class="att-num">{{ o.number }}</span>
                  <span class="att-proj">{{ o.project.name }}</span>
                  <span class="spacer"></span>
                  @if (o.late) { <span class="chip late"><mat-icon>schedule</mat-icon>late</span> }
                  @if (o.openNcrs > 0) { <span class="chip ncr">{{ o.openNcrs }} NCR</span> }
                </a>
              }
            }
          </section>
        </div>

        <!-- Orders table -->
        <section class="card table-card">
          <div class="table-tools">
            <div class="filters">
              @for (f of filters; track f.key) {
                <button class="fchip" [class.on]="filter === f.key" (click)="setFilter(f.key)">{{ f.label }}
                  @if (countFor(f.key) > 0) { <span class="fcount">{{ countFor(f.key) }}</span> }
                </button>
              }
            </div>
            <div class="search">
              <mat-icon>search</mat-icon>
              <input type="text" placeholder="Search order, project, customer…" [(ngModel)]="query">
            </div>
          </div>

          <div class="thead">
            <span>Order</span><span>Project</span><span>Customer</span><span class="num">Qty</span>
            <span class="num">Items</span><span>Progress</span><span>Status</span><span>Due</span>
          </div>
          @for (o of filtered(); track o.id) {
            <a class="trow" [routerLink]="['/work-orders', o.id]">
              <span class="t-num">{{ o.number }}
                @if (o.openNcrs > 0) { <span class="chip ncr sm" matTooltip="Open NCRs block the quality stage">{{ o.openNcrs }}</span> }
              </span>
              <span class="t-proj">{{ o.project.name }}</span>
              <span class="t-cust">{{ o.customerName || '—' }}</span>
              <span class="num">{{ o.quantity }}</span>
              <span class="num">{{ o.itemsDone }}/{{ o.items }}</span>
              <span class="t-prog">
                <span class="pbar"><span class="pfill" [class.full]="o.percent >= 100" [style.width.%]="o.percent"></span></span>
                <em>{{ o.percent }}%</em>
              </span>
              <span><span class="pill st-{{ o.status }}">{{ statusLabel(o.status) }}</span></span>
              <span class="t-due" [class.islate]="o.late">{{ o.dueDate ? (o.dueDate | date:'MMM d') : '—' }}
                @if (o.late) { <mat-icon class="late-ico">schedule</mat-icon> }
              </span>
            </a>
          } @empty {
            <div class="none table-none">
              <mat-icon>receipt_long</mat-icon>
              <p>{{ query || filter !== 'all' ? 'No orders match.' : 'No work orders yet — open a project and create one.' }}</p>
            </div>
          }
        </section>
      }
    </div>
  `,
  styles: [`
    .page { max-width: 1320px; margin: 0 auto; }
    .head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 18px; flex-wrap: wrap; }
    .head h1 { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.02em; color: var(--clay-text); }
    .sub { margin: 4px 0 0; font-size: 13px; color: var(--clay-text-muted); }
    .head-links { display: flex; gap: 8px; flex-wrap: wrap; }
    .head-links a { display: inline-flex; align-items: center; gap: 6px; border-radius: var(--clay-radius-sm); padding: 8px 14px; font-size: 13px; font-weight: 600; text-decoration: none; }
    .head-links a mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .head-links .ghost { border: 1px solid var(--clay-border); background: var(--clay-surface); color: var(--clay-text-secondary); }
    .head-links .ghost:hover { border-color: var(--clay-primary); color: var(--clay-primary); }
    .head-links .primary { background: var(--clay-primary); color: #fff; }
    .center { display: flex; justify-content: center; padding: 64px 0; }

    /* KPIs */
    .kpis { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 16px; }
    .kpi { display: flex; align-items: center; gap: 12px; background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius); padding: 14px 16px; box-shadow: var(--clay-shadow-soft); cursor: pointer; font-family: inherit; text-align: left; transition: border-color .15s; }
    .kpi.static { cursor: default; }
    .kpi:not(.static):hover, .kpi.on { border-color: var(--clay-primary); }
    .kpi.alert { border-color: var(--danger); }
    .ki { width: 40px; height: 40px; border-radius: var(--clay-radius-sm); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .ki mat-icon { font-size: 21px; width: 21px; height: 21px; }
    .tone-blue { background: var(--kpi-blue-bg); color: var(--kpi-blue-fg); }
    .tone-purple { background: var(--kpi-purple-bg, var(--info-bg)); color: var(--kpi-purple-fg, var(--clay-primary)); }
    .tone-green { background: var(--kpi-green-bg); color: var(--kpi-green-fg); }
    .tone-danger { background: var(--danger-bg); color: var(--danger); }
    .kt { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .kn { font-size: 21px; font-weight: 700; color: var(--clay-text); font-family: 'Space Grotesk','Inter',sans-serif; line-height: 1.05; }
    .kn em { font-style: normal; font-size: 13px; color: var(--clay-text-muted); font-weight: 500; }
    .kl { font-size: 11px; color: var(--clay-text-muted); }
    .mini-bar { display: block; height: 5px; border-radius: 4px; background: var(--clay-bg-warm); overflow: hidden; margin-top: 4px; width: 110px; }
    .mini-fill { display: block; height: 100%; background: linear-gradient(90deg, var(--clay-primary), var(--clay-primary-light)); border-radius: 4px; }

    .grid { display: grid; grid-template-columns: 1.6fr 1fr; gap: 12px; margin-bottom: 16px; }
    .card { background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius); padding: 16px 18px; box-shadow: var(--clay-shadow-soft); }
    .card-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 12px; }
    .card-head h3 { margin: 0; font-size: 14px; font-weight: 700; color: var(--clay-text); }
    .hint { font-size: 12px; color: var(--clay-text-muted); }
    .none { display: flex; align-items: center; gap: 6px; color: var(--clay-text-muted); font-size: 13px; margin: 8px 0; }
    .none mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--success); }

    /* Funnel */
    .frow { display: grid; grid-template-columns: 110px 1fr 90px 48px; align-items: center; gap: 10px; padding: 6px 0; }
    .fname { font-size: 12px; font-weight: 600; color: var(--clay-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .fbar { height: 14px; border-radius: 5px; background: var(--clay-bg-warm); overflow: hidden; }
    .ffill { height: 100%; background: linear-gradient(90deg, var(--clay-primary), var(--clay-primary-light)); border-radius: 5px; transition: width .5s ease; }
    .fnum { font-size: 12px; color: var(--clay-text-secondary); text-align: right; font-family: 'Space Grotesk', monospace; }
    .fpct { font-size: 12px; font-weight: 700; color: var(--clay-text); text-align: right; }

    /* Attention */
    .att-row { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid var(--clay-border); border-radius: var(--clay-radius-sm); margin-bottom: 7px; text-decoration: none; transition: border-color .15s; }
    .att-row:hover { border-color: var(--clay-primary); }
    .att-num { font-size: 13px; font-weight: 700; color: var(--clay-text); font-family: 'Space Grotesk', monospace; }
    .att-proj { font-size: 12px; color: var(--clay-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .spacer { flex: 1; }
    .chip { display: inline-flex; align-items: center; gap: 3px; border-radius: 999px; padding: 1px 8px; font-size: 11px; font-weight: 700; }
    .chip mat-icon { font-size: 13px; width: 13px; height: 13px; }
    .chip.late { background: var(--warning-bg); color: var(--warning-text); }
    .chip.ncr { background: var(--danger-bg); color: var(--danger-text); }
    .chip.sm { padding: 0 6px; font-size: 10px; }

    /* Table */
    .table-card { padding: 0; overflow: hidden; }
    .table-tools { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--clay-border); flex-wrap: wrap; }
    .filters { display: flex; gap: 6px; flex-wrap: wrap; }
    .fchip { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--clay-border); background: var(--clay-surface); color: var(--clay-text-secondary); border-radius: 999px; padding: 5px 12px; font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; }
    .fchip.on { background: var(--clay-primary); color: #fff; border-color: var(--clay-primary); }
    .fcount { background: rgba(255,255,255,.25); border-radius: 999px; padding: 0 6px; font-size: 10px; }
    .fchip:not(.on) .fcount { background: var(--clay-bg-warm); color: var(--clay-text-secondary); }
    .search { display: flex; align-items: center; gap: 5px; border: 1px solid var(--clay-border); border-radius: var(--clay-radius-sm); padding: 5px 9px; }
    .search mat-icon { font-size: 17px; width: 17px; height: 17px; color: var(--clay-text-muted); }
    .search input { border: none; outline: none; background: transparent; font-size: 13px; color: var(--clay-text); font-family: inherit; width: 210px; }

    .thead, .trow { display: grid; grid-template-columns: 1.1fr 1.3fr 1fr 50px 70px 1.2fr 110px 90px; gap: 10px; align-items: center; padding: 10px 16px; }
    .thead { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--clay-text-muted); border-bottom: 1px solid var(--clay-border); background: var(--clay-bg-warm); }
    .trow { border-bottom: 1px solid var(--clay-border); text-decoration: none; transition: background .12s; }
    .trow:hover { background: var(--clay-surface-hover); }
    .trow:last-child { border-bottom: none; }
    .t-num { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 700; color: var(--clay-text); font-family: 'Space Grotesk', monospace; }
    .t-proj, .t-cust { font-size: 13px; color: var(--clay-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .num { font-size: 13px; color: var(--clay-text); text-align: right; font-family: 'Space Grotesk', monospace; }
    .t-prog { display: flex; align-items: center; gap: 8px; }
    .pbar { flex: 1; height: 8px; border-radius: 5px; background: var(--clay-bg-warm); overflow: hidden; }
    .pfill { display: block; height: 100%; background: linear-gradient(90deg, var(--clay-primary), var(--clay-primary-light)); border-radius: 5px; transition: width .4s ease; }
    .pfill.full { background: var(--success); }
    .t-prog em { font-style: normal; font-size: 12px; font-weight: 700; color: var(--clay-text); min-width: 40px; text-align: right; }
    .pill { padding: 2px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; white-space: nowrap; }
    .st-planned { background: var(--badge-draft-bg); color: var(--badge-draft-text); }
    .st-in_progress { background: var(--warning-bg); color: var(--warning-text); }
    .st-completed { background: var(--success-bg); color: var(--success-text); }
    .st-cancelled { background: var(--danger-bg); color: var(--danger-text); }
    .t-due { display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--clay-text-secondary); }
    .t-due.islate { color: var(--danger-text); font-weight: 700; }
    .late-ico { font-size: 15px; width: 15px; height: 15px; }
    .table-none { flex-direction: column; padding: 36px 0; justify-content: center; }
    .table-none mat-icon { font-size: 36px; width: 36px; height: 36px; color: var(--clay-text-muted); opacity: .5; }

    @media (max-width: 1000px) { .kpis { grid-template-columns: repeat(2, 1fr); } .grid { grid-template-columns: 1fr; } .thead { display: none; } .trow { grid-template-columns: 1fr 1fr; } }
  `],
})
export class WorkOrdersDashboardComponent implements OnInit, OnDestroy {
  private svc = inject(ProjectsService);

  data: OrdersDashboard | null = null;
  loading = true;
  error: string | null = null;
  query = '';
  filter: Filter = 'all';

  readonly filters: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'active', label: 'Active' },
    { key: 'planned', label: 'Planned' },
    { key: 'in_progress', label: 'In progress' },
    { key: 'late', label: 'Late' },
    { key: 'holds', label: 'Quality holds' },
    { key: 'completed', label: 'Completed' },
  ];

  private pollTimer: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    this.load();
    this.pollTimer = setInterval(() => { if (!document.hidden) this.refresh(); }, 30000);
  }
  ngOnDestroy(): void { if (this.pollTimer) clearInterval(this.pollTimer); }

  load(): void {
    this.loading = true;
    this.svc.ordersDashboard().subscribe({
      next: (d) => { this.data = d; this.loading = false; },
      error: (e) => { this.error = e?.error?.message || null; this.loading = false; },
    });
  }
  private refresh(): void {
    this.svc.ordersDashboard().subscribe({ next: (d) => (this.data = d), error: () => {} });
  }

  setFilter(f: Filter): void { this.filter = this.filter === f ? 'all' : f; }

  unitsPct(): number {
    const k = this.data?.kpis;
    return k && k.unitsTotal > 0 ? Math.min(100, (k.unitsDone / k.unitsTotal) * 100) : 0;
  }

  attention(): DashboardOrderRow[] {
    return (this.data?.orders ?? []).filter((o) => (o.late || o.openNcrs > 0) && o.status !== 'completed' && o.status !== 'cancelled').slice(0, 6);
  }

  countFor(f: Filter): number {
    const rows = this.data?.orders ?? [];
    switch (f) {
      case 'all': return rows.length;
      case 'active': return rows.filter((o) => o.status === 'planned' || o.status === 'in_progress').length;
      case 'planned': return rows.filter((o) => o.status === 'planned').length;
      case 'in_progress': return rows.filter((o) => o.status === 'in_progress').length;
      case 'completed': return rows.filter((o) => o.status === 'completed').length;
      case 'late': return rows.filter((o) => o.late).length;
      case 'holds': return rows.filter((o) => o.openNcrs > 0).length;
    }
  }

  filtered(): DashboardOrderRow[] {
    let rows = this.data?.orders ?? [];
    switch (this.filter) {
      case 'active': rows = rows.filter((o) => o.status === 'planned' || o.status === 'in_progress'); break;
      case 'planned': rows = rows.filter((o) => o.status === 'planned'); break;
      case 'in_progress': rows = rows.filter((o) => o.status === 'in_progress'); break;
      case 'completed': rows = rows.filter((o) => o.status === 'completed'); break;
      case 'late': rows = rows.filter((o) => o.late); break;
      case 'holds': rows = rows.filter((o) => o.openNcrs > 0); break;
    }
    const term = this.query.trim().toLowerCase();
    if (term) {
      rows = rows.filter((o) =>
        o.number.toLowerCase().includes(term)
        || o.project.name.toLowerCase().includes(term)
        || (o.customerName ?? '').toLowerCase().includes(term)
        || (o.project.number ?? '').toLowerCase().includes(term));
    }
    return rows;
  }

  statusLabel(s: OrderStatus): string { return STATUS_LABEL[s] ?? s; }
}
