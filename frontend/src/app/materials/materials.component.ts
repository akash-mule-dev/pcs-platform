import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MaterialsApiService, MaterialSummaryRow, StockMovementRow } from './materials.service';
import { PermissionsService } from '../core/services/permissions.service';

const MATERIAL_TYPES = ['sheet', 'plate', 'bar', 'tube', 'coil', 'fastener', 'consumable', 'component', 'other'];

type PanelMode = 'closed' | 'add' | 'edit' | 'receive' | 'issue' | 'return' | 'adjust';

/**
 * Inventory: material masters with on-hand stock, MOVING-AVERAGE unit cost,
 * stock value, low-stock flags and the full goods-movement ledger. Receiving
 * with a price re-averages the cost; issues/returns are usually done from a
 * work order's Materials tab so they're booked against the order.
 */
@Component({
  selector: 'app-materials',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatProgressSpinnerModule, MatTooltipModule,
  ],
  template: `
    <div class="page-shell">
      <div class="page-header">
        <div>
          <h1 class="page-title">Materials &amp; Inventory</h1>
          <p class="page-subtitle">Raw stock, moving-average costs, values and goods movements</p>
        </div>
        @if (perms.canManage('materials')) {
          <button mat-raised-button color="primary" (click)="openPanel('add')"><mat-icon>add</mat-icon> New Material</button>
        }
      </div>

      <!-- KPI strip -->
      <div class="kpis">
        <div class="kpi-card"><div class="kpi">{{ totals.materials }}</div><div class="lbl">Materials</div></div>
        <div class="kpi-card"><div class="kpi">{{ totals.totalValue | currency }}</div><div class="lbl">Stock value</div></div>
        <div class="kpi-card" [class.warn]="totals.lowStock > 0"><div class="kpi">{{ totals.lowStock }}</div><div class="lbl">Low stock</div></div>
      </div>

      <!-- Filters -->
      <div class="filters">
        <mat-form-field appearance="outline" class="search">
          <mat-label>Search</mat-label>
          <input matInput [(ngModel)]="q" placeholder="Code, name, profile, grade…">
          @if (q) { <button matSuffix mat-icon-button (click)="q = ''"><mat-icon>close</mat-icon></button> }
        </mat-form-field>
        <button class="chip-toggle" [class.on]="lowOnly" (click)="lowOnly = !lowOnly">
          <mat-icon>warning_amber</mat-icon> Low stock only
        </button>
      </div>

      <!-- Inline panel (add / edit / movement forms) -->
      @if (panel !== 'closed') {
        <div class="panel">
          <h3>
            @switch (panel) {
              @case ('add') { New material }
              @case ('edit') { Edit material — {{ sel?.code }} }
              @case ('receive') { Receive into stock — {{ sel?.name }} }
              @case ('issue') { Issue from stock — {{ sel?.name }} }
              @case ('return') { Return to stock — {{ sel?.name }} }
              @case ('adjust') { Adjust on-hand — {{ sel?.name }} }
            }
          </h3>

          @if (panel === 'add' || panel === 'edit') {
            <div class="form-row">
              <mat-form-field appearance="outline"><mat-label>Code</mat-label>
                <input matInput [(ngModel)]="form.code" [disabled]="panel === 'edit'" placeholder="UC203X203X46-S355"></mat-form-field>
              <mat-form-field appearance="outline"><mat-label>Name</mat-label>
                <input matInput [(ngModel)]="form.name" placeholder="UC203x203x46 S355"></mat-form-field>
              <mat-form-field appearance="outline"><mat-label>Type</mat-label>
                <mat-select [(ngModel)]="form.type">
                  @for (t of types; track t) { <mat-option [value]="t">{{ t }}</mat-option> }
                </mat-select></mat-form-field>
              <mat-form-field appearance="outline"><mat-label>Unit</mat-label>
                <input matInput [(ngModel)]="form.unitOfMeasure" placeholder="kg"></mat-form-field>
            </div>
            <div class="form-row">
              <mat-form-field appearance="outline"><mat-label>Profile (BOM match)</mat-label>
                <input matInput [(ngModel)]="form.profile" placeholder="UC203x203x46"></mat-form-field>
              <mat-form-field appearance="outline"><mat-label>Grade (BOM match)</mat-label>
                <input matInput [(ngModel)]="form.materialGrade" placeholder="S355"></mat-form-field>
              <mat-form-field appearance="outline"><mat-label>Unit cost</mat-label>
                <input matInput type="number" min="0" [(ngModel)]="form.unitCost"></mat-form-field>
              <mat-form-field appearance="outline"><mat-label>Reorder level</mat-label>
                <input matInput type="number" min="0" [(ngModel)]="form.reorderLevel"></mat-form-field>
            </div>
            <p class="hint"><mat-icon>info</mat-icon>Profile + grade link this material to imported assembly parts — that match drives project material requirements and one-click issuing.</p>
          }

          @if (panel === 'receive') {
            <div class="form-row">
              <mat-form-field appearance="outline"><mat-label>Quantity ({{ sel?.unitOfMeasure }})</mat-label>
                <input matInput type="number" min="0" [(ngModel)]="move.quantity"></mat-form-field>
              <mat-form-field appearance="outline"><mat-label>Unit cost (optional)</mat-label>
                <input matInput type="number" min="0" [(ngModel)]="move.unitCost" placeholder="{{ sel?.unitCost }}"></mat-form-field>
              <mat-form-field appearance="outline"><mat-label>Reference (PO / supplier)</mat-label>
                <input matInput [(ngModel)]="move.reference"></mat-form-field>
              <mat-form-field appearance="outline"><mat-label>Note</mat-label>
                <input matInput [(ngModel)]="move.note"></mat-form-field>
            </div>
            @if (avgPreview() !== null) {
              <p class="hint"><mat-icon>calculate</mat-icon>New moving-average cost after this receipt: <strong>{{ avgPreview() | currency }}</strong> (now {{ sel?.unitCost | currency }})</p>
            }
          }

          @if (panel === 'issue' || panel === 'return') {
            <div class="form-row">
              <mat-form-field appearance="outline"><mat-label>Quantity ({{ sel?.unitOfMeasure }})</mat-label>
                <input matInput type="number" min="0" [(ngModel)]="move.quantity"></mat-form-field>
              <mat-form-field appearance="outline"><mat-label>Note</mat-label>
                <input matInput [(ngModel)]="move.note"></mat-form-field>
            </div>
            <p class="hint"><mat-icon>info</mat-icon>Tip: issuing from a work order's <strong>Materials</strong> tab books the consumption against that order for costing.</p>
          }

          @if (panel === 'adjust') {
            <div class="form-row">
              <mat-form-field appearance="outline"><mat-label>Counted on-hand ({{ sel?.unitOfMeasure }})</mat-label>
                <input matInput type="number" min="0" [(ngModel)]="move.quantity"></mat-form-field>
              <mat-form-field appearance="outline"><mat-label>Note</mat-label>
                <input matInput [(ngModel)]="move.note" placeholder="Stock count correction"></mat-form-field>
            </div>
          }

          <div class="panel-actions">
            <button mat-button (click)="closePanel()">Cancel</button>
            <button mat-raised-button color="primary" [disabled]="!panelValid() || busy" (click)="savePanel()">
              {{ panelCta() }}
            </button>
          </div>
        </div>
      }

      @if (loading) {
        <div class="center"><mat-spinner diameter="40"></mat-spinner></div>
      } @else {
        <div class="table-wrap">
          <table class="inv">
            <thead>
              <tr>
                <th>Code</th><th>Name</th><th>Profile / Grade</th>
                <th class="num">On hand</th><th class="num">Unit cost</th><th class="num">Value</th>
                <th></th><th class="actions-col">Stock</th>
              </tr>
            </thead>
            <tbody>
              @for (m of filtered(); track m.id) {
                <tr [class.expanded]="historyId === m.id">
                  <td class="mono">{{ m.code }}</td>
                  <td>{{ m.name }}<div class="sub">{{ m.type }} · {{ m.unitOfMeasure }}</div></td>
                  <td>
                    @if (m.profile || m.materialGrade) {
                      <span class="pg">{{ m.profile || '—' }}@if (m.materialGrade) { <em>{{ m.materialGrade }}</em> }</span>
                    } @else { <span class="muted">—</span> }
                  </td>
                  <td class="num" [class.low]="m.lowStock">
                    {{ m.onHand | number:'1.0-3' }}
                    @if (m.lowStock) { <mat-icon class="low-ico" matTooltip="At or below reorder level ({{ m.reorderLevel }})">warning_amber</mat-icon> }
                  </td>
                  <td class="num">{{ m.unitCost | currency }}</td>
                  <td class="num">{{ m.value | currency }}</td>
                  <td class="hist-cell">
                    <button mat-icon-button matTooltip="Movement history" (click)="toggleHistory(m)"><mat-icon>history</mat-icon></button>
                  </td>
                  <td class="actions-col">
                    @if (perms.can('materials.transact')) {
                      <button mat-button color="primary" (click)="openMove('receive', m)">Receive</button>
                      <button mat-button (click)="openMove('issue', m)">Issue</button>
                      <button mat-button (click)="openMove('return', m)">Return</button>
                    }
                    @if (perms.canManage('materials')) {
                      <button mat-icon-button matTooltip="Edit material" (click)="openEdit(m)"><mat-icon>edit</mat-icon></button>
                      <button mat-icon-button matTooltip="Adjust on-hand (count)" (click)="openMove('adjust', m)"><mat-icon>rule</mat-icon></button>
                    }
                  </td>
                </tr>
                @if (historyId === m.id) {
                  <tr class="hist-row"><td colspan="8">
                    @if (historyLoading) { <div class="center small"><mat-spinner diameter="22"></mat-spinner></div> }
                    @else if (history.length === 0) { <p class="muted pad">No movements yet for this material.</p> }
                    @else {
                      <div class="hist-list">
                        @for (mv of history; track mv.id) {
                          <div class="hist-item">
                            <span class="chip mv-{{ mv.type }}">{{ mv.type }}</span>
                            <span class="hq">{{ mv.quantity | number:'1.0-3' }} {{ m.unitOfMeasure }}</span>
                            @if (mv.unitCost !== null) { <span class="hc">&#64; {{ mv.unitCost | currency }}</span> }
                            @if (mv.reference) { <span class="muted">{{ mv.reference }}</span> }
                            @if (mv.note) { <span class="muted note">{{ mv.note }}</span> }
                            <span class="spacer"></span>
                            <span class="muted">{{ mv.createdAt | date:'medium' }}</span>
                          </div>
                        }
                      </div>
                    }
                  </td></tr>
                }
              }
            </tbody>
          </table>
          @if (filtered().length === 0) {
            <div class="empty">
              @if (rows.length === 0) {
                <mat-icon>inventory_2</mat-icon>
                <p>No materials yet. Add raw materials here, or open a project's <strong>Materials</strong> tab and use “Create missing materials” to generate them from the imported design.</p>
              } @else { <p>No materials match the current filter.</p> }
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .page-shell { padding: 24px; }
    .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; gap: 12px; flex-wrap: wrap; }
    .page-title { margin: 0; font-size: 22px; }
    .page-subtitle { margin: 2px 0 0; color: var(--clay-text-muted, #64748b); font-size: 13px; }

    .kpis { display: flex; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
    .kpi-card { background: var(--clay-surface, #fff); border: 1px solid var(--clay-border, #e2e8f0); border-radius: 10px; padding: 12px 18px; min-width: 130px; }
    .kpi-card .kpi { font-size: 20px; font-weight: 700; } .kpi-card .lbl { font-size: 12px; color: var(--clay-text-muted, #64748b); }
    .kpi-card.warn .kpi { color: var(--danger, #dc2626); }

    .filters { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .filters .search { width: 320px; max-width: 100%; }
    .chip-toggle { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--clay-border, #e2e8f0); background: var(--clay-surface, #fff); color: var(--clay-text-muted, #64748b); border-radius: 999px; padding: 7px 14px; font-size: 13px; font-weight: 600; cursor: pointer; }
    .chip-toggle mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .chip-toggle.on { background: var(--warning-bg, #fef3c7); color: var(--warning-text, #92400e); border-color: transparent; }

    .panel { background: var(--clay-surface, #fff); border: 1px solid var(--clay-border, #e2e8f0); border-radius: 10px; padding: 16px; margin-bottom: 16px; }
    .panel h3 { margin: 0 0 12px; font-size: 15px; }
    .form-row { display: flex; flex-wrap: wrap; gap: 12px; }
    .form-row mat-form-field { flex: 1; min-width: 160px; }
    .panel-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
    .hint { display: flex; align-items: center; gap: 6px; color: var(--clay-text-muted, #64748b); font-size: 12.5px; margin: 2px 0 8px; }
    .hint mat-icon { font-size: 16px; width: 16px; height: 16px; }

    .table-wrap { background: var(--clay-surface, #fff); border: 1px solid var(--clay-border, #e2e8f0); border-radius: 10px; overflow-x: auto; }
    table.inv { width: 100%; border-collapse: collapse; font-size: 13.5px; }
    .inv th { text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: .03em; color: var(--clay-text-muted, #64748b); padding: 10px 12px; border-bottom: 1px solid var(--clay-border, #e2e8f0); white-space: nowrap; }
    .inv td { padding: 9px 12px; border-bottom: 1px solid var(--clay-border, #eef2f7); vertical-align: middle; }
    .inv tbody tr:hover { background: var(--clay-bg-warm, #fafaf7); }
    .num { text-align: right; white-space: nowrap; } th.num { text-align: right; }
    .mono { font-family: 'Space Grotesk', monospace; font-weight: 600; }
    .sub { font-size: 11.5px; color: var(--clay-text-muted, #64748b); }
    .pg { font-size: 12.5px; } .pg em { font-style: normal; color: var(--clay-text-muted, #64748b); margin-left: 6px; }
    td.low { color: var(--danger, #dc2626); font-weight: 700; }
    .low-ico { font-size: 15px; width: 15px; height: 15px; vertical-align: -2px; margin-left: 3px; }
    .muted { color: var(--clay-text-muted, #64748b); }
    .actions-col { white-space: nowrap; text-align: right; }
    .hist-cell { width: 40px; }

    .hist-row td { background: var(--clay-bg-warm, #fafaf7); padding: 8px 16px 12px; }
    .hist-list { display: flex; flex-direction: column; gap: 4px; max-height: 240px; overflow-y: auto; }
    .hist-item { display: flex; align-items: center; gap: 10px; font-size: 12.5px; padding: 4px 2px; }
    .hist-item .hq { font-weight: 600; } .hist-item .hc { color: var(--clay-text-muted, #64748b); }
    .hist-item .note { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .chip { padding: 1px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; text-transform: capitalize; }
    .mv-receipt { background: var(--success-bg, #dcfce7); color: var(--success-text, #166534); }
    .mv-return { background: var(--info-bg, #dbeafe); color: var(--info-text, #1e40af); }
    .mv-issue { background: var(--warning-bg, #fef3c7); color: var(--warning-text, #92400e); }
    .mv-scrap { background: var(--danger-bg, #fee2e2); color: var(--danger-text, #991b1b); }
    .mv-adjustment { background: var(--badge-draft-bg, #f1f5f9); color: var(--badge-draft-text, #475569); }
    .spacer { flex: 1; }

    .center { display: flex; justify-content: center; padding: 48px; } .center.small { padding: 16px; }
    .pad { padding: 8px 0; }
    .empty { text-align: center; color: var(--clay-text-muted, #64748b); padding: 36px 24px; }
    .empty mat-icon { font-size: 40px; width: 40px; height: 40px; opacity: .5; }
    .empty p { max-width: 520px; margin: 8px auto 0; }
  `],
})
export class MaterialsComponent implements OnInit {
  readonly types = MATERIAL_TYPES;
  perms = inject(PermissionsService);

