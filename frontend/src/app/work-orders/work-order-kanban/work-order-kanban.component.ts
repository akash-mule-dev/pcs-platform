import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Subscription, merge } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { RealtimeService } from '../../core/services/realtime.service';
import { ProjectsService, Project, ProductionOrder } from '../../core/services/projects.service';
import { TourLauncherComponent } from '../../shared/components/tour-launcher/tour-launcher.component';

/** Shapes returned by GET /api/work-orders/kanban (count-based, org-scoped). */
interface KanbanStageCol { name: string; sequence: number; }
interface KanbanCardStage {
  wosId: string; stageId: string; name: string; sequence: number; status: string;
  qtyDone: number; qtyTotal: number | null;
  assignedTo: string | null; station: string | null;
  isQuality: boolean; gateBlocked: boolean;
}
interface KanbanCard {
  workOrderId: string; orderNumber: string; woStatus: string; priority: string; quantity: number;
  mark: string | null; nodeName: string | null; profile: string | null;
  projectId: string | null; projectName: string | null;
  productionOrderId: string | null; productionOrderNumber: string | null; customerName: string | null;
  dueDate: string | null; late: boolean; openNcrs: number; updatedAt: string;
  overall: { unitsDone: number; unitsTotal: number; percent: number };
  currentStage: KanbanCardStage | null;
  revisionFlagged?: boolean; revisionStatus?: 'added' | 'changed' | null;
}
interface KanbanData {
  stages: KanbanStageCol[];
  cards: KanbanCard[];
  done: KanbanCard[];
  doneTotal: number;
  totals: { active: number; done: number; late: number; blocked: number; revised?: number };
}

/**
 * Stage Kanban — "where is every piece on the floor, right now."
 *
 * Columns are the process stages; each card is a work order (piece mark)
 * sitting at its FIRST INCOMPLETE stage, computed live from the count-based
 * stage rows — the same numbers as the order board and dashboard funnel.
 * Cards advance automatically as stage work is recorded: step pieces with +1
 * or complete the whole stage with ✓ (quality gates enforced server-side).
 */
