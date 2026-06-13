import { Component, Inject, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, NgForm } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { ApiService } from '../../core/services/api.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { LoadingService } from '../../core/services/loading.service';
import { AssignableRole, RolesApiService } from '../../core/services/roles.service';

@Component({
  selector: 'app-user-form',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatIconModule],
  template: `
    <div class="dialog-shell">
      <div class="dialog-header has-icon">
        <div class="header-icon tone-green"><mat-icon>person</mat-icon></div>
        <div class="header-text">
          <h2>{{ data ? 'Edit' : 'Add' }} User</h2>
          <p class="dialog-subtitle">{{ data ? 'Update account details and role' : 'Create a new user account' }}</p>
        </div>
      </div>

      <div class="dialog-body">
        <form #userForm="ngForm">
          <div class="form-row">
            <mat-form-field appearance="outline">
              <mat-label>First Name</mat-label>
              <input matInput [(ngModel)]="form.firstName" name="firstName" required #firstName="ngModel">
              @if (firstName.invalid && submitted) {
                <mat-error>First name is required</mat-error>
              }
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Last Name</mat-label>
              <input matInput [(ngModel)]="form.lastName" name="lastName" required #lastName="ngModel">
              @if (lastName.invalid && submitted) {
                <mat-error>Last name is required</mat-error>
              }
            </mat-form-field>
          </div>
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Mobile No</mat-label>
            <input matInput type="tel" [(ngModel)]="form.mobileNo" name="mobileNo" required #mobileNo="ngModel">
            @if (mobileNo.invalid && submitted) {
              <mat-error>Mobile number is required</mat-error>
            }
          </mat-form-field>
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Email</mat-label>
            <input matInput type="email" [(ngModel)]="form.email" name="email">
          </mat-form-field>
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Employee ID</mat-label>
            <input matInput [(ngModel)]="form.employeeId" name="employeeId" required #employeeId="ngModel">
            @if (employeeId.invalid && submitted) {
              <mat-error>Employee ID is required</mat-error>
            }
          </mat-form-field>
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Role</mat-label>
            <mat-select [(ngModel)]="form.roleId" name="roleId" required #roleId="ngModel">
              @for (r of roles; track r.id) {
                <mat-option [value]="r.id">
                  {{ r.name }}@if (r.isSystem) { <span class="role-tag">system</span> }
                </mat-option>
              }
            </mat-select>
            @if (roleId.invalid && submitted) {
              <mat-error>Role is required</mat-error>
            }
          </mat-form-field>
          @if (!data) {
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Password</mat-label>
              <input matInput type="password" [(ngModel)]="form.password" name="password" required #password="ngModel">
              @if (password.invalid && submitted) {
                <mat-error>Password is required</mat-error>
              }
            </mat-form-field>
          }
          @if (data) {
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Hourly rate (costing)</mat-label>
              <input matInput type="number" min="0" [(ngModel)]="form.hourlyRate" name="hourlyRate">
              <mat-hint>Personal labor rate. 0 = use the stage rate / org default.</mat-hint>
            </mat-form-field>
          }
        </form>
      </div>

      <div class="dialog-footer">
        <button type="button" class="btn-ghost" (click)="dialogRef.close()">Cancel</button>
        <button type="button" class="btn-primary" (click)="save()">{{ data ? 'Save Changes' : 'Create User' }}</button>
      </div>
    </div>
  `,
  styles: [`
    form { display: flex; flex-direction: column; }
    .role-tag { margin-left: 8px; font-size: 11px; color: var(--clay-text-muted, #64748b); border: 1px solid var(--clay-border, #e2e8f0); border-radius: 999px; padding: 1px 6px; }
  `]
})
export class UserFormComponent implements OnInit {
  @ViewChild('userForm') userForm!: NgForm;
  form: any = { firstName: '', lastName: '', mobileNo: '', email: '', employeeId: '', roleId: '', password: '' };
  roles: AssignableRole[] = [];
  submitted = false;

  constructor(
    public dialogRef: MatDialogRef<UserFormComponent>,
    @Inject(MAT_DIALOG_DATA) public data: any,
    private api: ApiService,
    private rolesApi: RolesApiService,
    private snackBar: MatSnackBar,
    private loadingService: LoadingService
  ) {
    if (data) {
      this.form = {
        firstName: data.firstName,
        lastName: data.lastName,
        mobileNo: data.mobileNo || '',
        email: data.email || '',
        employeeId: data.employeeId,
        roleId: data.role?.id || data.roleId,
        password: '',
        hourlyRate: Number(data.hourlyRate) || 0
      };
    }
  }

  ngOnInit(): void {
    // System roles + this organization's custom roles.
    this.rolesApi.assignable().subscribe({
      next: (roles) => (this.roles = roles ?? []),
      error: () => (this.roles = []),
    });
  }

  isValid(): boolean {
    return this.form.firstName && this.form.lastName && this.form.mobileNo && this.form.employeeId && this.form.roleId && (this.data || this.form.password);
  }

  save(): void {
    this.submitted = true;
    if (this.userForm) {
      Object.values(this.userForm.controls).forEach(c => c.markAsTouched());
    }
    if (!this.isValid()) return;
    const body: any = { ...this.form };
    if (!body.password) delete body.password;
    if (!body.email) delete body.email;
    if (!this.data) delete body.hourlyRate; // update-only field
    else body.hourlyRate = Number(body.hourlyRate) || 0;

    this.loadingService.show();
    const obs = this.data
      ? this.api.patch(`/users/${this.data.id}`, body)
      : this.api.post('/users', body);
    obs.subscribe({
      next: () => {
        this.loadingService.hide();
        this.snackBar.open(`User ${this.data ? 'updated' : 'created'}`, 'Close', { duration: 3000 });
        this.dialogRef.close(true);
      },
      error: (err) => {
        this.loadingService.hide();
        const msg = err?.error?.message || `Failed to ${this.data ? 'update' : 'create'} user`;
        this.snackBar.open(msg, 'Close', { duration: 5000 });
      }
    });
  }
}
