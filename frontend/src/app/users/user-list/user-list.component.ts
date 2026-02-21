import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ApiService } from '../../core/services/api.service';
import { UserFormComponent } from '../user-form/user-form.component';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'app-user-list',
  standalone: true,
  imports: [CommonModule, FormsModule, MatTableModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatSelectModule, MatChipsModule],
  template: `
    <div class="page-header">
      <h2>Users</h2>
      <button mat-raised-button color="primary" (click)="openForm()">
        <mat-icon>person_add</mat-icon> Add User
      </button>
    </div>

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

    <table mat-table [dataSource]="filtered" class="full-width mat-elevation-z2">
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
      <ng-container matColumnDef="actions">
        <th mat-header-cell *matHeaderCellDef>Actions</th>
        <td mat-cell *matCellDef="let u">
          <button mat-icon-button color="primary" (click)="openForm(u)"><mat-icon>edit</mat-icon></button>
          <button mat-icon-button color="warn" (click)="deleteUser(u)"><mat-icon>delete</mat-icon></button>
        </td>
      </ng-container>
      <tr mat-header-row *matHeaderRowDef="columns"></tr>
      <tr mat-row *matRowDef="let row; columns: columns;"></tr>
    </table>
  `,
  styles: [`
    .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    h2 { margin: 0; color: #1a237e; }
    .filter-field { margin-bottom: 16px; }
    .full-width { width: 100%; }
    .role-chip { padding: 4px 12px; border-radius: 16px; font-size: 11px; font-weight: 600; }
    .role-admin { background: #e8eaf6; color: #283593; }
    .role-manager { background: #e3f2fd; color: #1565c0; }
    .role-supervisor { background: #fff3e0; color: #e65100; }
    .role-operator { background: #e8f5e9; color: #2e7d32; }
  `]
})
export class UserListComponent implements OnInit {
  users: any[] = [];
  filtered: any[] = [];
  columns = ['name', 'email', 'employeeId', 'role', 'actions'];
  roleFilter = '';

  constructor(private api: ApiService, private dialog: MatDialog, private snackBar: MatSnackBar) {}

  ngOnInit(): void { this.load(); }

  load(): void {
    this.api.get<any>('/users').subscribe(data => {
      this.users = Array.isArray(data) ? data : data.data || [];
      this.applyFilter();
    });
  }

  applyFilter(): void {
    this.filtered = this.roleFilter
      ? this.users.filter(u => u.role?.name === this.roleFilter)
      : [...this.users];
  }

  openForm(user?: any): void {
    const ref = this.dialog.open(UserFormComponent, { width: '600px', data: user || null });
    ref.afterClosed().subscribe(result => { if (result) this.load(); });
  }

  deleteUser(user: any): void {
    const ref = this.dialog.open(ConfirmDialogComponent, {
      data: { title: 'Delete User', message: `Delete "${user.firstName} ${user.lastName}"?` }
    });
    ref.afterClosed().subscribe(confirmed => {
      if (confirmed) {
        this.api.delete(`/users/${user.id}`).subscribe(() => {
          this.snackBar.open('User deleted', 'Close', { duration: 3000 });
          this.load();
        });
      }
    });
  }
}
