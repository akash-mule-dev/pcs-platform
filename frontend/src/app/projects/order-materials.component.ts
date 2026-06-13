import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ProjectWorkspaceStore } from './project-workspace.store';
import { MaterialPlanningService, OrderRequirements, RequirementLine } from '../core/services/material-planning.service';
import { MaterialsApiService, StockMovementRow } from '../materials/materials.service';
import { PermissionsService } from '../core/services/permissions.service';

/**
 * Order MATERIALS tab — the project's per-unit BOM × THIS order's quantity,
 * with live fulfillment: what's been issued from stock (net of returns), what
 * remains, and whether on-hand covers it. Issuing here books the consumption
 * against this order, which is exactly what the Costs tab reads.
 */
@Component({
  selector: 'app-order-materials',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule],
  template: `
    @if (error) { <p class="banner err">{{ error }}</p> }

    @if (loading) {
      <div class="center"><mat-spinner diameter="32"></mat-spinner></div>
    } @else if (data) {
      <div class="kpis">
        <div class="kpi-card"><div class="kpi">×{{ data.orderQuantity }}</div><div class="lbl">Order quantity</div></div>
        <div class="kpi-card"><div class="kpi">{{ data.totals.weightKg | number:'1.0-0' }} kg</div><div class="lbl">Steel required</div></div>
        <div class="kpi-card"><div class="kpi">{{ data.totals.estimatedCost | currency }}</div><div class="lbl">Est. material cost</div></div>
        <div class="kpi-card"><div class="kpi">{{ data.totals.issuedCost | currency }}</div><div class="lbl">Issued so far</div></div>
        @if (data.totals.shortLines > 0) {
          <div class="kpi-card warn"><div class="kpi">{{ data.totals.shortLines }}</div><div class="lbl">Lines short on stock</div></div>
        }
      </div>

      @if (data.totals.unmappedLines > 0) {
        <p class="banner warn">
          <mat-icon>link_off</mat-icon>
          {{ data.totals.unmappedLines }} line(s) have no matching material master — they can't be issued or costed yet.
          <a [routerLink]="['/projects', data.projectId, 'materials']">Open the project's Materials tab</a> to create them in one click.
        </p>
      }

      @if (data.lines.length === 0) {
        <div class="empty-state">
          <mat-icon>category</mat-icon>
          <h3>No material requirement</h3>
          <p>This project has no imported parts yet — import an IFC model and the bill of materials appears here automatically, multiplied by this order's quantity.</p>
        </div>
      } @else {
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Profile / Grade</th><th>Material</th>
                <th class="num">Required</th><th class="num">Issued</th><th class="num">Remaining</th><th class="num">On hand</th>
                <th>Status</th>
                @if (canTransact) { <th class="actions">Issue</th> }
              </tr>
            </thead>
            <tbody>
              @for (l of data.lines; track l.key) {
                <tr [class.dim]="l.status === 'issued'">
                  <td>
                    <span class="mono">{{ l.profile || '—' }}</span>
                    @if (l.materialGrade) { <span class="muted grade">{{ l.materialGrade }}</span> }
                    <div class="sub">{{ l.pieceCount | number }} pcs · {{ l.totalWeightKg | number:'1.0-0' }} kg</div>
                  </td>
                  <td>
                    @if (l.material) { <span class="mono sm">{{ l.material.code }}</span> }
                    @else { <span class="muted">not mapped</span> }
                  </td>
                  <td class="num">{{ l.material ? (l.requiredQty | number:'1.0-2') + ' ' + l.uom : (l.totalWeightKg | number:'1.0-0') + ' kg' }}</td>
                  <td class="num">{{ (l.issuedQty ?? 0) | number:'1.0-2' }}</td>
                  <td class="num strong">{{ (l.remainingQty ?? 0) | number:'1.0-2' }}</td>
                  <td class="num" [class.low]="l.status === 'short'">{{ l.material ? (l.material.onHand | number:'1.0-2') : '—' }}</td>
                  <td>
                    @switch (l.status) {
                      @case ('unmapped') { <span class="chip st-unmapped">unmapped</span> }
                      @case ('issued') { <span class="chip st-issued"><mat-icon>check</mat-icon>issued</span> }
                      @case ('covered') { <span class="chip st-ok">stock covers</span> }
                      @case ('short') { <span class="chip st-short" [matTooltip]="'Short by ' + (l.shortfallQty | number:'1.0-2') + ' ' + l.uom + ' — receive stock first'">short {{ l.shortfallQty | number:'1.0-2' }}</span> }
                    }
                  </td>
                  @if (canTransact) {
                    <td class="actions">
                      @if (l.material && (l.remainingQty ?? 0) > 0) {
                        @if (issueKey !== l.key) {
                          <button class="btn outline sm" (click)="startIssue(l)"><mat-icon>output</mat-icon>Issue</button>
                        } @else {
                          <span class="issue-row">
                            <input type="number" min="0" [(ngModel)]="issueQty" [max]="maxIssuable(l)">
                            <span class="muted">{{ l.uom }}</span>
                            <button class="btn primary sm" [disabled]="busy || !(issueQty > 0)" (click)="confirmIssue(l)">{{ busy ? '…' : 'Confirm' }}</button>
                            <button class="icon-x" (click)="issueKey = null"><mat-icon>close</mat-icon></button>
                          </span>
                        }
                      }
                    </td>
                  }
                </tr>
              }
            </tbody>
          </table>
        </div>
      }

      <!-- Off-BOM consumption -->
      @if (data.extras.length > 0) {
        <h3 class="sec"><mat-icon>playlist_add</mat-icon>Additional materials issued to this order</h3>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Material</th><th class="num">Issued</th><th class="num">Cost</th></tr></thead>
            <tbody>
              @for (e of data.extras; track e.material.id) {
                <tr>
                  <td><span class="mono sm">{{ e.material.code }}</span> {{ e.material.name }}</td>
                  <td class="num">{{ e.issuedQty | number:'1.0-2' }} {{ e.material.unitOfMeasure }}</td>
                  <td class="num">{{ e.issuedCost | currency }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }

      <!-- Movement history for this order -->
      <h3 class="sec"><mat-icon>history</mat-icon>Issue history</h3>
      @if (movements.length === 0) {
        <p class="muted pad">Nothing issued to this work order yet. Issue material above once stages start consuming stock.</p>
      } @else {
        <div class="hist-list">
          @for (mv of movements; track mv.id) {
            <div class="hist-item">
              <span class="chip mv-{{ mv.type }}">{{ mv.type }}</span>
              <span class="strong">{{ mv.material?.code }}</span>
              <span>{{ mv.quantity | number:'1.0-2' }} {{ mv.material?.unitOfMeasure }}</span>
              @if (mv.unitCost !== null) { <span class="muted">&#64; {{ mv.unitCost | currency }}</span> }
              @if (mv.note) { <span class="muted note">{{ mv.note }}</span> }
              <span class="spacer"></span>
              @if (canTransact && mv.type === 'issue') {
                <button class="btn outline sm" matTooltip="Return this quantity to stock" (click)="returnMovement(mv)"><mat-icon>undo</mat-icon>Return</button>
              }
              <span class="muted">{{ mv.createdAt | date:'short' }}</span>
            </div>
          }
        </div>
      }
    }
  `,
  styles: [`
    .center { display: flex; justify-content: center; padding: 48px 0; }
    .banner { display: flex; align-items: center; gap: 6px; border-radius: var(--clay-radius-sm); padding: 10px 12px; font-size: 13px; margin: 0 0 12px; flex-wrap: wrap; }
    .banner mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .banner.err { background: var(--danger-bg); color: var(--danger-text); }
    .banner.warn { background: var(--warning-bg); color: var(--warning-text); }
    .banner a { color: inherit; font-weight: 700; }

    .kpis { display: flex; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
    .kpi-card { background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius); padding: 10px 16px; min-width: 120px; box-shadow: var(--clay-shadow-soft); }
    .kpi-card .kpi { font-size: 18px; font-weight: 700; color: var(--clay-text); }
    .kpi-card .lbl { font-size: 11.5px; color: var(--clay-text-muted); }
    .kpi-card.warn .kpi { color: var(--danger-text); }

    .empty-state { text-align: center; padding: 56px 24px; color: var(--clay-text-muted); }
    .empty-state mat-icon { font-size: 44px; width: 44px; height: 44px; opacity: .5; }
    .empty-state h3 { margin: 10px 0 4px; color: var(--clay-text); }
    .empty-state p { max-width: 480px; margin: 0 auto; font-size: 13.5px; }

    .table-wrap { background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius); overflow-x: auto; box-shadow: var(--clay-shadow-soft); margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; font-size: 11.5px; text-transform: uppercase; letter-spacing: .03em; color: var(--clay-text-muted); padding: 10px 12px; border-bottom: 1px solid var(--clay-border); white-space: nowrap; }
    td { padding: 8px 12px; border-bottom: 1px solid var(--clay-border); vertical-align: middle; }
    tbody tr:last-child td { border-bottom: none; }
    tbody tr:hover { background: var(--clay-bg-warm); }
    tr.dim { opacity: .65; }
    .num { text-align: right; white-space: nowrap; } th.num { text-align: right; }
    .mono { font-family: 'Space Grotesk', monospace; font-weight: 600; } .mono.sm { font-size: 12px; }
    .muted { color: var(--clay-text-muted); } .strong { font-weight: 700; }
    .grade { margin-left: 6px; font-size: 12px; }
    .sub { font-size: 11.5px; color: var(--clay-text-muted); }
    td.low { color: var(--danger-text); font-weight: 700; }
    .actions { white-space: nowrap; text-align: right; } th.actions { text-align: right; }

    .chip { display: inline-flex; align-items: center; gap: 3px; padding: 1px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; white-space: nowrap; }
    .chip mat-icon { font-size: 13px; width: 13px; height: 13px; }
    .st-ok { background: var(--success-bg); color: var(--success-text); }
    .st-short { background: var(--warning-bg); color: var(--warning-text); }
    .st-unmapped { background: var(--danger-bg); color: var(--danger-text); }
    .st-issued { background: var(--info-bg); color: var(--info-text); }
    .mv-receipt { background: var(--success-bg); color: var(--success-text); }
    .mv-return { background: var(--info-bg); color: var(--info-text); }
    .mv-issue { background: var(--warning-bg); color: var(--warning-text); }
    .mv-scrap { background: var(--danger-bg); color: var(--danger-text); }
    .mv-adjustment { background: var(--badge-draft-bg); color: var(--badge-draft-text); }

    .btn { display: inline-flex; align-items: center; gap: 4px; border-radius: var(--clay-radius-sm); padding: 6px 12px; font-size: 12.5px; font-weight: 600; cursor: pointer; font-family: inherit; border: 1px solid var(--clay-border); transition: all .15s; }
    .btn mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .btn.sm { padding: 4px 10px; font-size: 12px; }
    .btn.primary { background: var(--clay-primary); color: #fff; border-color: var(--clay-primary); }
    .btn.outline { background: transparent; color: var(--clay-primary); border-color: var(--clay-primary); }
    .btn.outline:hover:not(:disabled) { background: var(--info-bg); }
    .btn:disabled { opacity: .5; cursor: default; }
    .issue-row { display: inline-flex; align-items: center; gap: 6px; }
    .issue-row input { width: 90px; padding: 5px 8px; border: 1px solid var(--clay-border); border-radius: var(--clay-radius-xs); font-size: 13px; background: var(--clay-surface); color: var(--clay-text); font-family: inherit; }
    .icon-x { width: 26px; height: 26px; border: none; background: transparent; color: var(--clay-text-muted); border-radius: var(--clay-radius-xs); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
    .icon-x mat-icon { font-size: 16px; width: 16px; height: 16px; }

    .sec { display: flex; align-items: center; gap: 7px; font-size: 15px; font-weight: 700; color: var(--clay-text); margin: 18px 0 10px; }
    .sec mat-icon { font-size: 19px; width: 19px; height: 19px; color: var(--clay-text-muted); }
    .pad { padding: 4px 0 12px; font-size: 13px; }
    .hist-list { display: flex; flex-direction: column; gap: 6px; }
    .hist-item { display: flex; align-items: center; gap: 10px; font-size: 12.5px; background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius-sm); padding: 8px 12px; flex-wrap: wrap; }
    .hist-item .note { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .spacer { flex: 1; }
  `],
})
export class OrderMaterialsComponent implements OnInit {
  store = inject(ProjectWorkspaceStore);
  private route = inject(ActivatedRoute);
  private planning = inject(MaterialPlanningService);
  private inventory = inject(MaterialsApiService);
  private perms = inject(PermissionsService);
  private snack = inject(MatSnackBar);

