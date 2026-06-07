import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MaterialsApiService } from './materials.service';

const MATERIAL_TYPES = ['sheet', 'plate', 'bar', 'tube', 'coil', 'fastener', 'consumable', 'component', 'other'];

@Component({
  selector: 'app-materials',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatTableModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatProgressSpinnerModule,
  ],
  template: `
    <div class="page-shell">
      <div class="page-header">
        <div>
          <h1 class="page-title">Materials &amp; Inventory</h1>
          <p class="page-subtitle">Raw stock, on-hand quantities and goods movements</p>
        </div>
        <button mat-raised-button color="primary" (click)="showAdd = !showAdd">
          <mat-icon>add</mat-icon> New Material
        </button>
      </div>

      @if (showAdd) {
        <div class="panel">
          <h3>New material</h3>
          <div class="form-row">
            <mat-form-field appearance="outline"><mat-label>Code</mat-label>
              <input matInput [(ngModel)]="newMat.code" placeholder="SS304-2MM"></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>Name</mat-label>
              <input matInput [(ngModel)]="newMat.name" placeholder="SS304 sheet 2mm"></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>Type</mat-label>
              <mat-select [(ngModel)]="newMat.type">
                @for (t of types; track t) { <mat-option [value]="t">{{ t }}</mat-option> }
              </mat-select></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>Unit</mat-label>
              <input matInput [(ngModel)]="newMat.unitOfMeasure" placeholder="sheet"></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>Reorder level</mat-label>
              <input matInput type="number" [(ngModel)]="newMat.reorderLevel"></mat-form-field>
          </div>
          <div class="panel-actions">
            <button mat-button (click)="showAdd = false">Cancel</button>
            <button mat-raised-button color="primary" [disabled]="!newMat.code || !newMat.name" (click)="saveMaterial()">Save</button>
          </div>
        </div>
      }

      @if (move.open) {
        <div class="panel">
          <h3>{{ move.mode === 'receive' ? 'Receive into' : 'Issue from' }} stock — {{ move.materialName }}</h3>
          <div class="form-row">
            <mat-form-field appearance="outline"><mat-label>Quantity</mat-label>
              <input matInput type="number" [(ngModel)]="move.quantity"></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>Note</mat-label>
              <input matInput [(ngModel)]="move.note"></mat-form-field>
          </div>
          <div class="panel-actions">
            <button mat-button (click)="move.open = false">Cancel</button>
            <button mat-raised-button color="primary" [disabled]="!(move.quantity > 0)" (click)="saveMove()">
              {{ move.mode === 'receive' ? 'Receive' : 'Issue' }}
            </button>
          </div>
        </div>
      }

      @if (loading) {
        <div class="center"><mat-spinner diameter="40"></mat-spinner></div>
      } @else {
        <table mat-table [dataSource]="rows" class="mat-elevation-z1 full">
          <ng-container matColumnDef="code">
            <th mat-header-cell *matHeaderCellDef>Code</th>
            <td mat-cell *matCellDef="let m">{{ m.code }}</td>
          </ng-container>
          <ng-container matColumnDef="name">
            <th mat-header-cell *matHeaderCellDef>Name</th>
            <td mat-cell *matCellDef="let m">{{ m.name }}</td>
          </ng-container>
          <ng-container matColumnDef="type">
            <th mat-header-cell *matHeaderCellDef>Type</th>
            <td mat-cell *matCellDef="let m">{{ m.type }}</td>
          </ng-container>
          <ng-container matColumnDef="onHand">
            <th mat-header-cell *matHeaderCellDef>On hand</th>
            <td mat-cell *matCellDef="let m" [class.low]="m.onHand <= (m.reorderLevel || 0)">
              {{ m.onHand }} {{ m.unitOfMeasure }}
            </td>
          </ng-container>
          <ng-container matColumnDef="reserved">
            <th mat-header-cell *matHeaderCellDef>Reserved</th>
            <td mat-cell *matCellDef="let m">{{ m.reserved }}</td>
          </ng-container>
          <ng-container matColumnDef="actions">
            <th mat-header-cell *matHeaderCellDef>Stock</th>
            <td mat-cell *matCellDef="let m">
              <button mat-button color="primary" (click)="openMove('receive', m)">Receive</button>
              <button mat-button (click)="openMove('issue', m)">Issue</button>
            </td>
          </ng-container>
          <tr mat-header-row *matHeaderRowDef="columns"></tr>
          <tr mat-row *matRowDef="let row; columns: columns"></tr>
        </table>
        @if (rows.length === 0) { <p class="empty">No materials yet. Add your first raw material.</p> }
      }
    </div>
  `,
  styles: [`
    .page-shell { padding: 24px; }
    .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .page-title { margin: 0; font-size: 22px; }
    .page-subtitle { margin: 2px 0 0; color: var(--clay-text-muted, #64748b); font-size: 13px; }
    .panel { background: var(--clay-surface, #fff); border: 1px solid var(--clay-border, #e2e8f0); border-radius: 10px; padding: 16px; margin-bottom: 16px; }
    .panel h3 { margin: 0 0 12px; font-size: 15px; }
    .form-row { display: flex; flex-wrap: wrap; gap: 12px; }
    .form-row mat-form-field { flex: 1; min-width: 160px; }
    .panel-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
    table.full { width: 100%; }
    td.low { color: #dc2626; font-weight: 600; }
    .center { display: flex; justify-content: center; padding: 48px; }
    .empty { text-align: center; color: var(--clay-text-muted, #64748b); padding: 24px; }
  `],
})
export class MaterialsComponent implements OnInit {
  readonly types = MATERIAL_TYPES;
  columns = ['code', 'name', 'type', 'onHand', 'reserved', 'actions'];

