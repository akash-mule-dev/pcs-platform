import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatTableModule } from '@angular/material/table';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ApiService } from '../core/services/api.service';

@Component({
  selector: 'app-costing',
  standalone: true,
  imports: [CommonModule, FormsModule, MatTableModule, MatFormFieldModule, MatSelectModule, MatProgressSpinnerModule],
  template: `
    <div class="page-shell">
      <div class="page-header"><div>
        <h1 class="page-title">Costing</h1>
        <p class="page-subtitle">Labor + material cost roll-up per work order</p>
      </div></div>

      <div class="panel">
        <mat-form-field appearance="outline" class="grow">
          <mat-label>Work order</mat-label>
          <mat-select [(ngModel)]="selectedId" (selectionChange)="loadCost()">
            @for (w of workOrders; track w.id) { <mat-option [value]="w.id">{{ w.orderNumber }} — {{ w.product?.name || w.productId }}</mat-option> }
          </mat-select>
        </mat-form-field>
      </div>

      @if (loading) { <div class="center"><mat-spinner diameter="36"></mat-spinner></div> }
      @if (cost) {
        <div class="cards">
          <div class="card"><div class="kpi">{{ cost.laborHours }}h</div><div class="lbl">Labor ({{ cost.laborRate | currency }}/h)</div></div>
          <div class="card"><div class="kpi">{{ cost.laborCost | currency }}</div><div class="lbl">Labor cost</div></div>
          <div class="card"><div class="kpi">{{ cost.materialCost | currency }}</div><div class="lbl">Material cost</div></div>
          <div class="card total"><div class="kpi">{{ cost.totalCost | currency }}</div><div class="lbl">Total cost</div></div>
        </div>
        <div class="panel">
          <h3>Material consumed</h3>
          <table mat-table [dataSource]="cost.materials" class="full">
            <ng-container matColumnDef="code"><th mat-header-cell *matHeaderCellDef>Material</th><td mat-cell *matCellDef="let m">{{ m.code }}</td></ng-container>
            <ng-container matColumnDef="qty"><th mat-header-cell *matHeaderCellDef>Qty</th><td mat-cell *matCellDef="let m">{{ m.quantity }}</td></ng-container>
            <ng-container matColumnDef="unit"><th mat-header-cell *matHeaderCellDef>Unit cost</th><td mat-cell *matCellDef="let m">{{ m.unitCost | currency }}</td></ng-container>
            <ng-container matColumnDef="cost"><th mat-header-cell *matHeaderCellDef>Cost</th><td mat-cell *matCellDef="let m">{{ m.cost | currency }}</td></ng-container>
            <tr mat-header-row *matHeaderRowDef="cols"></tr><tr mat-row *matRowDef="let r; columns: cols"></tr>
          </table>
          @if (!cost.materials?.length) { <p class="empty">No material issued to this work order yet.</p> }
        </div>
      }
    </div>
  `,
  styles: [`
    .page-shell { padding:24px; } .page-header { margin-bottom:16px; } .page-title { margin:0; font-size:22px; }
    .page-subtitle { margin:2px 0 0; color: var(--clay-text-muted,#64748b); font-size:13px; }
    .panel { background: var(--clay-surface,#fff); border:1px solid var(--clay-border,#e2e8f0); border-radius:10px; padding:16px; margin-bottom:16px; }
    .panel h3 { margin:0 0 12px; font-size:15px; } .grow { width: 360px; max-width:100%; }
    .cards { display:flex; gap:12px; margin-bottom:16px; flex-wrap:wrap; }
    .card { background: var(--clay-surface,#fff); border:1px solid var(--clay-border,#e2e8f0); border-radius:10px; padding:14px 18px; min-width:150px; }
    .card.total { border-color:#3b82f6; } .card .kpi { font-size:22px; font-weight:600; } .card .lbl { font-size:12px; color: var(--clay-text-muted,#64748b); }
    table.full { width:100%; } .center { display:flex; justify-content:center; padding:32px; } .empty { color: var(--clay-text-muted,#64748b); padding:8px 0; }
  `],
})
export class CostingComponent implements OnInit {
  cols = ['code', 'qty', 'unit', 'cost'];
  workOrders: any[] = [];
  selectedId = '';
  cost: any = null;
  loading = false;

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.api.get<any>('/work-orders').subscribe({
      next: (d) => { this.workOrders = Array.isArray(d) ? d : (d?.data || []); },
      error: () => {},
    });
  }

  loadCost(): void {
    if (!this.selectedId) return;
    this.loading = true;
    this.api.get<any>(`/costing/work-order/${this.selectedId}`).subscribe({
      next: (d) => { this.cost = d?.data ?? d; this.loading = false; },
      error: () => { this.loading = false; },
    });
  }
}
