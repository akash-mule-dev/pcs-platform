import { Component, OnInit, AfterViewInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatPaginatorModule, MatPaginator } from '@angular/material/paginator';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ApiService } from '../../core/services/api.service';
import { LoadingService } from '../../core/services/loading.service';
import { UserFormComponent } from '../user-form/user-form.component';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'app-user-list',
  standalone: true,
  imports: [CommonModule, FormsModule, MatTableModule, MatPaginatorModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatSelectModule, MatChipsModule, MatTooltipModule],
  template: `
    <div class="page-header">
      <h2>Users</h2>
      <button mat-raised-button color="primary" (click)="openForm()">
        <mat-icon>person_add</mat-icon> Add User
      </button>
    </div>

    <div class="filters">
      <mat-form-field appearance="outline" class="filter-field">
        <mat-label>Filter by Role</mat-label>
        <mat-select [(ngModel)]="roleFilter" (selectionChange)="applyFilter()">
          <mat-option value="">All</mat-option>
          <mat-option value="admin">Admin</mat-option>
          <mat-option value="manager">Manager</mat-option>
          <mat-option value="supervisor">Supervisor</mat-option>
          <mat-option value="operator">Operator</mat-option>
        </mat-select>
      </mat-form-field>
      <mat-form-field appearance="outline" class="filter-field">
        <mat-label>Status</mat-label>
        <mat-select [(ngModel)]="statusFilter" (selectionChange)="load()">
          <mat-option value="active">Active</mat-option>
          <mat-option value="inactive">Inactive</mat-option>
          <mat-option value="all">All</mat-option>
        </mat-select>
      </mat-form-field>
    </div>

    <table mat-table [dataSource]="dataSource" class="full-width mat-elevation-z2">
      <ng-container matColumnDef="name">
        <th mat-header-cell *matHeaderCellDef>Name</th>
        <td mat-cell *matCellDef="let u">{{ u.firstName }} {{ u.lastName }}</td>
      </ng-container>
      <ng-container matColumnDef="email">
        <th mat-header-cell *matHeaderCellDef>Email</th>
        <td mat-cell *matCellDef="let u">{{ u.email }}</td>
      </ng-container>
      <ng-container matColumnDef="employeeId">
        <th mat-header-cell *matHeaderCellDef>Employee ID</th>
        <td mat-cell *matCellDef="let u">{{ u.employeeId }}</td>
      </ng-container>
      <ng-container matColumnDef="role">
        <th mat-header-cell *matHeaderCellDef>Role</th>
        <td mat-cell *matCellDef="let u">
          <span class="role-chip" [class]="'role-' + u.role?.name">{{ u.role?.name | uppercase }}</span>
        </td>
      </ng-container>
      <ng-container matColumnDef="status">
        <th mat-header-cell *matHeaderCellDef>Status</th>
        <td mat-cell *matCellDef="let u">
          <span class="status-chip" [class.status-active]="u.isActive" [class.status-inactive]="!u.isActive">
            {{ u.isActive ? 'Active' : 'Inactive' }}
          </span>
        </td>
      </ng-container>
      <ng-container matColumnDef="actions">
        <th mat-header-cell *matHeaderCellDef>Actions</th>
        <td mat-cell *matCellDef="let u">
          @if (u.isActive) {
            <button mat-icon-button color="primary" (click)="openForm(u)"><mat-icon>edit</mat-icon></button>
            <button mat-icon-button color="warn" (click)="deleteUser(u)"><mat-icon>delete</mat-icon></button>
          } @else {
            <button mat-icon-button color="primary" (click)="activateUser(u)" matTooltip="Activate user"><mat-icon>person_add</mat-icon></button>
          }
        </td>
      </ng-container>
      <tr mat-header-row *matHeaderRowDef="columns"></tr>
      <tr mat-row *matRowDef="let row; columns: columns;"></tr>
    </table>

    <mat-paginator [pageSize]="10" [pageSizeOptions]="[5, 10, 25]" showFirstLastButtons></mat-paginator>
  `,
  styles: [`
    .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    h2 { margin: 0; color: var(--clay-text); }
    .filter-field { margin-bottom: 16px; }
    .full-width { width: 100%; }
    .role-chip { padding: 4px 12px; border-radius: 16px; font-size: 11px; font-weight: 600; }
    .role-admin { background: var(--info-bg); color: var(--info-text); box-shadow: var(--clay-shadow-soft); }
    .role-manager { background: var(--info-bg); color: var(--info-text); box-shadow: var(--clay-shadow-soft); }
    .role-supervisor { background: var(--warning-bg); color: var(--warning-text); box-shadow: var(--clay-shadow-soft); }
    .role-operator { background: var(--success-bg); color: var(--success-text); box-shadow: var(--clay-shadow-soft); }
    .filters { display: flex; gap: 16px; }
    .status-chip { padding: 4px 12px; border-radius: 16px; font-size: 11px; font-weight: 600; }
    .status-active { background: var(--success-bg); color: var(--success-text); }
    .status-inactive { background: var(--clay-bg); color: var(--clay-text-muted); }
  `]
})
export class UserListComponent implements OnInit, AfterViewInit {
  users: any[] = [];
  dataSource = new MatTableDataSource<any>([]);
  columns = ['name', 'email', 'employeeId', 'role', 'status', 'actions'];
  roleFilter = '';
  statusFilter = 'active';
  @ViewChild(MatPaginator) paginator!: MatPaginator;

  constructor(private api: ApiService, private dialog: MatDialog, private snackBar: MatSnackBar, private loading: LoadingService) {}

  ngOnInit(): void { this.load(); }

  ngAfterViewInit(): void { this.dataSource.paginator = this.paginator; }

  load(): void {
    this.loading.show();
    this.api.get<any>('/users', { status: this.statusFilter }).subscribe({
      next: (data) => {
        this.users = Array.isArray(data) ? data : data.data || [];
        this.applyFilter();
        this.loading.hide();
      },
      error: () => { this.loading.hide(); }
    });
  }

  applyFilter(): void {
    this.dataSource.data = this.roleFilter
      ? this.users.filter(u => u.role?.name === this.roleFilter)
      : [...this.users];
  }

  openForm(user?: any): void {
    const ref = this.dialog.open(UserFormComponent, { width: '600px', data: user || null });
    ref.afterClosed().subscribe(result => { if (result) this.load(); });
  }

  activateUser(user: any): void {
    this.loading.show();
    this.api.patch(`/users/${user.id}`, { isActive: true }).subscribe({
      next: () => {
        this.loading.hide();
        this.snackBar.open('User activated', 'Close', { duration: 3000 });
        this.load();
      },
      error: (err) => {
        this.loading.hide();
        const msg = err?.error?.message || 'Failed to activate user';
        this.snackBar.open(msg, 'Close', { duration: 5000 });
      }
    });
  }

  deleteUser(user: any): void {
    const ref = this.dialog.open(ConfirmDialogComponent, {
      data: { title: 'Delete User', message: `Delete "${user.firstName} ${user.lastName}"?` }
    });
    ref.afterClosed().subscribe(confirmed => {
      if (confirmed) {
        this.loading.show();
        this.api.delete(`/users/${user.id}`).subscribe({
          next: () => {
            this.loading.hide();
            this.snackBar.open('User deleted', 'Close', { duration: 3000 });
            this.load();
          },
          error: (err) => {
            this.loading.hide();
            const msg = err?.error?.message || 'Failed to delete user';
            this.snackBar.open(msg, 'Close', { duration: 5000 });
          }
        });
      }
    });
  }
}
