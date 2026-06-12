import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ProjectWorkspaceStore } from './project-workspace.store';
import { ProjectsService, EarnedValue, ProductionOrder } from '../core/services/projects.service';

/**
 * Reports tab — earned value / progress billing.
 *
 * Weekly produced + shipped tonnage with cumulative earned %, scoped to the
 * whole project or one production order. These are the numbers a fabricator
 * invoices against (tonnage milestones), exportable as CSV for the billing
 * package.
 */
@Component({
  selector: 'app-project-reports',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatTooltipModule, MatProgressSpinnerModule],
  template: `
    <div class="rep">
      <div class="rep-head">
        <div>
          <h3><mat-icon>payments</mat-icon> Earned value — progress billing</h3>
          <p class="sub">Produced = pieces with every stage complete (× weight). Shipped = items on shipped/delivered loads.</p>
        </div>
        <div class="controls">
          <select class="sel" [ngModel]="orderId()" (ngModelChange)="setOrder($event)">
            <option value="">Whole project</option>
            @for (o of orders(); track o.id) { <option [value]="o.id">{{ o.number }}{{ o.customerName ? ' — ' + o.customerName : '' }}</option> }
          </select>
          <button class="ghost-btn" (click)="exportCsv()" [disabled]="!data()"><mat-icon>download</mat-icon>CSV</button>
        </div>
      </div>

      @if (!loaded()) {
        <div class="empty"><mat-spinner diameter="28"></mat-spinner></div>
      } @else if (!data()) {
        <div class="empty"><p>Could not load the report.</p></div>
      } @else {
        @if (data()!.kpis; as k) {
          <div class="kpis">
            <div class="kpi"><span class="kn">{{ tonnes(k.scopeKg) }} t</span><span class="kl">Released scope ({{ k.scopePieces }} pieces)</span></div>
            <div class="kpi">
              <span class="kn">{{ tonnes(k.producedKg) }} t <em>{{ k.producedPct }}%</em></span>
              <span class="kl">Produced</span>
              <span class="bar"><span class="fill" [style.width.%]="k.producedPct"></span></span>
            </div>
            <div class="kpi">
              <span class="kn">{{ tonnes(k.shippedKg) }} t <em>{{ k.shippedPct }}%</em></span>
              <span class="kl">Shipped</span>
              <span class="bar"><span class="fill ship" [style.width.%]="k.shippedPct"></span></span>
            </div>
            <div class="kpi"><span class="kn">{{ tonnes(k.designKg) }} t</span><span class="kl">Design tonnage (tree)</span></div>
          </div>
        }

        @if (data()!.series.length === 0) {
          <div class="empty">
            <mat-icon>stacked_bar_chart</mat-icon>
            <h4>Nothing earned yet</h4>
            <p>Complete pieces on the order board (or ship a load) and the weekly tonnage will build up here.</p>
          </div>
        } @else {
          <div class="chart">
            @for (w of data()!.series; track w.weekStart) {
              <div class="week">
                <div class="bars">
                  <div class="vbar prod" [style.height.%]="pct(w.producedKg)" [matTooltip]="'Produced ' + tonnes(w.producedKg) + ' t (' + w.producedPieces + ' pcs)'"></div>
                  <div class="vbar ship" [style.height.%]="pct(w.shippedKg)" [matTooltip]="'Shipped ' + tonnes(w.shippedKg) + ' t (' + w.shippedPieces + ' pcs)'"></div>
                </div>
                <span class="wlbl">{{ w.weekStart | date:'MMM d' }}</span>
              </div>
            }
          </div>
          <div class="legend">
            <span><span class="sw prod"></span>Produced t/week</span>
            <span><span class="sw ship"></span>Shipped t/week</span>
          </div>

          <div class="tbl">
            <div class="tr th"><span>Week</span><span class="num">Produced t</span><span class="num">Pieces</span><span class="num">Shipped t</span><span class="num">Pieces</span><span class="num">Cum. produced t</span><span class="num">Cum. shipped t</span></div>
            @for (w of data()!.series; track w.weekStart) {
              <div class="tr">
                <span>{{ w.weekStart | date:'dd.MM.yyyy' }}</span>
                <span class="num">{{ tonnes(w.producedKg) }}</span>
                <span class="num muted">{{ w.producedPieces }}</span>
                <span class="num">{{ tonnes(w.shippedKg) }}</span>
                <span class="num muted">{{ w.shippedPieces }}</span>
                <span class="num strong">{{ tonnes(w.cumulativeProducedKg) }}</span>
                <span class="num strong">{{ tonnes(w.cumulativeShippedKg) }}</span>
              </div>
            }
          </div>
        }
      }
    </div>
  `,
  styles: [`
    .rep { background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius); padding: 16px 18px; }
    .rep-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
    .rep-head h3 { margin: 0; font-size: 15px; font-weight: 700; color: var(--clay-text); display: inline-flex; align-items: center; gap: 8px; }
    .rep-head h3 mat-icon { font-size: 19px; width: 19px; height: 19px; color: var(--clay-primary); }
    .sub { margin: 4px 0 0; font-size: 12px; color: var(--clay-text-muted); }
    .controls { display: flex; gap: 8px; align-items: center; }
    .sel { border: 1px solid var(--clay-border); border-radius: var(--clay-radius-xs); background: var(--clay-surface); color: var(--clay-text); padding: 7px 10px; font-size: 13px; font-family: inherit; max-width: 240px; }
    .ghost-btn { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--clay-border); background: var(--clay-surface); color: var(--clay-text-secondary); border-radius: var(--clay-radius-sm); padding: 7px 12px; font-size: 12.5px; font-weight: 600; cursor: pointer; font-family: inherit; }
    .ghost-btn:hover { border-color: var(--clay-primary); color: var(--clay-primary); }
    .ghost-btn mat-icon { font-size: 17px; width: 17px; height: 17px; }

    .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; margin-bottom: 18px; }
    .kpi { border: 1px solid var(--clay-border); border-radius: var(--clay-radius-sm); padding: 12px 14px; display: flex; flex-direction: column; gap: 3px; }
    .kn { font-size: 19px; font-weight: 700; color: var(--clay-text); font-family: 'Space Grotesk','Inter',sans-serif; }
    .kn em { font-style: normal; font-size: 12px; color: var(--clay-primary); font-weight: 700; }
    .kl { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: var(--clay-text-muted); }
    .bar { height: 6px; border-radius: 4px; background: var(--clay-bg-warm); overflow: hidden; margin-top: 5px; }
    .fill { display: block; height: 100%; background: linear-gradient(90deg, var(--clay-primary), var(--clay-primary-light)); }
    .fill.ship { background: var(--success-text); }

    .chart { display: flex; align-items: flex-end; gap: 10px; height: 160px; padding: 8px 4px 0; overflow-x: auto; }
    .week { display: flex; flex-direction: column; align-items: center; gap: 5px; height: 100%; justify-content: flex-end; }
    .bars { display: flex; align-items: flex-end; gap: 3px; height: 100%; }
    .vbar { width: 16px; border-radius: 4px 4px 0 0; min-height: 2px; transition: height .35s ease; }
    .vbar.prod { background: linear-gradient(180deg, var(--clay-primary-light), var(--clay-primary)); }
    .vbar.ship { background: var(--success-text); }
    .wlbl { font-size: 10.5px; color: var(--clay-text-muted); white-space: nowrap; }
    .legend { display: flex; gap: 16px; font-size: 12px; color: var(--clay-text-secondary); margin: 10px 0 16px; }
    .legend span { display: inline-flex; align-items: center; gap: 6px; }
    .sw { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }
    .sw.prod { background: var(--clay-primary); }
    .sw.ship { background: var(--success-text); }

    .tbl { border-top: 1px solid var(--clay-border); }
    .tr { display: grid; grid-template-columns: 110px repeat(6, 1fr); gap: 10px; padding: 8px 4px; border-bottom: 1px solid var(--clay-border); font-size: 13px; color: var(--clay-text); }
    .tr:last-child { border-bottom: none; }
    .tr.th { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--clay-text-muted); }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .strong { font-weight: 700; }
    .muted { color: var(--clay-text-muted); }

    .empty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 40px 20px; text-align: center; color: var(--clay-text-muted); }
    .empty mat-icon { font-size: 36px; width: 36px; height: 36px; opacity: .5; }
    .empty h4 { margin: 0; color: var(--clay-text); }
    .empty p { margin: 0; font-size: 13px; max-width: 420px; }
  `],
})
export class ProjectReportsComponent {
  store = inject(ProjectWorkspaceStore);
  private svc = inject(ProjectsService);

