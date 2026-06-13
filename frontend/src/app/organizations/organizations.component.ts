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
import { PermissionsService } from '../core/services/permissions.service';
import { AuthService } from '../core/services/auth.service';

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

          <h4 class="sub">Initial admin account <span class="muted">(recommended — makes the tenant immediately usable)</span></h4>
          <div class="form-row">
            <mat-form-field appearance="outline" class="grow"><mat-label>First name</mat-label>
              <input matInput [(ngModel)]="editing.adminFirstName"></mat-form-field>
            <mat-form-field appearance="outline" class="grow"><mat-label>Last name</mat-label>
              <input matInput [(ngModel)]="editing.adminLastName"></mat-form-field>
            <mat-form-field appearance="outline" class="grow"><mat-label>Employee ID</mat-label>
              <input matInput [(ngModel)]="editing.adminEmployeeId" placeholder="e.g. ACME-001"></mat-form-field>
          </div>
          <div class="form-row">
            <mat-form-field appearance="outline" class="grow"><mat-label>Email</mat-label>
              <input matInput type="email" [(ngModel)]="editing.adminEmail"></mat-form-field>
            <mat-form-field appearance="outline" class="grow"><mat-label>Password</mat-label>
              <input matInput type="password" [(ngModel)]="editing.adminPassword" placeholder="min 6 characters"></mat-form-field>
          </div>

          <div class="panel-actions">
            <button mat-button (click)="editing = null">Cancel</button>
            <button mat-raised-button color="primary" [disabled]="!canSave" (click)="save()">Create</button>
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
          <td mat-cell *matCellDef="let o">
            @if (canImpersonate && o.isActive) {
              <button mat-button color="primary" (click)="supportLogin(o)" [disabled]="busyId === o.id">
                <mat-icon>support_agent</mat-icon> Support login
              </button>
            }
            <button mat-button (click)="toggleActive(o)">{{ o.isActive ? 'Deactivate' : 'Activate' }}</button>
          </td></ng-container>
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
    .sub { margin:8px 0 10px; font-size:13px; } .muted { color: var(--clay-text-muted,#64748b); font-weight:400; font-size:12px; }
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
  busyId: string | null = null;
  canImpersonate = false;

  constructor(
    private api: OrganizationsApiService,
    private snack: MatSnackBar,
    private permissions: PermissionsService,
    private auth: AuthService,
  ) {}

  ngOnInit(): void {
    this.canImpersonate = this.permissions.can('organizations.impersonate');
    this.load();
  }

  supportLogin(o: any): void {
    this.busyId = o.id;
    this.api.impersonate(o.id).subscribe({
      next: (res) => {
        const data = res?.data ?? res;
        this.auth.startImpersonation(data);
        // Full reload so every store re-fetches under the tenant session.
        window.location.assign('/');
      },
      error: (e) => {
        this.busyId = null;
        this.snack.open(e?.error?.message || 'Could not start support session', 'Dismiss', { duration: 5000 });
      },
    });
  }

  load(): void {
    this.api.list().subscribe({ next: (d) => this.orgs = Array.isArray(d) ? d : (d?.data || []), error: () => {} });
  }

  startNew(): void {
    this.editing = {
      name: '', slug: '', description: '',
      adminFirstName: '', adminLastName: '', adminEmployeeId: '', adminEmail: '', adminPassword: '',
    };
  }

  /** Org fields required; admin block is all-or-nothing. */
  get canSave(): boolean {
    const e = this.editing;
    if (!e?.name || !e?.slug) return false;
    const adminFields = [e.adminFirstName, e.adminLastName, e.adminEmployeeId, e.adminEmail, e.adminPassword];
    const filled = adminFields.filter((v) => !!v).length;
    return filled === 0 || (filled === adminFields.length && e.adminPassword.length >= 6);
  }

  /** Auto-derive a slug from the name until the user edits the slug directly. */
  onName(): void {
    if (!this.editing) return;
    this.editing.slug = (this.editing.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  save(): void {
    const e = this.editing;
    const body: any = { name: e.name, slug: e.slug, description: e.description || undefined };
    if (e.adminEmail) {
      body.initialAdmin = {
        email: e.adminEmail,
        password: e.adminPassword,
        firstName: e.adminFirstName,
        lastName: e.adminLastName,
        employeeId: e.adminEmployeeId,
      };
    }
    this.api.create(body).subscribe({
      next: () => {
        this.snack.open(body.initialAdmin ? `Organization created — admin ${body.initialAdmin.email} can sign in` : 'Organization created', 'OK', { duration: 3500 });
        this.editing = null; this.load();
      },
      error: (err) => this.snack.open(err?.error?.message || 'Create failed', 'Dismiss', { duration: 4000 }),
    });
  }

  toggleActive(o: any): void {
    this.api.update(o.id, { isActive: !o.isActive }).subscribe({
      next: () => this.load(),
      error: (e) => this.snack.open(e?.error?.message || 'Update failed', 'Dismiss', { duration: 4000 }),
    });
  }
}
