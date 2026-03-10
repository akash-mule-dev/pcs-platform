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
      background: var(--clay-bg);
      position: relative;
      overflow: hidden;
    }
    .login-container::before {
      content: '';
      position: absolute;
      width: 500px; height: 500px;
      background: radial-gradient(circle, rgba(232,148,90,0.12), transparent);
      top: -100px; right: -100px;
      border-radius: 50%;
    }
    .login-container::after {
      content: '';
      position: absolute;
      width: 400px; height: 400px;
      background: radial-gradient(circle, rgba(91,127,166,0.1), transparent);
      bottom: -80px; left: -80px;
      border-radius: 50%;
    }
    .login-card {
      width: 420px;
      padding: 40px 36px;
      background: var(--clay-surface) !important;
      border-radius: var(--clay-radius-lg) !important;
      box-shadow:
        10px 10px 20px rgba(0,0,0,0.08),
        -8px -8px 18px rgba(255,255,255,0.6) !important;
      border: 1px solid var(--clay-border) !important;
      position: relative;
      z-index: 1;
    }
    .login-header {
      text-align: center;
      width: 100%;
      margin-bottom: 28px;
    }
    .login-header h1 {
      margin: 12px 0 4px;
      font-size: 24px;
      font-weight: 700;
      color: var(--clay-text);
      letter-spacing: -0.02em;
    }
    .login-header p { margin: 0; color: var(--clay-text-muted); font-size: 14px; }
    .login-logo {
      font-size: 52px; width: 52px; height: 52px;
      color: var(--clay-accent);
      filter: drop-shadow(2px 2px 4px rgba(0,0,0,0.1));
    }
    .login-form { display: flex; flex-direction: column; gap: 8px; }
    .full-width { width: 100%; }
    .login-btn {
      height: 50px;
      font-size: 16px;
      font-weight: 600;
      border-radius: var(--clay-radius-sm) !important;
      box-shadow: var(--clay-shadow-raised) !important;
      margin-top: 8px;
    }
    .login-btn:hover {
      box-shadow: var(--clay-shadow-hover) !important;
      transform: translateY(-1px);
    }
    .error-message {
      background: #fceae8;
      color: #a0352a;
      padding: 12px 16px;
      border-radius: var(--clay-radius-xs);
      margin-bottom: 16px;
      font-size: 13px;
      font-weight: 500;
      box-shadow: var(--clay-shadow-inset);
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
