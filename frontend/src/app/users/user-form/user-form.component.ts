import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { ApiService } from '../../core/services/api.service';
import { MatSnackBar } from '@angular/material/snack-bar';

@Component({
  selector: 'app-user-form',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>{{ data ? 'Edit' : 'Add' }} User</h2>
    <mat-dialog-content>
      <div class="form-row">
        <mat-form-field appearance="outline">
          <mat-label>First Name</mat-label>
          <input matInput [(ngModel)]="form.firstName" required>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Last Name</mat-label>
          <input matInput [(ngModel)]="form.lastName" required>
        </mat-form-field>
      </div>
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Email</mat-label>
        <input matInput type="email" [(ngModel)]="form.email" required>
      </mat-form-field>
      <div class="form-row">
        <mat-form-field appearance="outline">
          <mat-label>Employee ID</mat-label>
          <input matInput [(ngModel)]="form.employeeId" required>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Badge ID</mat-label>
          <input matInput [(ngModel)]="form.badgeId">
        </mat-form-field>
      </div>
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Role</mat-label>
        <mat-select [(ngModel)]="form.roleId" required>
          @for (r of roles; track r.id) {
            <mat-option [value]="r.id">{{ r.name | uppercase }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
      @if (!data) {
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Password</mat-label>
          <input matInput type="password" [(ngModel)]="form.password" required>
        </mat-form-field>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="dialogRef.close()">Cancel</button>
      <button mat-raised-button color="primary" (click)="save()" [disabled]="!isValid()">Save</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .full-width { width: 100%; }
    .form-row { display: flex; gap: 16px; }
    .form-row mat-form-field { flex: 1; }
    mat-form-field { margin-bottom: 4px; }
  `]
})
export class UserFormComponent implements OnInit {
  form: any = { firstName: '', lastName: '', email: '', employeeId: '', badgeId: '', roleId: '', password: '' };
  roles: any[] = [];

  constructor(
    public dialogRef: MatDialogRef<UserFormComponent>,
    @Inject(MAT_DIALOG_DATA) public data: any,
    private api: ApiService,
    private snackBar: MatSnackBar
  ) {
    if (data) {
      this.form = {
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        employeeId: data.employeeId,
        badgeId: data.badgeId || '',
        roleId: data.role?.id || data.roleId,
        password: ''
      };
    }
  }

  ngOnInit(): void {
    // Load roles - try dedicated endpoint first, fallback to extracting from users
    this.api.get<any[]>('/users').subscribe(data => {
      const users = Array.isArray(data) ? data : (data as any).data || [];
      const roleMap = new Map<string, any>();
      users.forEach((u: any) => {
        if (u.role && !roleMap.has(u.role.id)) roleMap.set(u.role.id, u.role);
      });
      this.roles = Array.from(roleMap.values());
      if (this.roles.length === 0) {
        this.roles = [
          { id: 'admin', name: 'admin' },
          { id: 'manager', name: 'manager' },
          { id: 'supervisor', name: 'supervisor' },
          { id: 'operator', name: 'operator' }
        ];
      }
    });
  }

  isValid(): boolean {
    return this.form.firstName && this.form.lastName && this.form.email && this.form.employeeId && this.form.roleId && (this.data || this.form.password);
  }

  save(): void {
    const body: any = { ...this.form };
    if (!body.password) delete body.password;
    if (!body.badgeId) delete body.badgeId;

    const obs = this.data
      ? this.api.patch(`/users/${this.data.id}`, body)
      : this.api.post('/users', body);
    obs.subscribe({
      next: () => {
        this.snackBar.open(`User ${this.data ? 'updated' : 'created'}`, 'Close', { duration: 3000 });
        this.dialogRef.close(true);
      },
      error: () => {}
    });
  }
}
