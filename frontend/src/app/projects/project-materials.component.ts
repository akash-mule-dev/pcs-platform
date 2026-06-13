import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ProjectWorkspaceStore } from './project-workspace.store';
import { MaterialPlanningService, ProjectRequirements, RequirementLine } from '../core/services/material-planning.service';
import { PermissionsService } from '../core/services/permissions.service';

/**
 * Project MATERIALS tab — the per-unit bill of materials, straight from the
 * imported assembly tree (parts grouped by profile + grade), matched against
 * the material masters in inventory. The project is a pure design container:
 * these numbers are PER DESIGN UNIT — each work order multiplies them by its
 * own quantity (see the order's Materials tab).
 */
@Component({
  selector: 'app-project-materials',
  standalone: true,
  imports: [CommonModule, RouterModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule],
  template: `
    @if (error) { <p class="banner err">{{ error }}</p> }

    @if (loading) {
      <div class="center"><mat-spinner diameter="32"></mat-spinner></div>
    } @else if (data) {
      <!-- Summary strip -->
      <div class="kpis">
        <div class="kpi-card"><div class="kpi">{{ data.totals.lines }}</div><div class="lbl">Material lines</div></div>
        <div class="kpi-card"><div class="kpi">{{ data.totals.pieces | number }}</div><div class="lbl">Pieces / unit</div></div>
        <div class="kpi-card"><div class="kpi">{{ data.totals.weightKg | number:'1.0-0' }} kg</div><div class="lbl">Steel / unit</div></div>
        <div class="kpi-card"><div class="kpi">{{ data.totals.estimatedCost | currency }}</div><div class="lbl">Est. material / unit</div></div>
        @if (data.totals.unmappedLines > 0) {
          <div class="kpi-card warn"><div class="kpi">{{ data.totals.unmappedLines }}</div><div class="lbl">Unmapped lines</div></div>
        }
      </div>

      <div class="head-row">
        <p class="hint"><mat-icon>info</mat-icon>Quantities are <strong>per design unit</strong> — a work order for quantity N needs N× these amounts (tracked on its Materials tab).</p>
        @if (data.totals.unmappedLines > 0 && perms.canManage('materials')) {
          <button class="btn primary" [disabled]="syncing" (click)="sync()">
            <mat-icon>auto_fix_high</mat-icon>{{ syncing ? 'Creating…' : 'Create missing materials (' + data.totals.unmappedLines + ')' }}
          </button>
        }
      </div>
      @if (data.totals.unpricedLines > 0) {
        <p class="banner warn"><mat-icon>payments</mat-icon>{{ data.totals.unpricedLines }} matched material(s) have no unit cost yet — estimates exclude them. Set costs on the <a routerLink="/materials">Inventory</a> page (or receive stock with a price).</p>
      }

      @if (data.lines.length === 0) {
        <div class="empty-state">
          <mat-icon>category</mat-icon>
          <h3>No material requirement yet</h3>
          <p>Import an IFC model on the <strong>Assemblies &amp; 3D</strong> tab — part profiles, grades and weights from the design drive this bill of materials automatically.</p>
        </div>
      } @else {
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Profile</th><th>Grade</th>
                <th class="num">Pieces</th><th class="num">Total length</th><th class="num">Total weight</th>
                <th>Stock material</th><th class="num">Required</th><th class="num">On hand</th>
                <th class="num">Est. cost</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              @for (l of data.lines; track l.key) {
                <tr>
                  <td class="mono">{{ l.profile || '—' }}</td>
                  <td>{{ l.materialGrade || '—' }}</td>
                  <td class="num">{{ l.pieceCount | number }}</td>
                  <td class="num">{{ l.totalLengthMm > 0 ? ((l.totalLengthMm / 1000) | number:'1.0-1') + ' m' : '—' }}</td>
                  <td class="num">{{ l.totalWeightKg | number:'1.0-1' }} kg</td>
                  <td>
                    @if (l.material) { <span class="mono sm">{{ l.material.code }}</span> }
                    @else { <span class="muted">not mapped</span> }
                  </td>
                  <td class="num">{{ l.material ? (l.requiredQty | number:'1.0-2') + ' ' + l.uom : '—' }}</td>
                  <td class="num" [class.low]="l.material && l.material.onHand < l.requiredQty">
                    {{ l.material ? (l.material.onHand | number:'1.0-2') : '—' }}
                  </td>
                  <td class="num">{{ l.estimatedCost !== null ? (l.estimatedCost | currency) : '—' }}</td>
                  <td>
                    @if (!l.material) { <span class="chip st-unmapped" matTooltip="No material master with this profile + grade — create one to track stock and cost">unmapped</span> }
                    @else if ((l.material.unitCost || 0) <= 0) { <span class="chip st-unpriced" matTooltip="Material exists but has no unit cost yet">no price</span> }
                    @else if (l.material.onHand >= l.requiredQty) { <span class="chip st-ok">in stock</span> }
                    @else { <span class="chip st-short" matTooltip="On hand covers part of one unit">short</span> }
                  </td>
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
    .banner { display: flex; align-items: center; gap: 6px; border-radius: var(--clay-radius-sm); padding: 10px 12px; font-size: 13px; margin: 0 0 12px; }
    .banner mat-icon { font-size: 18px; width: 18px; height: 18px; flex-shrink: 0; }
    .banner.err { background: var(--danger-bg); color: var(--danger-text); }
    .banner.warn { background: var(--warning-bg); color: var(--warning-text); }
    .banner a { color: inherit; font-weight: 700; }

    .kpis { display: flex; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
    .kpi-card { background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius); padding: 10px 16px; min-width: 120px; box-shadow: var(--clay-shadow-soft); }
    .kpi-card .kpi { font-size: 18px; font-weight: 700; color: var(--clay-text); }
    .kpi-card .lbl { font-size: 11.5px; color: var(--clay-text-muted); }
    .kpi-card.warn .kpi { color: var(--danger-text); }

    .head-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
    .hint { display: flex; align-items: center; gap: 6px; color: var(--clay-text-muted); font-size: 12.5px; margin: 0; }
    .hint mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .btn { display: inline-flex; align-items: center; gap: 5px; border-radius: var(--clay-radius-sm); padding: 8px 14px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; border: 1px solid var(--clay-border); transition: all .15s; }
    .btn mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .btn.primary { background: var(--clay-primary); color: #fff; border-color: var(--clay-primary); }
    .btn.primary:hover:not(:disabled) { filter: brightness(1.08); }
    .btn:disabled { opacity: .5; cursor: default; }

    .empty-state { text-align: center; padding: 56px 24px; color: var(--clay-text-muted); }
    .empty-state mat-icon { font-size: 44px; width: 44px; height: 44px; opacity: .5; }
    .empty-state h3 { margin: 10px 0 4px; color: var(--clay-text); }
    .empty-state p { max-width: 480px; margin: 0 auto; font-size: 13.5px; }

    .table-wrap { background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius); overflow-x: auto; box-shadow: var(--clay-shadow-soft); }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; font-size: 11.5px; text-transform: uppercase; letter-spacing: .03em; color: var(--clay-text-muted); padding: 10px 12px; border-bottom: 1px solid var(--clay-border); white-space: nowrap; }
    td { padding: 8px 12px; border-bottom: 1px solid var(--clay-border); }
    tbody tr:last-child td { border-bottom: none; }
    tbody tr:hover { background: var(--clay-bg-warm); }
    .num { text-align: right; white-space: nowrap; } th.num { text-align: right; }
    .mono { font-family: 'Space Grotesk', monospace; font-weight: 600; } .mono.sm { font-size: 12px; }
    .muted { color: var(--clay-text-muted); }
    td.low { color: var(--danger-text); font-weight: 700; }
    .chip { padding: 1px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; white-space: nowrap; }
    .st-ok { background: var(--success-bg); color: var(--success-text); }
    .st-short { background: var(--warning-bg); color: var(--warning-text); }
    .st-unmapped { background: var(--danger-bg); color: var(--danger-text); }
    .st-unpriced { background: var(--badge-draft-bg); color: var(--badge-draft-text); }
  `],
})
export class ProjectMaterialsComponent implements OnInit {
  store = inject(ProjectWorkspaceStore);
  perms = inject(PermissionsService);
  private svc = inject(MaterialPlanningService);
  private snack = inject(MatSnackBar);

  data: ProjectRequirements | null = null;
  loading = true;
  syncing = false;
  error: string | null = null;

  ngOnInit(): void { this.load(); }

  load(): void {
    this.loading = true;
    this.svc.projectRequirements(this.store.id()).subscribe({
      next: (d) => { this.data = d; this.loading = false; },
      error: (e) => { this.loading = false; this.error = e?.error?.message || 'Could not load material requirements.'; },
    });
  }

  sync(): void {
    if (this.syncing) return;
    this.syncing = true;
    this.svc.syncMaterials(this.store.id()).subscribe({
      next: (r) => {
        this.syncing = false;
        this.snack.open(`${r.created.length} material(s) created — set their unit costs in Inventory`, 'OK', { duration: 4000 });
        this.load();
      },
      error: (e) => { this.syncing = false; this.snack.open(e?.error?.message || 'Could not create materials', 'Dismiss', { duration: 4000 }); },
    });
  }

  trackLine(_: number, l: RequirementLine): string { return l.key; }
}