@Component({
  selector: 'app-work-order-kanban',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, MatIconModule, MatTooltipModule, MatProgressSpinnerModule, TourLauncherComponent],
  template: `
    <div class="kb">
      <div class="head">
        <div>
          <h1>Stage Kanban</h1>
          <p class="sub">Every piece at its current stage — live from recorded stage counts. ✓ completes the stage, +1 steps one piece.</p>
        </div>
        <div class="head-links">
          <app-tour-launcher tourId="kanban" [auto]="true" tooltip="Tour the Kanban board"></app-tour-launcher>
          <a class="ghost" routerLink="/work-orders"><mat-icon>space_dashboard</mat-icon>Dashboard</a>
          <a class="ghost" routerLink="/work-orders/legacy"><mat-icon>inventory</mat-icon>All work orders</a>
        </div>
      </div>

      <!-- Filters + totals -->
      <div class="bar" data-tour="kanban-filters">
        <select class="sel" [ngModel]="projectId()" (ngModelChange)="setProject($event)">
          <option value="">All projects</option>
          @for (p of projects(); track p.id) { <option [value]="p.id">{{ p.name }}</option> }
        </select>
        <select class="sel" [ngModel]="orderId()" (ngModelChange)="setOrder($event)" [disabled]="!projectId()">
          <option value="">{{ projectId() ? 'All orders in project' : 'All orders' }}</option>
          @for (o of orders(); track o.id) { <option [value]="o.id">{{ o.number }}{{ o.customerName ? ' — ' + o.customerName : '' }}</option> }
        </select>
        <div class="search">
          <mat-icon>search</mat-icon>
          <input type="text" placeholder="Search mark, WO, order…" [ngModel]="q()" (ngModelChange)="setQuery($event)">
        </div>
        <span class="spacer"></span>
        @if (data(); as d) {
          <span class="tot"><strong>{{ d.totals.active }}</strong> in production</span>
          @if (d.totals.late > 0) { <span class="tot bad"><mat-icon>schedule</mat-icon><strong>{{ d.totals.late }}</strong> late</span> }
          @if (d.totals.blocked > 0) { <span class="tot bad"><mat-icon>report_problem</mat-icon><strong>{{ d.totals.blocked }}</strong> on hold</span> }
          @if ((d.totals.revised ?? 0) > 0) { <span class="tot warn"><mat-icon>difference</mat-icon><strong>{{ d.totals.revised }}</strong> revised</span> }
          <span class="tot ok"><strong>{{ d.doneTotal }}</strong> done</span>
        }
      </div>

      @if (error()) { <div class="toast"><mat-icon>error_outline</mat-icon>{{ error() }}<button (click)="error.set(null)"><mat-icon>close</mat-icon></button></div> }

      @if (!loaded()) {
        <div class="center"><mat-spinner diameter="36"></mat-spinner></div>
      } @else if (!data() || (data()!.stages.length === 0 && data()!.doneTotal === 0)) {
        <div class="empty-state">
          <mat-icon>view_kanban</mat-icon>
          <h3>Nothing in production</h3>
          <p>Release a production order from a project and its pieces will appear here, flowing stage by stage.</p>
          <a class="cta" routerLink="/work-orders" [queryParams]="{ newOrder: 1 }">New work order</a>
        </div>
      } @else {
        <div class="board" data-tour="kanban-board">
          @for (col of data()!.stages; track col.name) {
            <div class="col">
              <div class="col-head">
                <span class="col-title">{{ col.name }}</span>
                <span class="col-stats">
                  <span class="col-count">{{ colCards(col.name).length }}</span>
                  @if (colUnits(col.name); as u) { <span class="col-units" matTooltip="Pieces done / total at this stage">{{ u.done }}/{{ u.total }}</span> }
                </span>
              </div>
              <div class="col-body">
                @for (c of colCards(col.name); track c.workOrderId) {
                  <div class="card" [class.late]="c.late" [class.blocked]="c.currentStage?.gateBlocked" [class.revised]="c.revisionFlagged" (click)="open(c)">
                    <div class="c-top">
                      <span class="c-mark">{{ c.mark || c.orderNumber }}</span>
                      <span class="prio prio-{{ c.priority }}" [matTooltip]="'Priority: ' + c.priority"></span>
                      @if (c.late) { <span class="chip late"><mat-icon>schedule</mat-icon>late</span> }
                      @if (c.openNcrs > 0) { <span class="chip ncr" [matTooltip]="c.openNcrs + ' open NCR(s) — quality stage is gated'">{{ c.openNcrs }} NCR</span> }
                      @if (c.revisionFlagged) { <span class="chip revised" matTooltip="This piece was changed/removed in a newer package revision — review it (Monitoring tab)"><mat-icon>difference</mat-icon>revised</span> }
                    </div>
                    @if (c.nodeName || c.profile) { <div class="c-sub">{{ c.nodeName || '' }}{{ c.profile ? ' · ' + c.profile : '' }}</div> }
                    <div class="c-ctx">
                      @if (c.projectName) { <span>{{ c.projectName }}</span> }
                      @if (c.productionOrderNumber) { <span class="mono">{{ c.productionOrderNumber }}</span> }
                      @if (!c.productionOrderNumber) { <span class="mono">{{ c.orderNumber }}</span> }
                    </div>
                    @if (c.currentStage; as st) {
                      <div class="c-qty">
                        @if (st.qtyTotal != null) {
                          <div class="qbar"><div class="qfill" [style.width.%]="st.qtyTotal ? (100 * st.qtyDone / st.qtyTotal) : 0"></div></div>
                          <span class="qnum">{{ st.qtyDone }}/{{ st.qtyTotal }}</span>
                        } @else {
                          <div class="qbar"><div class="qfill" [style.width.%]="c.overall.percent"></div></div>
                          <span class="qnum">{{ c.overall.percent }}%</span>
                        }
                      </div>
                      @if (st.assignedTo || st.station) {
                        <div class="c-who">
                          @if (st.assignedTo) { <span><mat-icon>person</mat-icon>{{ st.assignedTo }}</span> }
                          @if (st.station) { <span><mat-icon>location_on</mat-icon>{{ st.station }}</span> }
                        </div>
                      }
                      <div class="c-actions" (click)="$event.stopPropagation()">
                        <span class="c-overall" matTooltip="Overall progress across all stages">{{ c.overall.percent }}%</span>
                        <span class="spacer"></span>
                        @if (canStep(c)) {
                          <button class="mini" (click)="step(c)" [disabled]="busy().has(c.workOrderId)" matTooltip="Record one more piece through {{ st.name }}">+1</button>
                        }
                        <button class="mini ok" (click)="complete(c)"
                                [disabled]="busy().has(c.workOrderId)"
                                [matTooltip]="st.gateBlocked ? 'Quality gate: open NCRs must be closed first' : 'Complete ' + st.name + ' for all pieces'">
                          @if (st.gateBlocked) { <mat-icon>lock</mat-icon> } @else { <mat-icon>check</mat-icon> }
                        </button>
                      </div>
                    }
                  </div>
                } @empty {
                  <div class="col-empty">Nothing at {{ col.name }}</div>
                }
              </div>
            </div>
          }

          <!-- Done column -->
          <div class="col done-col">
            <div class="col-head">
              <span class="col-title"><mat-icon class="done-ico">task_alt</mat-icon>Done</span>
              <span class="col-stats"><span class="col-count">{{ data()!.doneTotal }}</span></span>
            </div>
            <div class="col-body">
              @for (c of data()!.done; track c.workOrderId) {
                <div class="card done" (click)="open(c)">
                  <div class="c-top">
                    <span class="c-mark">{{ c.mark || c.orderNumber }}</span>
                    <mat-icon class="done-check">check_circle</mat-icon>
                  </div>
                  <div class="c-ctx">
                    @if (c.projectName) { <span>{{ c.projectName }}</span> }
                    <span class="mono">{{ c.productionOrderNumber || c.orderNumber }}</span>
                  </div>
                  <div class="c-overall sm">All stages complete</div>
                </div>
              } @empty {
                <div class="col-empty">Nothing finished yet</div>
              }
              @if (data()!.doneTotal > data()!.done.length) {
                <div class="col-empty">+ {{ data()!.doneTotal - data()!.done.length }} more</div>
              }
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .kb { max-width: 1500px; margin: 0 auto; }
    .head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 14px; flex-wrap: wrap; }
    .head h1 { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.02em; color: var(--clay-text); }
    .sub { margin: 4px 0 0; font-size: 13px; color: var(--clay-text-muted); }
    .head-links { display: flex; gap: 8px; }
    .head-links a { display: inline-flex; align-items: center; gap: 6px; border-radius: var(--clay-radius-sm); padding: 8px 14px; font-size: 13px; font-weight: 600; text-decoration: none; border: 1px solid var(--clay-border); background: var(--clay-surface); color: var(--clay-text-secondary); }
    .head-links a:hover { border-color: var(--clay-primary); color: var(--clay-primary); }
    .head-links a mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .center { display: flex; justify-content: center; padding: 64px 0; }
    .spacer { flex: 1; }

    /* Filter bar */
    .bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius); padding: 10px 14px; margin-bottom: 14px; }
    .sel { border: 1px solid var(--clay-border); border-radius: var(--clay-radius-xs); background: var(--clay-surface); color: var(--clay-text); padding: 7px 10px; font-size: 13px; font-family: inherit; max-width: 230px; }
    .search { display: flex; align-items: center; gap: 5px; border: 1px solid var(--clay-border); border-radius: var(--clay-radius-sm); padding: 6px 10px; }
    .search mat-icon { font-size: 17px; width: 17px; height: 17px; color: var(--clay-text-muted); }
    .search input { border: none; outline: none; background: transparent; font-size: 13px; color: var(--clay-text); font-family: inherit; width: 190px; }
    .tot { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; color: var(--clay-text-secondary); padding: 4px 10px; border-radius: 999px; background: var(--clay-bg-warm); }
    .tot strong { color: var(--clay-text); }
    .tot mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .tot.bad { background: var(--danger-bg); color: var(--danger-text); }
    .tot.bad strong { color: var(--danger-text); }
    .tot.ok { background: var(--success-bg); color: var(--success-text); }
    .tot.ok strong { color: var(--success-text); }
    .tot.warn { background: var(--warning-bg); color: var(--warning-text); }
    .tot.warn strong { color: var(--warning-text); }

    .toast { display: flex; align-items: center; gap: 8px; background: var(--danger-bg); color: var(--danger-text); border-radius: var(--clay-radius-sm); padding: 10px 14px; font-size: 13px; margin-bottom: 12px; }
    .toast button { margin-left: auto; border: none; background: none; color: inherit; cursor: pointer; display: flex; }
    .toast mat-icon { font-size: 18px; width: 18px; height: 18px; }

    /* Board */
    .board { display: flex; gap: 12px; align-items: flex-start; overflow-x: auto; padding-bottom: 16px; }
    .col { background: var(--clay-bg-warm); border: 1px solid var(--clay-border); border-radius: var(--clay-radius); min-width: 270px; width: 270px; flex-shrink: 0; display: flex; flex-direction: column; max-height: calc(100vh - 290px); }
    .done-col { background: var(--success-bg); }
    .col-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 12px 14px; border-bottom: 2px solid var(--clay-border); position: sticky; top: 0; }
    .col-title { font-size: 13px; font-weight: 700; color: var(--clay-text); display: inline-flex; align-items: center; gap: 6px; }
    .done-ico { font-size: 17px; width: 17px; height: 17px; color: var(--success-text); }
    .col-stats { display: inline-flex; align-items: center; gap: 6px; }
    .col-count { background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: 999px; padding: 1px 9px; font-size: 11.5px; font-weight: 700; color: var(--clay-text); }
    .col-units { font-size: 11px; color: var(--clay-text-muted); font-family: 'Space Grotesk', monospace; }
    .col-body { padding: 10px; display: flex; flex-direction: column; gap: 8px; overflow-y: auto; }
    .col-empty { text-align: center; padding: 18px 8px; color: var(--clay-text-muted); font-size: 12px; font-style: italic; }

    /* Cards */
    .card { background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius-sm); padding: 10px 12px; cursor: pointer; transition: box-shadow .15s, transform .15s, border-color .15s; }
    .card:hover { box-shadow: var(--clay-shadow-raised); transform: translateY(-1px); border-color: var(--clay-primary); }
    .card.late { border-left: 3px solid var(--warning-text); }
    .card.blocked { border-left: 3px solid var(--danger-text); }
    .card.done { opacity: .85; }
    .c-top { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .c-mark { font-size: 14px; font-weight: 700; color: var(--clay-text); font-family: 'Space Grotesk','Inter',sans-serif; }
    .prio { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .prio-low { background: var(--success-text); }
    .prio-medium { background: var(--clay-text-muted); }
    .prio-high { background: var(--warning-text); }
    .prio-urgent { background: var(--danger-text); }
    .chip { display: inline-flex; align-items: center; gap: 3px; border-radius: 999px; padding: 1px 7px; font-size: 10px; font-weight: 700; }
    .chip mat-icon { font-size: 12px; width: 12px; height: 12px; }
    .chip.late { background: var(--warning-bg); color: var(--warning-text); }
    .chip.ncr { background: var(--danger-bg); color: var(--danger-text); }
    .chip.revised { background: var(--warning-bg, #fff7e6); color: var(--warning-text, #9a6700); }
    .card.revised { border-left: 3px solid var(--warning, #f59e0b); }
    .c-sub { font-size: 12px; color: var(--clay-text-secondary); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .c-ctx { display: flex; gap: 8px; font-size: 11.5px; color: var(--clay-text-muted); margin-top: 3px; flex-wrap: wrap; }
    .c-ctx .mono { font-family: 'Space Grotesk', monospace; }
    .c-qty { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
    .qbar { flex: 1; height: 7px; border-radius: 5px; background: var(--clay-bg-warm); overflow: hidden; }
    .qfill { height: 100%; background: linear-gradient(90deg, var(--clay-primary), var(--clay-primary-light)); border-radius: 5px; transition: width .35s ease; }
    .qnum { font-size: 12px; font-weight: 700; color: var(--clay-text); font-family: 'Space Grotesk', monospace; }
    .c-who { display: flex; gap: 10px; margin-top: 6px; font-size: 11.5px; color: var(--clay-text-secondary); flex-wrap: wrap; }
    .c-who span { display: inline-flex; align-items: center; gap: 3px; }
    .c-who mat-icon { font-size: 13px; width: 13px; height: 13px; color: var(--clay-text-muted); }
    .c-actions { display: flex; align-items: center; gap: 6px; margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--clay-border); }
    .c-overall { font-size: 11px; color: var(--clay-text-muted); }
    .c-overall.sm { margin-top: 6px; display: block; }
    .mini { display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--clay-border); background: var(--clay-surface); color: var(--clay-text-secondary); border-radius: var(--clay-radius-xs); padding: 3px 9px; font-size: 12px; font-weight: 700; cursor: pointer; font-family: inherit; transition: all .15s; }
    .mini mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .mini:hover:not(:disabled) { border-color: var(--clay-primary); color: var(--clay-primary); }
    .mini.ok:hover:not(:disabled) { border-color: var(--success-text); color: var(--success-text); background: var(--success-bg); }
    .mini:disabled { opacity: .5; cursor: default; }
    .done-check { font-size: 17px; width: 17px; height: 17px; color: var(--success-text); margin-left: auto; }

    .empty-state { text-align: center; padding: 60px 20px; color: var(--clay-text-muted); background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius); }
    .empty-state mat-icon { font-size: 44px; width: 44px; height: 44px; opacity: .5; }
    .empty-state h3 { margin: 10px 0 4px; color: var(--clay-text); }
    .empty-state p { margin: 0 auto; font-size: 13px; max-width: 420px; }
    .cta { display: inline-flex; margin-top: 14px; background: var(--clay-primary); color: #fff; border-radius: var(--clay-radius-sm); padding: 9px 16px; font-size: 13px; font-weight: 600; text-decoration: none; }
  `],
})
export class WorkOrderKanbanComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  private svc = inject(ProjectsService);
  private realtime = inject(RealtimeService);
  private router = inject(Router);

  readonly data = signal<KanbanData | null>(null);
  readonly loaded = signal(false);
  readonly error = signal<string | null>(null);
  readonly busy = signal<Set<string>>(new Set());
  readonly projects = signal<Project[]>([]);
  readonly orders = signal<ProductionOrder[]>([]);
  readonly projectId = signal('');
  readonly orderId = signal('');
  readonly q = signal('');

  private rtSub?: Subscription;
  private pollTimer: any = null;
  private debounce: any = null;
  private queryDebounce: any = null;

  ngOnInit(): void {
    this.load();
    this.svc.list().subscribe({ next: (p) => this.projects.set(p), error: () => {} });
    // Live: any stage/WO change anywhere refreshes the board (debounced).
    this.rtSub = merge(
      this.realtime.on('work-order-update'),
      this.realtime.on('stage-update'),
    ).subscribe(() => {
      clearTimeout(this.debounce);
      this.debounce = setTimeout(() => this.load(true), 700);
    });
    this.pollTimer = setInterval(() => { if (!document.hidden) this.load(true); }, 30000);
  }

  ngOnDestroy(): void {
    this.rtSub?.unsubscribe();
    if (this.pollTimer) clearInterval(this.pollTimer);
    clearTimeout(this.debounce);
    clearTimeout(this.queryDebounce);
  }

  load(silent = false): void {
    if (!silent) this.loaded.set(false);
    const params: Record<string, string> = {};
    if (this.projectId()) params['projectId'] = this.projectId();
    if (this.orderId()) params['orderId'] = this.orderId();
    if (this.q().trim()) params['q'] = this.q().trim();
    this.api.get<KanbanData>('/work-orders/kanban', params).subscribe({
      next: (d) => { this.data.set(d); this.loaded.set(true); },
      error: (e) => { this.error.set(e?.error?.message || 'Could not load the board'); this.loaded.set(true); },
    });
  }

  // ── Filters ──
  setProject(id: string): void {
    this.projectId.set(id);
    this.orderId.set('');
    this.orders.set([]);
    if (id) this.svc.listOrders(id).subscribe({ next: (o) => this.orders.set(o), error: () => {} });
    this.load();
  }
  setOrder(id: string): void { this.orderId.set(id); this.load(); }
  setQuery(v: string): void {
    this.q.set(v);
    clearTimeout(this.queryDebounce);
    this.queryDebounce = setTimeout(() => this.load(true), 350);
  }

  // ── Column helpers ──
  colCards(stageName: string): KanbanCard[] {
    return (this.data()?.cards ?? []).filter((c) => c.currentStage?.name === stageName);
  }
  colUnits(stageName: string): { done: number; total: number } | null {
    const cards = this.colCards(stageName);
    if (!cards.length) return null;
    return {
      done: cards.reduce((a, c) => a + (c.currentStage?.qtyDone ?? 0), 0),
      total: cards.reduce((a, c) => a + (c.currentStage?.qtyTotal ?? 1), 0),
    };
  }

  // ── Actions (server enforces quality gates; errors surface in the toast) ──
  canStep(c: KanbanCard): boolean {
    const st = c.currentStage;
    return !!c.productionOrderId && !!st && st.qtyTotal != null && st.qtyTotal > 1 && st.qtyDone < st.qtyTotal - 0;
  }

  step(c: KanbanCard): void {
    const st = c.currentStage;
    if (!c.productionOrderId || !st) return;
    this.run(c, this.svc.setOrderStage(c.productionOrderId, st.wosId, { qtyDone: Math.min((st.qtyDone ?? 0) + 1, st.qtyTotal ?? 1) }));
  }

  complete(c: KanbanCard): void {
    const st = c.currentStage;
    if (!st) return;
    if (c.productionOrderId) {
      this.run(c, this.svc.setOrderStage(c.productionOrderId, st.wosId, { status: 'completed' }));
    } else {
      this.run(c, this.api.patch(`/work-orders/${c.workOrderId}/stages/${st.wosId}/status`, { status: 'completed' }));
    }
  }

  private run(c: KanbanCard, obs: { subscribe: Function }): void {
    const set = new Set(this.busy());
    set.add(c.workOrderId);
    this.busy.set(set);
    obs.subscribe({
      next: () => { this.unbusy(c); this.load(true); },
      error: (e: any) => { this.unbusy(c); this.error.set(e?.error?.message || 'Update failed'); this.load(true); },
    });
  }
  private unbusy(c: KanbanCard): void {
    const set = new Set(this.busy());
    set.delete(c.workOrderId);
    this.busy.set(set);
  }

  open(c: KanbanCard): void {
    if (c.productionOrderId) this.router.navigate(['/work-orders', c.productionOrderId]);
    else this.router.navigate(['/work-orders/legacy', c.workOrderId]);
  }
}