  orderId = '';
  data: OrderRequirements | null = null;
  movements: StockMovementRow[] = [];
  loading = true;
  busy = false;
  error: string | null = null;

  issueKey: string | null = null;
  issueQty = 0;

  get canTransact(): boolean { return this.perms.can('materials.transact'); }

  ngOnInit(): void {
    this.orderId = this.route.parent?.snapshot.paramMap.get('orderId')
      ?? this.route.snapshot.paramMap.get('orderId') ?? '';
    this.load();
  }

  load(): void {
    if (!this.orderId) return;
    this.loading = true;
    this.planning.orderRequirements(this.orderId).subscribe({
      next: (d) => { this.data = d; this.loading = false; },
      error: (e) => { this.loading = false; this.error = e?.error?.message || 'Could not load the order material requirements.'; },
    });
    this.inventory.getMovements({ productionOrderId: this.orderId }).subscribe({
      next: (rows) => (this.movements = rows ?? []),
      error: () => {},
    });
  }

  maxIssuable(l: RequirementLine): number {
    return Math.min(l.remainingQty ?? 0, l.material?.onHand ?? 0);
  }

  startIssue(l: RequirementLine): void {
    this.issueKey = l.key;
    // Sensible default: the remaining requirement, capped at what's on hand.
    this.issueQty = Math.round(this.maxIssuable(l) * 100) / 100;
  }