  loading = true;
  busy = false;
  rows: MaterialSummaryRow[] = [];
  totals = { materials: 0, totalValue: 0, lowStock: 0 };
  q = '';
  lowOnly = false;

  panel: PanelMode = 'closed';
  sel: MaterialSummaryRow | null = null;
  form: any = this.emptyForm();
  move: any = { quantity: 0, unitCost: null, reference: '', note: '' };

  historyId: string | null = null;
  history: StockMovementRow[] = [];
  historyLoading = false;

  constructor(private api: MaterialsApiService, private snack: MatSnackBar) {}

  ngOnInit(): void { this.load(); }

  private emptyForm() {
    return { code: '', name: '', type: 'other', unitOfMeasure: 'kg', profile: '', materialGrade: '', unitCost: 0, reorderLevel: 0 };
  }

  load(): void {
    this.loading = true;
    this.api.getSummary().subscribe({
      next: (s) => { this.rows = s?.materials ?? []; this.totals = s?.totals ?? this.totals; this.loading = false; },
      error: () => { this.loading = false; this.snack.open('Could not load inventory', 'Dismiss', { duration: 4000 }); },
    });
  }

  filtered(): MaterialSummaryRow[] {
    const q = this.q.trim().toLowerCase();
    return this.rows.filter((m) => {
      if (this.lowOnly && !m.lowStock) return false;
      if (!q) return true;
      return [m.code, m.name, m.profile, m.materialGrade, m.specification, m.type]
        .some((v) => (v ?? '').toLowerCase().includes(q));
    });
  }

