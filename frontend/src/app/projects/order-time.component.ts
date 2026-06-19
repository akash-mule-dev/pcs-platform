import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TimeTrackingService, OrderTime } from '../core/services/time-tracking.service';
import { WorkOrderTimeComponent } from '../time-tracking/work-order-time.component';

/**
 * Order "Time & Labor" tab — labor logged across the order's work orders, who is
 * costing what. Lists each assembly's work order with its logged hours + labor
 * cost; expand a row to log / edit / delete entries inline (the shared per-WO
 * panel). The numbers reconcile with the Costs tab's clocked labor.
 */
@Component({
  selector: 'app-order-time',
  standalone: true,
  imports: [CommonModule, RouterModule, MatIconModule, MatProgressSpinnerModule, WorkOrderTimeComponent],
  template: `
    @if (loading) {
      <div class="center"><mat-spinner diameter="32"></mat-spinner></div>
    } @else if (error) {
      <p class="banner err"><mat-icon>error</mat-icon>{{ error }} <button class="link" (click)="load()">Retry</button></p>
    } @else if (data) {

      <p class="hint"><mat-icon>schedule</mat-icon>Labor logged against each assembly's work order. Expand a row to view stages, workers and to add or correct entries. Rates feed the <a [routerLink]="['../costs']">Costs tab</a>.</p>

      <div class="cards">
        <div class="card">
          <div class="c-label"><mat-icon>engineering</mat-icon>Labor logged</div>
          <div class="c-actual">{{ data.totals.laborCost | currency:data.currency }}</div>
          <div class="c-est">{{ data.totals.laborHours | number:'1.0-1' }} h · {{ data.totals.entries }} entr{{ data.totals.entries === 1 ? 'y' : 'ies' }}</div>
        </div>
        @if (data.totals.machineCost > 0) {
          <div class="card">
            <div class="c-label"><mat-icon>precision_manufacturing</mat-icon>Machine</div>
            <div class="c-actual">{{ data.totals.machineCost | currency:data.currency }}</div>
            <div class="c-est">work-center time</div>
          </div>
        }
        <div class="card">
          <div class="c-label"><mat-icon>widgets</mat-icon>Work orders</div>
          <div class="c-actual">{{ data.workOrders.length }}</div>
          <div class="c-est">{{ withTimeCount }} with logged time</div>
        </div>
      </div>

      @if (data.workOrders.length === 0) {
        <p class="muted pad">No work orders on this order yet.</p>
      } @else {
        <div class="wo-list">
          @for (wo of data.workOrders; track wo.workOrderId) {
            <div class="wo">
              <button class="wo-head" (click)="toggle(wo.workOrderId)">
                <mat-icon class="chev">{{ expandedId === wo.workOrderId ? 'expand_more' : 'chevron_right' }}</mat-icon>
                <span class="mark">{{ wo.mark }}</span>
                <span class="num">{{ wo.orderNumber }}</span>
                <span class="chip st-{{ wo.status }}">{{ wo.status.replace('_', ' ') }}</span>
                <span class="grow"></span>
                <span class="metric">{{ wo.loggedHours | number:'1.0-1' }} h</span>
                <span class="metric">{{ wo.workers }} wkr</span>
                <span class="metric strong">{{ wo.laborCost | currency:data.currency }}</span>
              </button>
              @if (expandedId === wo.workOrderId) {
                <div class="wo-body">
                  <app-work-order-time [workOrderId]="wo.workOrderId" (changed)="load(true)"></app-work-order-time>
                </div>
              }
            </div>
          }
        </div>
      }
    }
  `,
  styles: [`
    .center { display: flex; justify-content: center; padding: 48px 0; }
    .banner { display: flex; align-items: center; gap: 6px; border-radius: var(--clay-radius-sm); padding: 10px 12px; font-size: 13px; margin: 0 0 12px; background: var(--danger-bg); color: var(--danger-text); }
    .link { background: none; border: none; padding: 0 0 0 6px; color: inherit; font: inherit; font-weight: 700; text-decoration: underline; cursor: pointer; }
    .hint { display: flex; align-items: center; gap: 6px; color: var(--clay-text-muted); font-size: 12.5px; margin: 0 0 12px; }
    .hint mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .hint a { color: var(--clay-primary); font-weight: 600; }

    .cards { display: flex; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
    .card { background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius); padding: 12px 16px; min-width: 160px; box-shadow: var(--clay-shadow-soft); }
    .c-label { display: flex; align-items: center; gap: 5px; font-size: 11.5px; font-weight: 700; color: var(--clay-text-muted); text-transform: uppercase; letter-spacing: .03em; }
    .c-label mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .c-actual { font-size: 21px; font-weight: 700; color: var(--clay-text); margin: 3px 0 1px; }
    .c-est { font-size: 11.5px; color: var(--clay-text-muted); }
    .pad { padding: 8px 0; } .muted { color: var(--clay-text-muted); }

    .wo-list { display: flex; flex-direction: column; gap: 8px; }
    .wo { background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius); box-shadow: var(--clay-shadow-soft); overflow: hidden; }
    .wo-head { display: flex; align-items: center; gap: 10px; width: 100%; padding: 11px 14px; background: none; border: none; cursor: pointer; font-family: inherit; text-align: left; }
    .wo-head:hover { background: var(--clay-bg-warm); }
    .chev { color: var(--clay-text-muted); font-size: 20px; width: 20px; height: 20px; }
    .mark { font-weight: 700; color: var(--clay-text); font-family: 'Space Grotesk', monospace; }
    .num { font-size: 12px; color: var(--clay-text-muted); }
    .grow { flex: 1; }
    .metric { font-size: 12.5px; color: var(--clay-text-secondary); min-width: 52px; text-align: right; }
    .metric.strong { font-weight: 700; color: var(--clay-text); }
    .wo-body { padding: 4px 16px 16px; border-top: 1px solid var(--clay-border); }
    .chip { padding: 1px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; text-transform: capitalize; white-space: nowrap; }
    .st-draft, .st-pending, .st-cancelled { background: var(--badge-draft-bg); color: var(--badge-draft-text); }
    .st-in_progress { background: var(--warning-bg); color: var(--warning-text); }
    .st-completed { background: var(--success-bg); color: var(--success-text); }
  `],
})
export class OrderTimeComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private svc = inject(TimeTrackingService);

  orderId = '';
  data: OrderTime | null = null;
  loading = true;
  error: string | null = null;
  expandedId = '';

  get withTimeCount(): number { return this.data?.workOrders.filter((w) => w.loggedSeconds > 0).length ?? 0; }

  ngOnInit(): void {
    this.orderId = this.route.parent?.snapshot.paramMap.get('orderId') ?? this.route.snapshot.paramMap.get('orderId') ?? '';
    this.load();
  }

  load(quiet = false): void {
    if (!this.orderId) return;
    if (!quiet) this.loading = true;
    this.svc.orderWorkOrders(this.orderId).subscribe({
      next: (d) => { this.data = d; this.loading = false; },
      error: (e) => { this.loading = false; this.error = e?.error?.message || 'Could not load time for this order.'; },
    });
  }

  toggle(id: string): void { this.expandedId = this.expandedId === id ? '' : id; }
}
