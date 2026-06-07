import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { EquipmentApiService } from './equipment.service';

const TYPES = ['laser', 'press_brake', 'cnc', 'welder', 'shear', 'grinder', 'paint_booth', 'other'];
const STATUSES = ['running', 'idle', 'down', 'maintenance'];
const REASONS = ['breakdown', 'changeover', 'no_material', 'no_operator', 'planned_maintenance', 'quality', 'other'];

@Component({
  selector: 'app-equipment',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatTableModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatProgressSpinnerModule,
  ],
  template: `
    <div class="page-shell">
      <div class="page-header">
        <div>
          <h1 class="page-title">Equipment</h1>
          <p class="page-subtitle">Machines, status, downtime and effectiveness</p>
        </div>
        <button mat-raised-button color="primary" (click)="showAdd = !showAdd"><mat-icon>add</mat-icon> New Machine</button>
      </div>

      @if (eff) {
        <div class="cards">
          <div class="card"><div class="kpi">{{ eff.availabilityPct }}%</div><div class="lbl">Availability (7d)</div></div>
          <div class="card"><div class="kpi">{{ fmtH(eff.mtbfSeconds) }}</div><div class="lbl">MTBF</div></div>
          <div class="card"><div class="kpi">{{ fmtH(eff.mttrSeconds) }}</div><div class="lbl">MTTR</div></div>
          <div class="card"><div class="kpi">{{ eff.failures }}</div><div class="lbl">Downtime events</div></div>
        </div>
      }

      @if (showAdd) {
        <div class="panel"><h3>New machine</h3>
          <div class="form-row">
            <mat-form-field appearance="outline"><mat-label>Code</mat-label><input matInput [(ngModel)]="newEq.code"></mat-form-field>
            <mat-form-field appearance="outline" class="grow"><mat-label>Name</mat-label><input matInput [(ngModel)]="newEq.name"></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>Type</mat-label>
              <mat-select [(ngModel)]="newEq.type">@for (t of types; track t) { <mat-option [value]="t">{{ t }}</mat-option> }</mat-select></mat-form-field>
          </div>
          <div class="panel-actions"><button mat-button (click)="showAdd=false">Cancel</button>
            <button mat-raised-button color="primary" [disabled]="!newEq.code || !newEq.name" (click)="save()">Save</button></div>
        </div>
      }

      @if (downtimeFor) {
        <div class="panel"><h3>Report downtime — {{ downtimeFor.name }}</h3>
          <div class="form-row">
            <mat-form-field appearance="outline"><mat-label>Reason</mat-label>
              <mat-select [(ngModel)]="downtime.reason">@for (r of reasons; track r) { <mat-option [value]="r">{{ r }}</mat-option> }</mat-select></mat-form-field>
            <mat-form-field appearance="outline" class="grow"><mat-label>Note</mat-label><input matInput [(ngModel)]="downtime.note"></mat-form-field>
            <button mat-button (click)="downtimeFor=null">Cancel</button>
            <button mat-raised-button color="warn" (click)="confirmDowntime()">Mark down</button>
          </div>
        </div>
      }

      @if (loading) { <div class="center"><mat-spinner diameter="40"></mat-spinner></div> }
      @else {
        <table mat-table [dataSource]="rows" class="mat-elevation-z1 full">
          <ng-container matColumnDef="code"><th mat-header-cell *matHeaderCellDef>Code</th><td mat-cell *matCellDef="let e">{{ e.code }}</td></ng-container>
          <ng-container matColumnDef="name"><th mat-header-cell *matHeaderCellDef>Name</th><td mat-cell *matCellDef="let e">{{ e.name }}</td></ng-container>
          <ng-container matColumnDef="type"><th mat-header-cell *matHeaderCellDef>Type</th><td mat-cell *matCellDef="let e">{{ e.type }}</td></ng-container>
          <ng-container matColumnDef="status"><th mat-header-cell *matHeaderCellDef>Status</th>
            <td mat-cell *matCellDef="let e"><span class="chip st-{{e.status}}">{{ e.status }}</span></td></ng-container>
          <ng-container matColumnDef="actions"><th mat-header-cell *matHeaderCellDef></th>
            <td mat-cell *matCellDef="let e">
              @if (e.status === 'down') { <button mat-button color="primary" (click)="endDowntime(e)">End downtime</button> }
              @else { <button mat-button color="warn" (click)="downtimeFor = e; downtime = { reason: 'breakdown', note: '' }">Report downtime</button> }
            </td></ng-container>
          <tr mat-header-row *matHeaderRowDef="columns"></tr>
          <tr mat-row *matRowDef="let row; columns: columns"></tr>
        </table>
        @if (rows.length === 0) { <p class="empty">No machines yet.</p> }
      }
    </div>
  `,
  styles: [`
    .page-shell { padding: 24px; } .page-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; }
    .page-title { margin:0; font-size:22px; } .page-subtitle { margin:2px 0 0; color: var(--clay-text-muted,#64748b); font-size:13px; }
    .cards { display:flex; gap:12px; margin-bottom:16px; flex-wrap:wrap; }
    .card { background: var(--clay-surface,#fff); border:1px solid var(--clay-border,#e2e8f0); border-radius:10px; padding:14px 18px; min-width:140px; }
    .card .kpi { font-size:22px; font-weight:600; } .card .lbl { font-size:12px; color: var(--clay-text-muted,#64748b); }
    .panel { background: var(--clay-surface,#fff); border:1px solid var(--clay-border,#e2e8f0); border-radius:10px; padding:16px; margin-bottom:16px; }
    .panel h3 { margin:0 0 12px; font-size:15px; } .form-row { display:flex; flex-wrap:wrap; gap:12px; align-items:center; }
    .form-row mat-form-field { min-width:150px; } .grow { flex:1; } .full { width:100%; } .panel-actions { display:flex; justify-content:flex-end; gap:8px; }
    .chip { padding:2px 8px; border-radius:10px; font-size:12px; text-transform:capitalize; }
    .st-running { background:#bbf7d0; } .st-idle { background:#e2e8f0; } .st-down { background:#fca5a5; } .st-maintenance { background:#fde68a; }
    .center { display:flex; justify-content:center; padding:48px; } .empty { text-align:center; color: var(--clay-text-muted,#64748b); padding:16px; }
  `],
})
export class EquipmentComponent implements OnInit {
  readonly types = TYPES;
  readonly statuses = STATUSES;
  readonly reasons = REASONS;
  columns = ['code', 'name', 'type', 'status', 'actions'];

