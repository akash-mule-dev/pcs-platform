import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RbacApiService } from './rbac.service';

const ROLES = ['admin', 'manager', 'supervisor', 'operator'];
const FEATURES = ['dashboard', 'products', 'processes', 'work-orders', 'time-tracking', 'users', 'stations',
  'materials', 'equipment', 'workforce', 'scheduling', 'traceability', 'ncr', 'quality-analysis', 'reports', 'audit', 'coordination'];

@Component({
  selector: 'app-rbac',
  standalone: true,
  imports: [CommonModule, FormsModule, MatTableModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatSelectModule, MatCheckboxModule],
  template: `
    <div class="page-shell">
      <div class="page-header"><div>
        <h1 class="page-title">Roles &amp; Permissions</h1>
        <p class="page-subtitle">Per-customer overrides layered over the platform defaults</p>
      </div></div>

      <div class="panel">
        <h3>Set an override</h3>
        <div class="form-row">
          <mat-form-field appearance="outline"><mat-label>Role</mat-label>
            <mat-select [(ngModel)]="form.role">@for (r of roles; track r) { <mat-option [value]="r">{{ r }}</mat-option> }</mat-select></mat-form-field>
          <mat-form-field appearance="outline"><mat-label>Feature</mat-label>
            <mat-select [(ngModel)]="form.feature">@for (f of features; track f) { <mat-option [value]="f">{{ f }}</mat-option> }</mat-select></mat-form-field>
          <mat-checkbox [(ngModel)]="form.canView">Can view</mat-checkbox>
          <mat-checkbox [(ngModel)]="form.canManage">Can manage</mat-checkbox>
          <button mat-raised-button color="primary" [disabled]="!form.role || !form.feature" (click)="save()">Save</button>
        </div>
      </div>

      <div class="grid2">
        <div class="panel">
          <h3>Overrides</h3>
          <table mat-table [dataSource]="overrides" class="full">
            <ng-container matColumnDef="role"><th mat-header-cell *matHeaderCellDef>Role</th><td mat-cell *matCellDef="let o">{{ o.role }}</td></ng-container>
            <ng-container matColumnDef="feature"><th mat-header-cell *matHeaderCellDef>Feature</th><td mat-cell *matCellDef="let o">{{ o.feature }}</td></ng-container>
            <ng-container matColumnDef="view"><th mat-header-cell *matHeaderCellDef>View</th><td mat-cell *matCellDef="let o">{{ o.canView ? '✓' : '—' }}</td></ng-container>
            <ng-container matColumnDef="manage"><th mat-header-cell *matHeaderCellDef>Manage</th><td mat-cell *matCellDef="let o">{{ o.canManage ? '✓' : '—' }}</td></ng-container>
            <ng-container matColumnDef="actions"><th mat-header-cell *matHeaderCellDef></th><td mat-cell *matCellDef="let o"><button mat-icon-button (click)="remove(o)"><mat-icon>delete</mat-icon></button></td></ng-container>
            <tr mat-header-row *matHeaderRowDef="cols"></tr><tr mat-row *matRowDef="let row; columns: cols"></tr>
          </table>
          @if (!overrides.length) { <p class="empty">No overrides — platform defaults apply.</p> }
        </div>

        <div class="panel">
          <h3>Effective permissions</h3>
          <mat-form-field appearance="outline"><mat-label>Role</mat-label>
            <mat-select [(ngModel)]="resolveRole" (selectionChange)="doResolve()">@for (r of roles; track r) { <mat-option [value]="r">{{ r }}</mat-option> }</mat-select></mat-form-field>
          @if (resolved) {
            <div class="li" *ngFor="let f of resolvedKeys">{{ f }}: <em>{{ resolved[f].view ? 'view' : '—' }}{{ resolved[f].manage ? ' + manage' : '' }}</em></div>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .page-shell { padding:24px; } .page-header { margin-bottom:16px; } .page-title { margin:0; font-size:22px; }
    .page-subtitle { margin:2px 0 0; color: var(--clay-text-muted,#64748b); font-size:13px; }
    .panel { background: var(--clay-surface,#fff); border:1px solid var(--clay-border,#e2e8f0); border-radius:10px; padding:16px; margin-bottom:16px; }
    .panel h3 { margin:0 0 12px; font-size:15px; } .form-row { display:flex; flex-wrap:wrap; gap:16px; align-items:center; }
    .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:16px; } @media (max-width:800px){ .grid2 { grid-template-columns:1fr; } }
    .full { width:100%; } .li { padding:4px 0; font-size:13px; } .empty { color: var(--clay-text-muted,#64748b); padding:8px 0; }
  `],
})
export class RbacComponent implements OnInit {
  readonly roles = ROLES;
  readonly features = FEATURES;
  cols = ['role', 'feature', 'view', 'manage', 'actions'];

  overrides: any[] = [];
  form: any = { role: '', feature: '', canView: true, canManage: false };
  resolveRole = '';
  resolved: any = null;
  resolvedKeys: string[] = [];

  constructor(private api: RbacApiService, private snack: MatSnackBar) {}

  ngOnInit(): void { this.load(); }
  private arr(d: any): any[] { return Array.isArray(d) ? d : (d?.data || []); }

  load(): void { this.api.list().subscribe({ next: (d) => this.overrides = this.arr(d), error: () => {} }); }

  save(): void {
    this.api.upsert(this.form).subscribe({
      next: () => { this.snack.open('Permission saved', 'OK', { duration: 2000 }); this.load(); },
      error: (e) => this.snack.open(e?.error?.message || 'Failed', 'Dismiss', { duration: 4000 }),
    });
  }

  remove(o: any): void {
    this.api.remove(o.id).subscribe({ next: () => { this.snack.open('Removed', 'OK', { duration: 1500 }); this.load(); }, error: () => {} });
  }

  doResolve(): void {
    if (!this.resolveRole) return;
    this.api.resolve(this.resolveRole).subscribe({
      next: (d) => { const r = d?.data ?? d; this.resolved = r?.permissions || {}; this.resolvedKeys = Object.keys(this.resolved); },
      error: () => { this.resolved = null; },
    });
  }
}
