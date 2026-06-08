import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { OrganizationsApiService } from './organizations.service';

@Component({
  selector: 'app-organizations',
  standalone: true,
  imports: [CommonModule, FormsModule, MatTableModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule],
  template: `
    <div class="page-shell">
      <div class="page-header">
        <div>
          <h1 class="page-title">Organizations</h1>
          <p class="page-subtitle">Tenants on this deployment — each org's production data is isolated from the others.</p>
        </div>
        <button mat-raised-button color="primary" (click)="startNew()"><mat-icon>add</mat-icon> New Organization</button>
      </div>

      @if (editing) {
        <div class="panel">
          <h3>New organization</h3>
          <div class="form-row">
            <mat-form-field appearance="outline" class="grow"><mat-label>Name</mat-label>
              <input matInput [(ngModel)]="editing.name" (ngModelChange)="onName()" placeholder="e.g. Acme Fabrication"></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>Slug</mat-label>
              <input matInput [(ngModel)]="editing.slug" placeholder="acme-fabrication"></mat-form-field>
          </div>
          <mat-form-field appearance="outline" class="full"><mat-label>Description (optional)</mat-label>
            <input matInput [(ngModel)]="editing.description"></mat-form-field>
          <div class="panel-actions">
            <button mat-button (click)="editing = null">Cancel</button>
            <button mat-raised-button color="primary" [disabled]="!editing.name || !editing.slug" (click)="save()">Create</button>
          </div>
        </div>
      }

      <table mat-table [dataSource]="orgs" class="full mat-elevation-z1">
        <ng-container matColumnDef="name"><th mat-header-cell *matHeaderCellDef>Name</th><td mat-cell *matCellDef="let o">{{ o.name }}</td></ng-container>
        <ng-container matColumnDef="slug"><th mat-header-cell *matHeaderCellDef>Slug</th><td mat-cell *matCellDef="let o"><code>{{ o.slug }}</code></td></ng-container>
        <ng-container matColumnDef="status"><th mat-header-cell *matHeaderCellDef>Status</th>
          <td mat-cell *matCellDef="let o"><span class="chip" [class.on]="o.isActive">{{ o.isActive ? 'Active' : 'Inactive' }}</span></td></ng-container>
        <ng-container matColumnDef="created"><th mat-header-cell *matHeaderCellDef>Created</th><td mat-cell *matCellDef="let o">{{ o.createdAt | date:'mediumDate' }}</td></ng-container>
        <ng-container matColumnDef="actions"><th mat-header-cell *matHeaderCellDef></th>
          <td mat-cell *matCellDef="let o"><button mat-button (click)="toggleActive(o)">{{ o.isActive ? 'Deactivate' : 'Activate' }}</button></td></ng-container>
        <tr mat-header-row *matHeaderRowDef="cols"></tr><tr mat-row *matRowDef="let r; columns: cols"></tr>
      </table>
      @if (!orgs.length) { <p class="empty">No organizations yet. Create one to onboard a customer.</p> }
    </div>
  `,
  styles: [`
    .page-shell { padding:24px; } .page-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; }
    .page-title { margin:0; font-size:22px; } .page-subtitle { margin:2px 0 0; color: var(--clay-text-muted,#64748b); font-size:13px; }
    .panel { background: var(--clay-surface,#fff); border:1px solid var(--clay-border,#e2e8f0); border-radius:10px; padding:16px; margin-bottom:16px; }
    .panel h3 { margin:0 0 12px; font-size:15px; } .form-row { display:flex; flex-wrap:wrap; gap:12px; } .grow { flex:1; min-width:220px; } .full { width:100%; }
    .panel-actions { display:flex; justify-content:flex-end; gap:8px; }
    table.full { width:100%; } .empty { text-align:center; color: var(--clay-text-muted,#64748b); padding:24px; }
    code { background: var(--clay-bg,#f1f5f9); padding:1px 6px; border-radius:4px; font-size:12px; }
    .chip { padding:2px 10px; border-radius:12px; font-size:11px; font-weight:600; background:#fee2e2; color:#b91c1c; }
    .chip.on { background:#dcfce7; color:#15803d; }
  `],
})
export class OrganizationsComponent implements OnInit {
  cols = ['name', 'slug', 'status', 'created', 'actions'];
  orgs: any[] = [];
  editing: any = null;

  constructor(private api: OrganizationsApiService, private snack: MatSnackBar) {}

  ngOnInit(): void { this.load(); }

  load(): void {
    this.api.list().subscribe({ next: (d) => this.orgs = Array.isArray(d) ? d : (d?.data || []), error: () => {} });
  }

  startNew(): void { this.editing = { name: '', slug: '', description: '' }; }

  /** Auto-derive a slug from the name until the user edits the slug directly. */
  onName(): void {
    if (!this.editing) return;
    this.editing.slug = (this.editing.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  save(): void {
    const body = { name: this.editing.name, slug: this.editing.slug, description: this.editing.description || undefined };
    this.api.create(body).subscribe({
      next: () => { this.snack.open('Organization created', 'OK', { duration: 2500 }); this.editing = null; this.load(); },
      error: (e) => this.snack.open(e?.error?.message || 'Create failed', 'Dismiss', { duration: 4000 }),
    });
  }

  toggleActive(o: any): void {
    this.api.update(o.id, { isActive: !o.isActive }).subscribe({
      next: () => this.load(),
      error: (e) => this.snack.open(e?.error?.message || 'Update failed', 'Dismiss', { duration: 4000 }),
    });
  }
}
