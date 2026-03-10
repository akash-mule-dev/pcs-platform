import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { AuthService, User } from '../core/services/auth.service';

interface NavItem {
  label: string;
  icon: string;
  route: string;
  roles?: string[];
}

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [CommonModule, RouterModule, MatSidenavModule, MatToolbarModule, MatListModule, MatIconModule, MatButtonModule],
  template: `
    <mat-sidenav-container class="layout-container">
      <mat-sidenav mode="side" opened class="sidenav">
        <div class="sidenav-header">
          <mat-icon class="logo-icon">precision_manufacturing</mat-icon>
          <span class="logo-text">PCS Platform</span>
        </div>
        <mat-nav-list>
          @for (item of visibleNavItems; track item.route) {
            <a mat-list-item [routerLink]="item.route" routerLinkActive="active-link">
              <mat-icon matListItemIcon>{{ item.icon }}</mat-icon>
              <span matListItemTitle>{{ item.label }}</span>
            </a>
          }
        </mat-nav-list>
      </mat-sidenav>
      <mat-sidenav-content class="content-area">
        <mat-toolbar color="primary" class="top-toolbar">
          <span class="toolbar-spacer"></span>
          @if (currentUser) {
            <span class="user-name">{{ currentUser.firstName }} {{ currentUser.lastName }}</span>
            <span class="user-role">({{ currentUser.role?.name || currentUser.role }})</span>
          }
          <button mat-icon-button (click)="logout()" matTooltip="Logout">
            <mat-icon>logout</mat-icon>
          </button>
        </mat-toolbar>
        <div class="page-content">
          <router-outlet></router-outlet>
        </div>
      </mat-sidenav-content>
    </mat-sidenav-container>
  `,
  styles: [`
    .layout-container { height: 100vh; }
    .sidenav {
      width: 260px;
      background: linear-gradient(180deg, #283593 0%, #3949ab 100%);
      color: white;
    }
    .sidenav-header {
      display: flex;
      align-items: center;
      padding: 24px 16px;
      gap: 12px;
      border-bottom: 1px solid rgba(255,255,255,0.15);
      background: rgba(0,0,0,0.1);
    }
    .logo-icon { font-size: 32px; width: 32px; height: 32px; color: #ffa726; }
    .logo-text { font-size: 20px; font-weight: 600; letter-spacing: 0.5px; }
    .sidenav ::ng-deep .mat-mdc-list-item {
      color: rgba(255,255,255,0.9) !important;
      border-radius: 0 24px 24px 0;
      margin-right: 12px;
      margin-bottom: 2px;
    }
    .sidenav ::ng-deep .mat-mdc-list-item:hover {
      background: rgba(255,255,255,0.08) !important;
    }
    .sidenav ::ng-deep .active-link {
      background: rgba(255,255,255,0.18) !important;
      color: #ffa726 !important;
    }
    .sidenav ::ng-deep .mat-mdc-list-item .mat-icon {
      color: rgba(255,255,255,0.75);
    }
    .sidenav ::ng-deep .active-link .mat-icon {
      color: #ffa726;
    }
    .top-toolbar {
      position: sticky;
      top: 0;
      z-index: 10;
    }
    .toolbar-spacer { flex: 1; }
    .user-name { margin-right: 4px; font-size: 14px; }
    .user-role { margin-right: 16px; font-size: 12px; opacity: 0.8; }
    .page-content { padding: 24px; background: #f5f5f5; min-height: calc(100vh - 64px); }
    .content-area { display: flex; flex-direction: column; }
  `]
})
export class LayoutComponent implements OnInit {
  currentUser: User | null = null;

  navItems: NavItem[] = [
    { label: 'Dashboard', icon: 'dashboard', route: '/' },
    { label: 'Products', icon: 'inventory_2', route: '/products' },
    { label: 'Processes', icon: 'account_tree', route: '/processes' },
    { label: 'Work Orders', icon: 'assignment', route: '/work-orders' },
    { label: 'Time Tracking', icon: 'timer', route: '/time-tracking' },
    { label: 'Users', icon: 'people', route: '/users', roles: ['admin', 'manager'] },
    { label: 'Stations', icon: 'location_on', route: '/stations', roles: ['admin', 'manager'] },
    { label: 'Reports', icon: 'bar_chart', route: '/reports' },
  ];

  get visibleNavItems(): NavItem[] {
    return this.navItems.filter(item =>
      !item.roles || item.roles.includes(this.auth.userRole)
    );
  }

  constructor(private auth: AuthService) {}

  ngOnInit(): void {
    this.auth.currentUser$.subscribe(user => this.currentUser = user);
  }

  logout(): void {
    this.auth.logout();
  }
}