  confirmIssue(l: RequirementLine): void {
    if (!l.material || this.busy || !(this.issueQty > 0)) return;
    this.busy = true;
    this.inventory.issue({
      materialId: l.material.id,
      quantity: Number(this.issueQty),
      productionOrderId: this.orderId,
      note: `For ${this.data?.orderNumber} — ${l.profile ?? ''} ${l.materialGrade ?? ''}`.trim(),
    }).subscribe({
      next: () => { this.busy = false; this.issueKey = null; this.snack.open('Material issued to this work order', 'OK', { duration: 2500 }); this.load(); },
      error: (e) => { this.busy = false; this.snack.open(e?.error?.message || 'Issue failed', 'Dismiss', { duration: 4500 }); },
    });
  }

  returnMovement(mv: StockMovementRow): void {
    if (this.busy || !mv.material) return;
    this.busy = true;
    this.inventory.returnStock({
      materialId: mv.material.id,
      quantity: mv.quantity,
      productionOrderId: this.orderId,
      note: `Return of issue ${mv.id.slice(0, 8)}`,
    }).subscribe({
      next: () => { this.busy = false; this.snack.open('Returned to stock', 'OK', { duration: 2500 }); this.load(); },
      error: (e) => { this.busy = false; this.snack.open(e?.error?.message || 'Return failed', 'Dismiss', { duration: 4500 }); },
    });
  }
}