  loading = true;
  rows: any[] = [];
  eff: any = null;
  showAdd = false;
  newEq: any = { code: '', name: '', type: 'other' };
  downtimeFor: any = null;
  downtime: any = { reason: 'breakdown', note: '' };

  constructor(private api: EquipmentApiService, private snack: MatSnackBar) {}

  ngOnInit(): void { this.load(); }

  load(): void {
    this.loading = true;
    this.api.list().subscribe({
      next: (data) => { this.rows = Array.isArray(data) ? data : (data?.data || []); this.loading = false; },
      error: () => { this.loading = false; },
    });
    this.api.effectiveness().subscribe({ next: (e) => this.eff = e?.data ?? e, error: () => {} });
  }

  fmtH(seconds: number): string {
    if (!seconds) return '0h';
    const h = seconds / 3600;
    return h >= 1 ? `${h.toFixed(1)}h` : `${Math.round(seconds / 60)}m`;
  }

  save(): void {
    this.api.create(this.newEq).subscribe({
      next: () => { this.snack.open('Machine added', 'OK', { duration: 2000 }); this.showAdd = false; this.newEq = { code: '', name: '', type: 'other' }; this.load(); },
      error: (e) => this.snack.open(e?.error?.message || 'Failed', 'Dismiss', { duration: 4000 }),
    });
  }

  confirmDowntime(): void {
    this.api.openDowntime(this.downtimeFor.id, this.downtime).subscribe({
      next: () => { this.snack.open('Machine marked down', 'OK', { duration: 2000 }); this.downtimeFor = null; this.load(); },
      error: (e) => this.snack.open(e?.error?.message || 'Failed', 'Dismiss', { duration: 4000 }),
    });
  }

  endDowntime(e: any): void {
    this.api.closeDowntime(e.id).subscribe({
      next: () => { this.snack.open('Downtime ended', 'OK', { duration: 2000 }); this.load(); },
      error: (err) => this.snack.open(err?.error?.message || 'Failed', 'Dismiss', { duration: 4000 }),
    });
  }
}
