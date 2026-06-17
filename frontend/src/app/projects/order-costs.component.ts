import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CostingApiService, OrderCost } from '../core/services/costing.service';
import { PermissionsService } from '../core/services/permissions.service';

/**
 * Order COSTS tab — what this work order actually costs vs what it should:
 *   material  = stock issued to the order at issue-time (moving-average) cost
 *   labor     = clocked time × rate (worker → stage → org default)
 *   overhead  = configurable % on labor
 * Estimates: BOM × current prices, stage target times × rates.
 */
@Component({
  selector: 'app-order-costs',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule],
  template: `
    @if (error) { <p class="banner err">{{ error }}</p> }

    @if (loading) {
      <div class="center"><mat-spinner diameter="32"></mat-spinner></div>
    } @else if (cost) {

      @if (!cost.settings.configured && cost.ratesConfigured.workersWithRate === 0 && cost.ratesConfigured.stagesWithRate === 0) {
        <p class="banner warn">
          <mat-icon>tune</mat-icon>
          Labor is being costed at the default {{ cost.settings.defaultLaborRate | currency:cost.currency }}/h.
          Set real rates for accurate numbers — per worker (Users page), per stage (process editor), or the org default
          @if (canManage) { <button class="link" (click)="settingsOpen = !settingsOpen">in costing settings</button>. } @else { (ask a manager). }
        </p>
      }

      <div class="head-row">
        <p class="hint"><mat-icon>functions</mat-icon>Total = material (issued&nbsp;stock) + labor (clocked&nbsp;time)@if (hasMachine) { + machine (work-center&nbsp;time)} + overhead (per-stage % on labor, default {{ cost.settings.overheadPercent }}%)</p>
        @if (canManage) {
          <button class="btn outline sm" (click)="toggleSettings()"><mat-icon>settings</mat-icon>Costing settings</button>
        }
      </div>

      @if (settingsOpen) {
        <div class="settings">
          <div class="s-grid">
            <label>Default labor rate <input type="number" min="0" [(ngModel)]="sForm.defaultLaborRate"></label>
            <label>Overhead % on labor <input type="number" min="0" max="500" [(ngModel)]="sForm.overheadPercent"></label>
            <label>Currency <input type="text" maxlength="3" [(ngModel)]="sForm.currency" placeholder="USD"></label>
          </div>
          <div class="s-actions">
            <span class="muted">Applies org-wide ({{ cost.ratesConfigured.workersWithRate }} worker rate(s), {{ cost.ratesConfigured.stagesWithRate }} stage rate(s) configured)</span>
            <button class="btn primary sm" [disabled]="busy" (click)="saveSettings()">{{ busy ? 'Saving…' : 'Save settings' }}</button>
          </div>
        </div>
      }

      <!-- Cost cards: actual vs estimate -->
      <div class="cards">
        <div class="card">
          <div class="c-label"><mat-icon>category</mat-icon>Material</div>
          <div class="c-actual">{{ cost.actual.materialCost | currency:cost.currency }}</div>
          <div class="c-est">est. {{ cost.estimate.materialCost | currency:cost.currency }} {{ varianceChip(cost.variance.material) }}</div>
        </div>
        <div class="card">
          <div class="c-label"><mat-icon>engineering</mat-icon>Labor</div>
          <div class="c-actual">{{ cost.actual.laborCost | currency:cost.currency }}</div>
          <div class="c-est">{{ cost.actual.laborHours | number:'1.0-1' }} h · est. {{ cost.estimate.laborCost | currency:cost.currency }} {{ varianceChip(cost.variance.labor) }}</div>
        </div>
        @if (hasMachine) {
          <div class="card">
            <div class="c-label"><mat-icon>precision_manufacturing</mat-icon>Machine</div>
            <div class="c-actual">{{ cost.actual.machineCost | currency:cost.currency }}</div>
            <div class="c-est">{{ cost.actual.machineHours | number:'1.0-1' }} h · est. {{ cost.estimate.machineCost | currency:cost.currency }} {{ varianceChip(cost.variance.machine) }}</div>
          </div>
        }
        <div class="card">
          <div class="c-label" [matTooltip]="effectiveOverheadPct !== cost.settings.overheadPercent ? 'Blended per-stage overhead; org default is ' + cost.settings.overheadPercent + '%' : ''">
            <mat-icon>domain</mat-icon>Overhead ({{ effectiveOverheadPct | number:'1.0-1' }}%)
          </div>
          <div class="c-actual">{{ cost.actual.overheadCost | currency:cost.currency }}</div>
          <div class="c-est">est. {{ cost.estimate.overheadCost | currency:cost.currency }}</div>
        </div>
        <div class="card total">
          <div class="c-label"><mat-icon>payments</mat-icon>Total</div>
          <div class="c-actual">{{ cost.actual.totalCost | currency:cost.currency }}</div>
          <div class="c-est">est. {{ cost.estimate.totalCost | currency:cost.currency }} {{ varianceChip(cost.variance.total) }}</div>
        </div>
        @if (cost.quantity > 1) {
          <div class="card">
            <div class="c-label"><mat-icon>tag</mat-icon>Per unit ({{ cost.quantity }})</div>
            <div class="c-actual">{{ cost.actual.totalCost / cost.quantity | currency:cost.currency }}</div>
            <div class="c-est">est. {{ cost.estimate.totalCost / cost.quantity | currency:cost.currency }}</div>
          </div>
        }
      </div>

      @if (cost.estimate.materialUnmappedLines > 0) {
        <p class="banner warn slim"><mat-icon>link_off</mat-icon>{{ cost.estimate.materialUnmappedLines }} BOM line(s) unmapped — the material estimate is incomplete. Map them on the <a [routerLink]="['/projects', cost.projectId, 'materials']">project Materials tab</a>.</p>
      } @else if (cost.estimate.materialUnpricedNote) {
        <p class="banner warn slim"><mat-icon>payments</mat-icon>Matched materials have no unit costs yet, so the material estimate reads 0 — set prices in <a routerLink="/materials">Inventory</a>.</p>
      }

      <!-- Per-assembly breakdown -->
      <h3 class="sec"><mat-icon>widgets</mat-icon>Cost per assembly</h3>
      @if (cost.items.length === 0) {
        <p class="muted pad">No work orders on this order yet.</p>
      } @else {
        <div class="table-wrap">
          <table>
            <thead><tr><th>Mark</th><th>WO</th><th>Status</th><th class="num">Labor h</th><th class="num">Labor</th>@if (hasMachine) { <th class="num">Machine</th> }<th class="num">Material</th><th class="num">Total</th></tr></thead>
            <tbody>
              @for (it of cost.items; track it.workOrderId) {
                <tr>
                  <td class="mono">{{ it.mark }}</td>
                  <td class="muted">{{ it.orderNumber }}</td>
                  <td><span class="chip st-{{ it.status }}">{{ it.status.replace('_', ' ') }}</span></td>
                  <td class="num">{{ it.laborHours | number:'1.0-1' }}</td>
                  <td class="num">{{ it.laborCost | currency:cost.currency }}</td>
                  @if (hasMachine) { <td class="num">{{ it.machineCost | currency:cost.currency }}</td> }
                  <td class="num" [matTooltip]="materialTip(it)">{{ (it.materialCost + it.allocatedMaterialCost) | currency:cost.currency }}{{ it.allocatedMaterialCost > 0 ? ' *' : '' }}</td>
                  <td class="num strong">{{ it.totalCost | currency:cost.currency }}</td>
                </tr>
              }
              @if (unallocatedRemainder > 0.01) {
                <tr class="dim">
                  <td [attr.colspan]="hasMachine ? 6 : 5"><span class="muted">Material issued to the order (not allocated to an assembly)</span></td>
                  <td class="num">{{ unallocatedRemainder | currency:cost.currency }}</td>
                  <td class="num"></td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        @if (cost.allocatedMaterialTotal > 0) {
          <p class="hint"><mat-icon>call_split</mat-icon><span><b>*</b> includes a share of {{ cost.allocatedMaterialTotal | currency:cost.currency }} in bulk material issued to the order (not pinned to one assembly), allocated by each assembly's BOM estimate. Hover a material value for the split.</span></p>
        }
      }

      <!-- Per-material breakdown -->
      <h3 class="sec"><mat-icon>category</mat-icon>Material consumed</h3>
      @if (cost.materials.length === 0) {
        <p class="muted pad">Nothing issued yet — use the <a [routerLink]="['/projects', cost.projectId, 'orders', cost.orderId, 'materials']">Materials tab</a> to issue stock against this order.</p>
      } @else {
        <div class="table-wrap">
          <table>
            <thead><tr><th>Material</th><th class="num">Net quantity</th><th class="num">Cost</th></tr></thead>
            <tbody>
              @for (m of cost.materials; track m.materialId) {
                <tr>
                  <td><span class="mono sm">{{ m.code }}</span> {{ m.name }}</td>
                  <td class="num">{{ m.quantity | number:'1.0-2' }} {{ m.unitOfMeasure }}</td>
                  <td class="num">{{ m.cost | currency:cost.currency }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    }
  `,
  styles: [`
    .center { display: flex; justify-content: center; padding: 48px 0; }
    .banner { display: flex; align-items: center; gap: 6px; border-radius: var(--clay-radius-sm); padding: 10px 12px; font-size: 13px; margin: 0 0 12px; flex-wrap: wrap; }
    .banner.slim { padding: 8px 12px; }
    .banner mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .banner.err { background: var(--danger-bg); color: var(--danger-text); }
    .banner.warn { background: var(--warning-bg); color: var(--warning-text); }
    .banner a { color: inherit; font-weight: 700; }
    .link { background: none; border: none; padding: 0; color: inherit; font: inherit; font-weight: 700; text-decoration: underline; cursor: pointer; }

    .head-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
    .hint { display: flex; align-items: center; gap: 6px; color: var(--clay-text-muted); font-size: 12.5px; margin: 0; }
    .hint mat-icon { font-size: 16px; width: 16px; height: 16px; }

    .settings { background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius); padding: 14px; margin-bottom: 14px; box-shadow: var(--clay-shadow-soft); }
    .s-grid { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 10px; }
    .s-grid label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; font-weight: 600; color: var(--clay-text-secondary); }
    .s-grid input { padding: 8px 10px; border: 1px solid var(--clay-border); border-radius: var(--clay-radius-xs); font-size: 13px; width: 160px; background: var(--clay-surface); color: var(--clay-text); font-family: inherit; }
    .s-actions { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
    .s-actions .muted { font-size: 12px; }

    .cards { display: flex; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
    .card { background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius); padding: 12px 16px; min-width: 170px; box-shadow: var(--clay-shadow-soft); }
    .card.total { border-color: var(--clay-primary); }
    .c-label { display: flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 700; color: var(--clay-text-muted); text-transform: uppercase; letter-spacing: .03em; }
    .c-label mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .c-actual { font-size: 21px; font-weight: 700; color: var(--clay-text); margin: 3px 0 1px; }
    .c-est { font-size: 11.5px; color: var(--clay-text-muted); }

    .sec { display: flex; align-items: center; gap: 7px; font-size: 15px; font-weight: 700; color: var(--clay-text); margin: 18px 0 10px; }
    .sec mat-icon { font-size: 19px; width: 19px; height: 19px; color: var(--clay-text-muted); }
    .pad { padding: 4px 0 12px; font-size: 13px; }
    .pad a { color: var(--clay-primary); font-weight: 600; }

    .table-wrap { background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius); overflow-x: auto; box-shadow: var(--clay-shadow-soft); }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; font-size: 11.5px; text-transform: uppercase; letter-spacing: .03em; color: var(--clay-text-muted); padding: 10px 12px; border-bottom: 1px solid var(--clay-border); white-space: nowrap; }
    td { padding: 8px 12px; border-bottom: 1px solid var(--clay-border); }
    tbody tr:last-child td { border-bottom: none; }
    tbody tr:hover { background: var(--clay-bg-warm); }
    tr.dim td { color: var(--clay-text-muted); }
    .num { text-align: right; white-space: nowrap; } th.num { text-align: right; }
    .mono { font-family: 'Space Grotesk', monospace; font-weight: 600; } .mono.sm { font-size: 12px; }
    .muted { color: var(--clay-text-muted); } .strong { font-weight: 700; }
    .chip { padding: 1px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; text-transform: capitalize; white-space: nowrap; }
    .st-pending { background: var(--badge-draft-bg); color: var(--badge-draft-text); }
    .st-in_progress { background: var(--warning-bg); color: var(--warning-text); }
    .st-completed { background: var(--success-bg); color: var(--success-text); }
    .st-cancelled, .st-draft { background: var(--badge-draft-bg); color: var(--badge-draft-text); }

    .btn { display: inline-flex; align-items: center; gap: 4px; border-radius: var(--clay-radius-sm); padding: 6px 12px; font-size: 12.5px; font-weight: 600; cursor: pointer; font-family: inherit; border: 1px solid var(--clay-border); transition: all .15s; }
    .btn mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .btn.sm { padding: 5px 11px; font-size: 12px; }
    .btn.primary { background: var(--clay-primary); color: #fff; border-color: var(--clay-primary); }
    .btn.outline { background: transparent; color: var(--clay-primary); border-color: var(--clay-primary); }
    .btn.outline:hover:not(:disabled) { background: var(--info-bg); }
    .btn:disabled { opacity: .5; cursor: default; }
  `],
})
export class OrderCostsComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private svc = inject(CostingApiService);
  private perms = inject(PermissionsService);
  private snack = inject(MatSnackBar);

  orderId = '';
  cost: OrderCost | null = null;
  loading = true;
  busy = false;
  error: string | null = null;

  settingsOpen = false;
  sForm = { defaultLaborRate: 30, overheadPercent: 0, currency: 'USD' };

  get canManage(): boolean { return this.perms.can('costing.manage'); }
  /** Show the machine column/card only when the org actually uses machine costing (rates configured). */
  get hasMachine(): boolean {
    return !!this.cost && ((this.cost.actual.machineCost || 0) > 0 || (this.cost.estimate.machineCost || 0) > 0);
  }

  /** Effective overhead rate = actual overhead ÷ actual labor (per-stage blended); org default when no labor yet. */
  get effectiveOverheadPct(): number {
    if (!this.cost) return 0;
    const labor = this.cost.actual.laborCost || 0;
    if (labor <= 0) return this.cost.settings.overheadPercent || 0;
    return Math.round(((this.cost.actual.overheadCost || 0) / labor) * 1000) / 10;
  }

  /** Bulk material left over after per-assembly allocation (shown as a catch-all row). */
  get unallocatedRemainder(): number {
    if (!this.cost) return 0;
    return Math.max(0, (this.cost.unattributedMaterialCost || 0) - (this.cost.allocatedMaterialTotal || 0));
  }

  /** Tooltip breaking a row's material into pinned + allocated, with the BOM estimate. */
  materialTip(it: OrderCost['items'][number]): string {
    const cur = this.cost?.currency || 'USD';
    const fmt = (n: number) => `${n.toFixed(2)} ${cur}`;
    const parts: string[] = [];
    if ((it.allocatedMaterialCost || 0) > 0) parts.push(`pinned ${fmt(it.materialCost)} + allocated ${fmt(it.allocatedMaterialCost)}`);
    if ((it.estimatedMaterialCost || 0) > 0) parts.push(`est. ${fmt(it.estimatedMaterialCost)}`);
    return parts.join(' · ');
  }

  ngOnInit(): void {
    this.orderId = this.route.parent?.snapshot.paramMap.get('orderId')
      ?? this.route.snapshot.paramMap.get('orderId') ?? '';
    this.load();
  }

  load(): void {
    if (!this.orderId) return;
    this.loading = true;
    this.svc.orderCost(this.orderId).subscribe({
      next: (c) => {
        this.cost = c;
        this.loading = false;
        this.sForm = {
          defaultLaborRate: c.settings.defaultLaborRate,
          overheadPercent: c.settings.overheadPercent,
          currency: c.settings.currency,
        };
      },
      error: (e) => { this.loading = false; this.error = e?.error?.message || 'Could not load the cost breakdown.'; },
    });
  }

  toggleSettings(): void { this.settingsOpen = !this.settingsOpen; }

  saveSettings(): void {
    if (this.busy) return;
    this.busy = true;
    this.svc.updateSettings({
      defaultLaborRate: Number(this.sForm.defaultLaborRate) || 0,
      overheadPercent: Number(this.sForm.overheadPercent) || 0,
      currency: (this.sForm.currency || 'USD').toUpperCase(),
    }).subscribe({
      next: () => { this.busy = false; this.settingsOpen = false; this.snack.open('Costing settings saved', 'OK', { duration: 2500 }); this.load(); },
      error: (e) => { this.busy = false; this.snack.open(e?.error?.message || 'Could not save settings', 'Dismiss', { duration: 4500 }); },
    });
  }

  /** Small ± chip text against the estimate, e.g. "(+12%)". */
  varianceChip(v: { amount: number; percent: number | null }): string {
    if (v.percent === null || Math.abs(v.percent) < 0.5) return '';
    return `(${v.percent > 0 ? '+' : ''}${Math.round(v.percent)}%)`;
  }
}
