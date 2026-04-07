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
import { ThemeService } from '../../core/services/theme.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <div class="login-container">
      <div class="login-bg-pattern"></div>
      <div class="login-card-wrapper">
        <mat-card class="login-card">
          <mat-card-header>
            <div class="login-header">
              <div class="login-logo-mark">SB</div>
              <h1>SpadeBloom</h1>
              <p>Production Control System</p>
            </div>
          </mat-card-header>
          <mat-card-content>
            @if (error) {
              <div class="error-message">
                <mat-icon>error_outline</mat-icon>
                <span>{{ error }}</span>
              </div>
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
        <button class="theme-toggle" (click)="themeService.toggle()">
          <mat-icon>{{ themeService.theme() === 'dark' ? 'light_mode' : 'dark_mode' }}</mat-icon>
        </button>
      </div>
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
    .login-bg-pattern {
      position: absolute;
      inset: 0;
      background:
        radial-gradient(ellipse at 20% 80%, var(--clay-primary) 0%, transparent 50%),
        radial-gradient(ellipse at 80% 20%, var(--clay-accent) 0%, transparent 50%);
      opacity: 0.04;
    }
    .login-card-wrapper {
      position: relative;
      z-index: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
    }
    .login-card {
      width: 400px;
      padding: 40px 36px;
      background: var(--clay-surface) !important;
      border-radius: var(--clay-radius-lg) !important;
      box-shadow: var(--clay-shadow-hover) !important;
      border: 1px solid var(--clay-border) !important;
    }
    .login-header {
      text-align: center;
      width: 100%;
      margin-bottom: 28px;
    }
    .login-header h1 {
      margin: 14px 0 4px;
      font-size: 22px;
      font-weight: 700;
      color: var(--clay-text);
      letter-spacing: -0.02em;
    }
    .login-header p { margin: 0; color: var(--clay-text-muted); font-size: 13px; }
    .login-logo-mark {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 52px; height: 52px;
      background: linear-gradient(135deg, var(--clay-primary), var(--clay-accent));
      border-radius: 14px;
      font-size: 18px; font-weight: 700; color: #fff;
      letter-spacing: 0.02em;
    }
    .login-form { display: flex; flex-direction: column; gap: 8px; }
    .full-width { width: 100%; }
    .login-btn {
      height: 48px;
      font-size: 15px;
      font-weight: 600;
      border-radius: var(--clay-radius-sm) !important;
      margin-top: 8px;
    }
    .error-message {
      display: flex;
      align-items: center;
      gap: 8px;
      background: var(--error-bg);
      color: var(--error-text);
      padding: 12px 16px;
      border-radius: var(--clay-radius-xs);
      margin-bottom: 16px;
      font-size: 13px;
      font-weight: 500;
      border: 1px solid var(--error-border);
    }
    .error-message mat-icon {
      font-size: 18px; width: 18px; height: 18px;
      flex-shrink: 0;
    }
    .theme-toggle {
      background: var(--clay-surface);
      border: 1px solid var(--clay-border);
      border-radius: 50%;
      width: 40px; height: 40px;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer;
      color: var(--clay-text-muted);
      transition: all 0.2s ease;
    }
    .theme-toggle:hover {
      color: var(--clay-text);
      box-shadow: var(--clay-shadow-raised);
    }
    .theme-toggle mat-icon { font-size: 20px; width: 20px; height: 20px; }
    ::ng-deep .login-card .mat-mdc-card-header { display: block; }
  `]
})
export class LoginComponent {
  email = '';
  password = '';
  hidePassword = true;
  loading = false;
  error = '';

  constructor(
    private auth: AuthService,
    private router: Router,
    public themeService: ThemeService,
  ) {}

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
