import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ApiService } from '../core/services/api.service';

@Component({
  selector: 'app-traceability',
  standalone: true,
  imports: [CommonModule, FormsModule, MatTableModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule],
  template: `
    <div class="page-shell">
      <div class="page-header"><div>
        <h1 class="page-title">Traceability</h1>
        <p class="page-subtitle">Material lots / heat numbers, output serials and genealogy</p>
      </div></div>

      <div class="grid2">
        <div class="panel">
          <h3>Material lots</h3>
          <div class="form-row">
            <mat-form-field appearance="outline"><mat-label>Material ID</mat-label><input matInput [(ngModel)]="newLot.materialId"></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>Lot / heat #</mat-label><input matInput [(ngModel)]="newLot.lotNumber"></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>Qty</mat-label><input matInput type="number" [(ngModel)]="newLot.receivedQuantity"></mat-form-field>
            <button mat-raised-button color="primary" [disabled]="!newLot.materialId||!newLot.lotNumber" (click)="addLot()">Add</button>
          </div>
          @for (l of lots; track l.id) { <div class="li">{{ l.lotNumber }} <em>(heat {{ l.heatNumber || '—' }})</em> · rem {{ l.remainingQuantity }}</div> }
          @if (!lots.length) { <p class="empty">No lots recorded.</p> }
        </div>

        <div class="panel">
          <h3>Serials</h3>
          <div class="form-row">
            <mat-form-field appearance="outline"><mat-label>Serial #</mat-label><input matInput [(ngModel)]="newSerial.serialNumber"></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>Product ID</mat-label><input matInput [(ngModel)]="newSerial.productId"></mat-form-field>
            <button mat-raised-button color="primary" [disabled]="!newSerial.serialNumber||!newSerial.productId" (click)="addSerial()">Add</button>
          </div>
          @for (s of serials; track s.id) { <div class="li">{{ s.serialNumber }} · {{ s.status }}</div> }
          @if (!serials.length) { <p class="empty">No serials recorded.</p> }
        </div>
      </div>

      <div class="panel">
        <h3>Trace lookup</h3>
        <div class="form-row">
          <mat-form-field appearance="outline" class="grow"><mat-label>Serial ID → what it's made of</mat-label><input matInput [(ngModel)]="traceSerialId"></mat-form-field>
          <button mat-raised-button (click)="trace()">Trace</button>
          <mat-form-field appearance="outline" class="grow"><mat-label>Lot ID → where used (recall)</mat-label><input matInput [(ngModel)]="whereLotId"></mat-form-field>
          <button mat-raised-button (click)="where()">Where used</button>
        </div>
        @if (traceResult) { <pre class="result">{{ traceResult | json }}</pre> }
        @if (whereResult) { <pre class="result">{{ whereResult | json }}</pre> }
      </div>
    </div>
  `,
  styles: [`
    .page-shell { padding:24px; } .page-header { margin-bottom:16px; } .page-title { margin:0; font-size:22px; }
    .page-subtitle { margin:2px 0 0; color: var(--clay-text-muted,#64748b); font-size:13px; }
    .panel { background: var(--clay-surface,#fff); border:1px solid var(--clay-border,#e2e8f0); border-radius:10px; padding:16px; margin-bottom:16px; }
    .panel h3 { margin:0 0 12px; font-size:15px; } .form-row { display:flex; flex-wrap:wrap; gap:12px; align-items:center; }
    .form-row mat-form-field { min-width:130px; } .grow { flex:1; }
    .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:16px; } @media (max-width:800px){ .grid2 { grid-template-columns:1fr; } }
    .li { padding:6px 0; border-top:1px solid var(--clay-border,#eee); } .empty { color: var(--clay-text-muted,#64748b); padding:8px 0; }
    .result { background:#0f172a; color:#e2e8f0; padding:12px; border-radius:8px; overflow:auto; font-size:12px; }
  `],
})
export class TraceabilityComponent implements OnInit {
  lots: any[] = [];
  serials: any[] = [];
  newLot: any = { materialId: '', lotNumber: '', receivedQuantity: 0 };
  newSerial: any = { serialNumber: '', productId: '' };
  traceSerialId = '';
  whereLotId = '';
  traceResult: any = null;
  whereResult: any = null;

  constructor(private api: ApiService, private snack: MatSnackBar) {}

  ngOnInit(): void { this.load(); }

  load(): void {
    this.api.getList('/traceability/lots').subscribe({ next: (list) => this.lots = list, error: () => {} });
    this.api.getList('/traceability/serials').subscribe({ next: (list) => this.serials = list, error: () => {} });
  }

  addLot(): void {
    this.api.post('/traceability/lots', this.newLot).subscribe({
      next: () => { this.snack.open('Lot added', 'OK', { duration: 2000 }); this.newLot = { materialId: '', lotNumber: '', receivedQuantity: 0 }; this.load(); },
      error: (e: any) => this.snack.open(e?.error?.message || 'Failed', 'Dismiss', { duration: 4000 }),
    });
  }
  addSerial(): void {
    this.api.post('/traceability/serials', this.newSerial).subscribe({
      next: () => { this.snack.open('Serial added', 'OK', { duration: 2000 }); this.newSerial = { serialNumber: '', productId: '' }; this.load(); },
      error: (e: any) => this.snack.open(e?.error?.message || 'Failed', 'Dismiss', { duration: 4000 }),
    });
  }
  trace(): void {
    if (!this.traceSerialId) return;
    this.api.get<any>(`/traceability/genealogy/${this.traceSerialId}`).subscribe({ next: (d) => this.traceResult = d?.data ?? d, error: (e: any) => this.snack.open(e?.error?.message || 'Not found', 'Dismiss', { duration: 3000 }) });
  }
  where(): void {
    if (!this.whereLotId) return;
    this.api.get<any>(`/traceability/where-used/${this.whereLotId}`).subscribe({ next: (d) => this.whereResult = d?.data ?? d, error: (e: any) => this.snack.open(e?.error?.message || 'Not found', 'Dismiss', { duration: 3000 }) });
  }
}
