import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <div class="login-container">
      <mat-card class="login-card">
        <mat-card-header>
          <div class="login-header">
            <mat-icon class="login-logo">precision_manufacturing</mat-icon>
            <h1>PCS Platform</h1>
            <p>Production Control System</p>
          </div>
        </mat-card-header>
        <mat-card-content>
          @if (error) {
            <div class="error-message">{{ error }}</div>
          }
          <form (ngSubmit)="onLogin()" class="login-form">
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Email</mat-label>
              <input matInput type="email" [(ngModel)]="email" name="email" required>
              <mat-icon matPrefix>email</mat-icon>
            </mat-form-field>
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Password</mat-label>
              <input matInput [type]="hidePassword ? 'password' : 'text'" [(ngModel)]="password" name="password" required>
              <mat-icon matPrefix>lock</mat-icon>
              <button mat-icon-button matSuffix type="button" (click)="hidePassword = !hidePassword">
                <mat-icon>{{ hidePassword ? 'visibility_off' : 'visibility' }}</mat-icon>
              </button>
            </mat-form-field>
            <button mat-raised-button color="primary" type="submit" class="full-width login-btn" [disabled]="loading">
              @if (loading) {
                <mat-spinner diameter="20"></mat-spinner>
              } @else {
                Sign In
              }
            </button>
          </form>
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: [`
    .login-container {
      height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #1a237e 0%, #283593 50%, #3949ab 100%);
    }
    .login-card {
      width: 400px;
      padding: 32px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.2) !important;
    }
    .login-header {
      text-align: center;
      width: 100%;
      margin-bottom: 24px;
    }
    .login-header h1 { margin: 8px 0 4px; font-size: 24px; color: #1a237e; }
    .login-header p { margin: 0; color: #666; font-size: 14px; }
    .login-logo { font-size: 48px; width: 48px; height: 48px; color: #1a237e; }
    .login-form { display: flex; flex-direction: column; gap: 8px; }
    .full-width { width: 100%; }
    .login-btn { height: 48px; font-size: 16px; }
    .error-message {
      background: #ffebee;
      color: #c62828;
      padding: 12px;
      border-radius: 4px;
      margin-bottom: 16px;
      font-size: 14px;
    }
    ::ng-deep .login-card .mat-mdc-card-header { display: block; }
  `]
})
export class LoginComponent {
  email = '';
  password = '';
  hidePassword = true;
  loading = false;
  error = '';

  constructor(private auth: AuthService, private router: Router) {}

  onLogin(): void {
    if (!this.email || !this.password) return;
    this.loading = true;
    this.error = '';
    this.auth.login(this.email, this.password).subscribe({
      next: () => {
        this.loading = false;
        this.router.navigateByUrl('/').then(success => {
          if (!success) {
            window.location.href = '/';
          }
        });
      },
      error: (err) => {
        this.loading = false;
        this.error = err.error?.message || err.message || 'Login failed. Please check your credentials.';
      }
    });
  }
}
