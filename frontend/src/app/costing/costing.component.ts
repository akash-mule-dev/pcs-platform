import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { CostingApiService, CostingOrdersOverview } from '../core/services/costing.service';
import { PermissionsService } from '../core/services/permissions.service';

/**
 * Org-wide costing overview: every work order with its labor / material /
 * overhead roll-up, plus the costing settings (default labor rate, overhead %,
 * currency). Drill into an order for the full actual-vs-estimate breakdown.
 */
@Component({
  selector: 'app-costing',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <div class="page-shell">
      <div class="page-header">
        <div>
          <h1 class="page-title">Costing</h1>
          <p class="page-subtitle">Material + labor + overhead per work order — actuals from the stock ledger and clocked time</p>
        </div>
        @if (perms.can('costing.manage')) {
          <button class="btn outline" (click)="settingsOpen = !settingsOpen"><mat-icon>settings</mat-icon>Settings</button>
        }
      </div>

      @if (settingsOpen && data) {
        <div class="panel">
          <h3>Costing settings</h3>
          <div class="s-grid">
            <label>Default labor rate ({{ data.currency }}/h) <input type="number" min="0" [(ngModel)]="sForm.defaultLaborRate"></label>
            <label>Overhead % on labor <input type="number" min="0" max="500" [(ngModel)]="sForm.overheadPercent"></label>
            <label>Currency (ISO) <input type="text" maxlength="3" [(ngModel)]="sForm.currency"></label>
          </div>
          <p class="hint"><mat-icon>info</mat-icon>Rate resolution per time entry: worker's personal rate (Users page) → stage rate (process editor) → this default.</p>
          <div class="panel-actions">
            <button class="btn ghost" (click)="settingsOpen = false">Close</button>
            <button class="btn primary" [disabled]="busy" (click)="saveSettings()">{{ busy ? 'Saving…' : 'Save settings' }}</button>
          </div>
        </div>
      }

      @if (loading) {
        <div class="center"><mat-spinner diameter="40"></mat-spinner></div>
      } @else if (data) {
        <div class="kpis">
          <div class="kpi-card"><div class="kpi">{{ data.kpis.orders }}</div><div class="lbl">Work orders</div></div>
          <div class="kpi-card"><div class="kpi">{{ data.kpis.materialCost | currency:data.currency }}</div><div class="lbl">Material</div></div>
          <div class="kpi-card"><div class="kpi">{{ data.kpis.laborCost | currency:data.currency }}</div><div class="lbl">Labor</div></div>
          <div class="kpi-card total"><div class="kpi">{{ data.kpis.totalCost | currency:data.currency }}</div><div class="lbl">Total cost</div></div>
        </div>

        @if (data.orders.length === 0) {
          <div class="empty">
            <mat-icon>payments</mat-icon>
            <p>No work orders yet. Create one from a project — its costs accumulate here as material is issued and time is clocked.</p>
          </div>
        } @else {
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Order</th><th>Project</th><th>Customer</th><th>Status</th>
                  <th class="num">Labor h</th><th class="num">Material</th><th class="num">Labor</th><th class="num">Overhead</th><th class="num">Total</th><th></th>
                </tr>
              </thead>
              <tbody>
                @for (o of data.orders; track o.orderId) {
                  <tr class="rowlink" [routerLink]="['/projects', o.project.id, 'orders', o.orderId, 'costs']">
                    <td class="mono">{{ o.number }}</td>
                    <td>{{ o.project.name }}</td>
                    <td>{{ o.customerName || '—' }}</td>
                    <td><span class="chip st-{{ o.status }}">{{ o.status.replace('_', ' ') }}</span></td>
                    <td class="num">{{ o.laborHours | number:'1.0-1' }}</td>
                    <td class="num">{{ o.materialCost | currency:data.currency }}</td>
                    <td class="num">{{ o.laborCost | currency:data.currency }}</td>
                    <td class="num">{{ o.overheadCost | currency:data.currency }}</td>
                    <td class="num strong">{{ o.totalCost | currency:data.currency }}</td>
                    <td class="go"><mat-icon>chevron_right</mat-icon></td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      }
    </div>
  `,
  styles: [`
    .page-shell { padding: 24px; }
    .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; gap: 12px; flex-wrap: wrap; }
    .page-title { margin: 0; font-size: 22px; }
    .page-subtitle { margin: 2px 0 0; color: var(--clay-text-muted, #64748b); font-size: 13px; }

    .panel { background: var(--clay-surface, #fff); border: 1px solid var(--clay-border, #e2e8f0); border-radius: 10px; padding: 16px; margin-bottom: 16px; }
    .panel h3 { margin: 0 0 12px; font-size: 15px; }
    .s-grid { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 10px; }
    .s-grid label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; font-weight: 600; color: var(--clay-text-secondary, #475569); }
    .s-grid input { padding: 8px 10px; border: 1px solid var(--clay-border, #e2e8f0); border-radius: 8px; font-size: 13px; width: 170px; background: var(--clay-surface, #fff); color: var(--clay-text, #0f172a); font-family: inherit; }
    .panel-actions { display: flex; justify-content: flex-end; gap: 8px; }
    .hint { display: flex; align-items: center; gap: 6px; color: var(--clay-text-muted, #64748b); font-size: 12.5px; margin: 0 0 10px; }
    .hint mat-icon { font-size: 16px; width: 16px; height: 16px; }

    .kpis { display: flex; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
    .kpi-card { background: var(--clay-surface, #fff); border: 1px solid var(--clay-border, #e2e8f0); border-radius: 10px; padding: 12px 18px; min-width: 140px; }
    .kpi-card.total { border-color: var(--clay-primary, #3b82f6); }
    .kpi-card .kpi { font-size: 20px; font-weight: 700; } .kpi-card .lbl { font-size: 12px; color: var(--clay-text-muted, #64748b); }

    .table-wrap { background: var(--clay-surface, #fff); border: 1px solid var(--clay-border, #e2e8f0); border-radius: 10px; overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
    th { text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: .03em; color: var(--clay-text-muted, #64748b); padding: 10px 12px; border-bottom: 1px solid var(--clay-border, #e2e8f0); white-space: nowrap; }
    td { padding: 9px 12px; border-bottom: 1px solid var(--clay-border, #eef2f7); }
    tbody tr:last-child td { border-bottom: none; }
    tr.rowlink { cursor: pointer; } tr.rowlink:hover { background: var(--clay-bg-warm, #fafaf7); }
    .num { text-align: right; white-space: nowrap; } th.num { text-align: right; }
    .mono { font-family: 'Space Grotesk', monospace; font-weight: 600; }
    .strong { font-weight: 700; }
    .go { width: 30px; color: var(--clay-text-muted, #64748b); }
    .go mat-icon { font-size: 18px; width: 18px; height: 18px; vertical-align: middle; }
    .chip { padding: 1px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; text-transform: capitalize; white-space: nowrap; }
    .st-planned { background: var(--badge-draft-bg, #f1f5f9); color: var(--badge-draft-text, #475569); }
    .st-in_progress { background: var(--warning-bg, #fef3c7); color: var(--warning-text, #92400e); }
    .st-completed { background: var(--success-bg, #dcfce7); color: var(--success-text, #166534); }
    .st-cancelled { background: var(--danger-bg, #fee2e2); color: var(--danger-text, #991b1b); }

    .btn { display: inline-flex; align-items: center; gap: 5px; border-radius: 9px; padding: 8px 14px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; border: 1px solid var(--clay-border, #e2e8f0); background: var(--clay-surface, #fff); color: var(--clay-text, #0f172a); }
    .btn mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .btn.primary { background: var(--clay-primary, #3b82f6); color: #fff; border-color: var(--clay-primary, #3b82f6); }
    .btn.outline { color: var(--clay-primary, #3b82f6); border-color: var(--clay-primary, #3b82f6); background: transparent; }
    .btn.ghost { border-color: transparent; color: var(--clay-text-muted, #64748b); }
    .btn:disabled { opacity: .5; cursor: default; }

    .center { display: flex; justify-content: center; padding: 48px; }
    .empty { text-align: center; color: var(--clay-text-muted, #64748b); padding: 40px 24px; }
    .empty mat-icon { font-size: 40px; width: 40px; height: 40px; opacity: .5; }
    .empty p { max-width: 480px; margin: 8px auto 0; }
  `],
})
export class CostingComponent implements OnInit {
  perms = inject(PermissionsService);
  private svc = inject(CostingApiService);
  private snack = inject(MatSnackBar);

  data: CostingOrdersOverview | null = null;
  loading = true;
  busy = false;
  settingsOpen = false;
  sForm = { defaultLaborRate: 30, overheadPercent: 0, currency: 'USD' };

  ngOnInit(): void { this.load(); }

  load(): void {
    this.loading = true;
    this.svc.ordersOverview().subscribe({
      next: (d) => {
        this.data = d;
        this.loading = false;
        this.sForm = {
          defaultLaborRate: d.settings.defaultLaborRate,
          overheadPercent: d.settings.overheadPercent,
          currency: d.settings.currency,
        };
      },
      error: () => { this.loading = false; this.snack.open('Could not load costing overview', 'Dismiss', { duration: 4000 }); },
    });
  }

  saveSettings(): void {
    if (this.busy) return;
    this.busy = true;
    this.svc.updateSettings({
      defaultLaborRate: Number(this.sForm.defaultLaborRate) || 0,
      overheadPercent: Number(this.sForm.overheadPercent) || 0,
      currency: (this.sForm.currency || 'USD').toUpperCase(),
    }).subscribe({
      next: () => { this.busy = false; this.settingsOpen = false; this.snack.open('Settings saved', 'OK', { duration: 2500 }); this.load(); },
      error: (e) => { this.busy = false; this.snack.open(e?.error?.message || 'Could not save settings', 'Dismiss', { duration: 4500 }); },
    });
  }
}