  // ── Panels ──────────────────────────────────────────────────────────────────

  openPanel(mode: 'add'): void { this.panel = mode; this.sel = null; this.form = this.emptyForm(); }
  openEdit(m: MaterialSummaryRow): void {
    this.panel = 'edit'; this.sel = m;
    this.form = {
      code: m.code, name: m.name, type: m.type, unitOfMeasure: m.unitOfMeasure,
      profile: m.profile ?? '', materialGrade: m.materialGrade ?? '',
      unitCost: m.unitCost, reorderLevel: m.reorderLevel,
    };
  }
  openMove(mode: 'receive' | 'issue' | 'return' | 'adjust', m: MaterialSummaryRow): void {
    this.panel = mode; this.sel = m;
    this.move = { quantity: mode === 'adjust' ? m.onHand : 0, unitCost: null, reference: '', note: '' };
  }
  closePanel(): void { this.panel = 'closed'; this.sel = null; }

  panelValid(): boolean {
    if (this.panel === 'add' || this.panel === 'edit') return !!(this.form.code && this.form.name);
    if (this.panel === 'adjust') return this.move.quantity >= 0;
    return this.move.quantity > 0;
  }

  panelCta(): string {
    switch (this.panel) {
      case 'add': return this.busy ? 'Saving…' : 'Create material';
      case 'edit': return this.busy ? 'Saving…' : 'Save changes';
      case 'receive': return this.busy ? 'Receiving…' : 'Receive';
      case 'issue': return this.busy ? 'Issuing…' : 'Issue';
      case 'return': return this.busy ? 'Returning…' : 'Return';
      default: return this.busy ? 'Adjusting…' : 'Set on-hand';
    }
  }