  loading = true;
  rows: any[] = [];
  showAdd = false;
  newMat: any = { code: '', name: '', type: 'other', unitOfMeasure: 'ea', reorderLevel: 0 };
  move: any = { open: false, mode: 'receive', materialId: '', materialName: '', quantity: 0, note: '' };

  constructor(private api: MaterialsApiService, private snack: MatSnackBar) {}

  ngOnInit(): void { this.load(); }

  load(): void {
    this.loading = true;
    forkJoin({
      materials: this.api.listMaterials(),
      stock: this.api.getStock(),
    }).subscribe({
      next: ({ materials, stock }) => {
        const mats = Array.isArray(materials) ? materials : (materials?.data || []);
        const stk = Array.isArray(stock) ? stock : (stock?.data || []);
        const byMaterial: Record<string, { onHand: number; reserved: number }> = {};
        for (const s of stk) {
          const agg = byMaterial[s.materialId] || { onHand: 0, reserved: 0 };
          agg.onHand += Number(s.quantityOnHand) || 0;
          agg.reserved += Number(s.quantityReserved) || 0;
          byMaterial[s.materialId] = agg;
        }
        this.rows = mats.map((m: any) => ({
          ...m,
          onHand: byMaterial[m.id]?.onHand ?? 0,
          reserved: byMaterial[m.id]?.reserved ?? 0,
        }));
        this.loading = false;
      },
      error: () => { this.loading = false; },
    });
  }

  saveMaterial(): void {
    this.api.createMaterial(this.newMat).subscribe({
      next: () => {
        this.snack.open('Material created', 'OK', { duration: 2500 });
        this.showAdd = false;
        this.newMat = { code: '', name: '', type: 'other', unitOfMeasure: 'ea', reorderLevel: 0 };
        this.load();
      },
      error: (e) => this.snack.open(e?.error?.message || 'Failed to create material', 'Dismiss', { duration: 4000 }),
    });
  }

  openMove(mode: 'receive' | 'issue', m: any): void {
    this.move = { open: true, mode, materialId: m.id, materialName: m.name, quantity: 0, note: '' };
  }

  saveMove(): void {
    const body = { materialId: this.move.materialId, quantity: Number(this.move.quantity), note: this.move.note };
    const op = this.move.mode === 'receive' ? this.api.receive(body) : this.api.issue(body);
    op.subscribe({
      next: () => {
        this.snack.open(this.move.mode === 'receive' ? 'Stock received' : 'Stock issued', 'OK', { duration: 2500 });
        this.move.open = false;
        this.load();
      },
      error: (e) => this.snack.open(e?.error?.message || 'Movement failed', 'Dismiss', { duration: 4000 }),
    });
  }
}