  readonly data = signal<EarnedValue | null>(null);
  readonly loaded = signal(false);
  readonly orders = signal<ProductionOrder[]>([]);
  readonly orderId = signal('');

  readonly maxKg = computed(() => {
    const s = this.data()?.series ?? [];
    return Math.max(1, ...s.map((w) => Math.max(w.producedKg, w.shippedKg)));
  });

  constructor() {
    this.load();
    this.svc.listOrders(this.store.id()).subscribe({ next: (o) => this.orders.set(o), error: () => {} });
  }

  load(): void {
    this.loaded.set(false);
    this.svc.earnedValue(this.store.id(), this.orderId() || undefined).subscribe({
      next: (d) => { this.data.set(d); this.loaded.set(true); },
      error: () => { this.data.set(null); this.loaded.set(true); },
    });
  }

  setOrder(id: string): void { this.orderId.set(id); this.load(); }

  pct(kg: number): number { return Math.max(1, Math.round((kg / this.maxKg()) * 100)); }
  tonnes(kg: number): string {
    const t = (kg ?? 0) / 1000;
    return t >= 100 ? String(Math.round(t)) : String(Math.round(t * 100) / 100);
  }

  exportCsv(): void {
    const d = this.data();
    if (!d) return;
    const head = 'week,produced_t,produced_pieces,shipped_t,shipped_pieces,cumulative_produced_t,cumulative_shipped_t';
    const rows = d.series.map((w) =>
      [w.weekStart, (w.producedKg / 1000).toFixed(3), w.producedPieces, (w.shippedKg / 1000).toFixed(3), w.shippedPieces,
        (w.cumulativeProducedKg / 1000).toFixed(3), (w.cumulativeShippedKg / 1000).toFixed(3)].join(','));
    const blob = new Blob([[head, ...rows].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `earned-value-${this.store.id()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
}