  /** Live preview of the post-receipt moving-average cost. */
  avgPreview(): number | null {
    if (this.panel !== 'receive' || !this.sel) return null;
    const qty = Number(this.move.quantity);
    const cost = this.move.unitCost === null || this.move.unitCost === '' ? null : Number(this.move.unitCost);
    if (!qty || qty <= 0 || cost === null || !Number.isFinite(cost)) return null;
    const oh = Math.max(0, this.sel.onHand);
    if (oh <= 0) return Math.round(cost * 100) / 100;
    return Math.round(((oh * this.sel.unitCost + qty * cost) / (oh + qty)) * 100) / 100;
  }

  savePanel(): void {
    if (!this.panelValid() || this.busy) return;
    this.busy = true;
    const done = (msg: string) => { this.busy = false; this.snack.open(msg, 'OK', { duration: 2500 }); this.closePanel(); this.load(); };
    const fail = (e: any, fallback: string) => { this.busy = false; this.snack.open(e?.error?.message || fallback, 'Dismiss', { duration: 4500 }); };

    switch (this.panel) {
      case 'add': {
        const body = { ...this.form, unitCost: Number(this.form.unitCost) || 0, reorderLevel: Number(this.form.reorderLevel) || 0 };
        if (!body.profile) delete body.profile;
        if (!body.materialGrade) delete body.materialGrade;
        this.api.createMaterial(body).subscribe({ next: () => done('Material created'), error: (e) => fail(e, 'Failed to create material') });
        break;
      }
      case 'edit': {
        const { code, ...rest } = this.form;
        const body = { ...rest, profile: this.form.profile || null, materialGrade: this.form.materialGrade || null, unitCost: Number(this.form.unitCost) || 0, reorderLevel: Number(this.form.reorderLevel) || 0 };
        this.api.updateMaterial(this.sel!.id, body).subscribe({ next: () => done('Material updated'), error: (e) => fail(e, 'Failed to update material') });
        break;
      }
      case 'receive': {
        const body: any = { materialId: this.sel!.id, quantity: Number(this.move.quantity), reference: this.move.reference || undefined, note: this.move.note || undefined };
        if (this.move.unitCost !== null && this.move.unitCost !== '') body.unitCost = Number(this.move.unitCost);
        this.api.receive(body).subscribe({ next: () => done('Stock received'), error: (e) => fail(e, 'Receive failed') });
        break;
      }
      case 'issue': {
        this.api.issue({ materialId: this.sel!.id, quantity: Number(this.move.quantity), note: this.move.note || undefined })
          .subscribe({ next: () => done('Stock issued'), error: (e) => fail(e, 'Issue failed') });
        break;
      }
      case 'return': {
        this.api.returnStock({ materialId: this.sel!.id, quantity: Number(this.move.quantity), note: this.move.note || undefined })
          .subscribe({ next: () => done('Stock returned'), error: (e) => fail(e, 'Return failed') });
        break;
      }
      case 'adjust': {
        this.api.adjust({ materialId: this.sel!.id, quantityOnHand: Number(this.move.quantity), note: this.move.note || undefined })
          .subscribe({ next: () => done('On-hand adjusted'), error: (e) => fail(e, 'Adjustment failed') });
        break;
      }
    }
  }

  // ── Movement history ────────────────────────────────────────────────────────

  toggleHistory(m: MaterialSummaryRow): void {
    if (this.historyId === m.id) { this.historyId = null; return; }
    this.historyId = m.id;
    this.historyLoading = true;
    this.history = [];
    this.api.getMovements({ materialId: m.id }).subscribe({
      next: (rows) => { this.history = rows ?? []; this.historyLoading = false; },
      error: () => { this.historyLoading = false; },
    });
  }
}
