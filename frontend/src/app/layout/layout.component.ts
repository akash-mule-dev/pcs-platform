import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatBadgeModule } from '@angular/material/badge';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Subscription, Subject, debounceTime, switchMap, of } from 'rxjs';
import { AuthService, User } from '../core/services/auth.service';
import { NotificationService } from '../core/services/notification.service';
import { SearchService, SearchResults } from '../core/services/search.service';

interface NavItem {
  label: string;
  icon: string;
  route: string;
  roles?: string[];
}

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [
    CommonModule, RouterModule, FormsModule,
    MatToolbarModule, MatListModule, MatIconModule,
    MatButtonModule, MatBadgeModule, MatFormFieldModule, MatInputModule,
    MatAutocompleteModule, MatTooltipModule,
  ],
  template: `
    <div class="layout-container">
      <aside class="sidenav" [class.collapsed]="sidenavCollapsed">
        <div class="sidenav-header">
          <mat-icon class="logo-icon">precision_manufacturing</mat-icon>
          @if (!sidenavCollapsed) {
            <span class="logo-text">PCS Platform</span>
          }
        </div>
        <mat-nav-list>
          @for (item of visibleNavItems; track item.route) {
            <a mat-list-item [routerLink]="item.route" routerLinkActive="active-link"
               [matTooltip]="sidenavCollapsed ? item.label : ''" matTooltipPosition="right">
              <mat-icon matListItemIcon>{{ item.icon }}</mat-icon>
              @if (!sidenavCollapsed) {
                <span matListItemTitle>{{ item.label }}</span>
              }
            </a>
          }
        </mat-nav-list>
      </aside>
      <div class="main-content" [class.collapsed]="sidenavCollapsed">
        <mat-toolbar color="primary" class="top-toolbar">
          <button mat-icon-button (click)="toggleSidenav()" matTooltip="Toggle menu">
            <mat-icon>{{ sidenavCollapsed ? 'menu' : 'menu_open' }}</mat-icon>
          </button>
          <!-- Global Search -->
          <div class="search-container">
            <mat-icon class="search-icon">search</mat-icon>
            <input type="text" class="search-input" placeholder="Search orders, products, users..."
                   [(ngModel)]="searchQuery" (input)="onSearchInput()">
            @if (searchResults && searchQuery.length >= 2) {
              <div class="search-dropdown">
                @if (searchResults.workOrders.length > 0) {
                  <div class="search-group">
                    <div class="search-group-title">Work Orders</div>
                    @for (wo of searchResults.workOrders; track wo.id) {
                      <div class="search-item" (click)="navigateTo('/work-orders/' + wo.id)">
                        <mat-icon>assignment</mat-icon>
                        <span>{{ wo.orderNumber }} — {{ wo.product?.name }}</span>
                      </div>
                    }
                  </div>
                }
                @if (searchResults.products.length > 0) {
                  <div class="search-group">
                    <div class="search-group-title">Products</div>
                    @for (p of searchResults.products; track p.id) {
                      <div class="search-item" (click)="navigateTo('/products')">
                        <mat-icon>inventory_2</mat-icon>
                        <span>{{ p.name }} ({{ p.sku }})</span>
                      </div>
                    }
                  </div>
                }
                @if (searchResults.users.length > 0) {
                  <div class="search-group">
                    <div class="search-group-title">Users</div>
                    @for (u of searchResults.users; track u.id) {
                      <div class="search-item" (click)="navigateTo('/users')">
                        <mat-icon>person</mat-icon>
                        <span>{{ u.firstName }} {{ u.lastName }} ({{ u.employeeId }})</span>
                      </div>
                    }
                  </div>
                }
                @if (searchResults.workOrders.length === 0 && searchResults.products.length === 0 && searchResults.users.length === 0) {
                  <div class="search-empty">No results found</div>
                }
              </div>
            }
          </div>

          <span class="toolbar-spacer"></span>

          <!-- Notification Bell -->
          <button mat-icon-button (click)="navigateTo('/notifications')" matTooltip="Notifications"
                  [matBadge]="unreadCount > 0 ? unreadCount : null" matBadgeColor="accent" matBadgeSize="small">
            <mat-icon>notifications</mat-icon>
          </button>

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
      </div>
    </div>
  `,
  styles: [`
    .layout-container {
      display: flex;
      height: 100vh;
      overflow: hidden;
    }
    .sidenav {
      width: 260px;
      min-width: 260px;
      background: var(--clay-sidebar);
      color: var(--clay-text);
      border-right: 1px solid var(--clay-border);
      box-shadow: 4px 0 12px rgba(0,0,0,0.04);
      transition: width 0.25s ease, min-width 0.25s ease;
      overflow-x: hidden;
      overflow-y: auto;
    }
    .sidenav.collapsed {
      width: 64px;
      min-width: 64px;
    }
    .main-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      min-width: 0;
    }
    .sidenav-header {
      display: flex;
      align-items: center;
      padding: 24px 20px;
      gap: 12px;
      border-bottom: 1px solid var(--clay-border);
      background: var(--clay-sidebar-active);
      white-space: nowrap;
      overflow: hidden;
    }
    .sidenav.collapsed .sidenav-header {
      justify-content: center;
      padding: 24px 12px;
    }
    .logo-icon {
      font-size: 32px; width: 32px; height: 32px;
      color: var(--clay-accent);
      filter: drop-shadow(1px 1px 2px rgba(0,0,0,0.1));
    }
    .logo-text {
      font-size: 18px; font-weight: 700;
      color: var(--clay-text);
      letter-spacing: -0.01em;
    }
    .sidenav ::ng-deep .mat-mdc-list-item {
      color: var(--clay-text-secondary) !important;
      border-radius: 0 var(--clay-radius-sm) var(--clay-radius-sm) 0;
      margin: 2px 12px 2px 0;
      transition: all var(--clay-transition);
    }
    .sidenav ::ng-deep .mat-mdc-list-item:hover {
      background: var(--clay-surface) !important;
      color: var(--clay-text) !important;
      box-shadow: var(--clay-shadow-soft);
    }
    .sidenav ::ng-deep .active-link {
      background: var(--clay-surface) !important;
      color: var(--clay-primary) !important;
      box-shadow: var(--clay-shadow-raised);
      font-weight: 600;
    }
    .sidenav ::ng-deep .mat-mdc-list-item .mat-icon {
      color: var(--clay-text-muted);
      transition: color var(--clay-transition);
    }
    .sidenav ::ng-deep .mat-mdc-list-item:hover .mat-icon {
      color: var(--clay-text);
    }
    .sidenav ::ng-deep .active-link .mat-icon {
      color: var(--clay-accent);
    }
    .top-toolbar {
      position: sticky;
      top: 0;
      z-index: 10;
      background: var(--clay-surface) !important;
      color: var(--clay-text) !important;
      box-shadow: var(--clay-shadow-soft) !important;
      border-bottom: 1px solid var(--clay-border);
    }
    .toolbar-spacer { flex: 1; }
    .user-name { margin-right: 4px; font-size: 14px; font-weight: 500; color: var(--clay-text); }
    .user-role { margin-right: 16px; font-size: 12px; color: var(--clay-text-muted); }
    .page-content {
      padding: 28px;
      background: var(--clay-bg);
      flex: 1;
      overflow-y: auto;
    }

    /* Global Search */
    .search-container {
      position: relative; display: flex; align-items: center;
      background: var(--clay-bg, #f0ece2); border-radius: var(--clay-radius-sm);
      padding: 4px 12px; max-width: 380px; width: 100%;
      box-shadow: var(--clay-shadow-inset);
    }
    .search-icon { color: var(--clay-text-muted); font-size: 20px; width: 20px; height: 20px; margin-right: 8px; }
    .search-input {
      border: none; outline: none; background: transparent; font-size: 13px;
      color: var(--clay-text); width: 100%; padding: 6px 0;
      font-family: inherit;
    }
    .search-input::placeholder { color: var(--clay-text-muted); }
    .search-dropdown {
      position: absolute; top: 100%; left: 0; right: 0;
      background: var(--clay-surface); border-radius: 0 0 var(--clay-radius-sm) var(--clay-radius-sm);
      box-shadow: var(--clay-shadow-hover); z-index: 100;
      max-height: 400px; overflow-y: auto; border: 1px solid var(--clay-border);
    }
    .search-group { padding: 8px 0; }
    .search-group-title {
      padding: 4px 16px; font-size: 11px; font-weight: 700; color: var(--clay-text-muted);
      text-transform: uppercase; letter-spacing: 0.5px;
    }
    .search-item {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 16px; cursor: pointer; font-size: 13px;
      transition: background 0.15s;
    }
    .search-item:hover { background: var(--clay-bg); }
    .search-item mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--clay-text-muted); }
    .search-empty { padding: 16px; text-align: center; color: var(--clay-text-muted); font-size: 13px; }

    /* Collapsed sidenav overrides */
    .sidenav.collapsed ::ng-deep .mat-mdc-nav-list {
      padding: 8px 0;
    }
    .sidenav.collapsed ::ng-deep .mat-mdc-list-item {
      margin: 2px 6px !important;
      border-radius: var(--clay-radius-sm) !important;
      height: 44px !important;
      min-height: 44px !important;
      padding: 0 !important;
      width: calc(100% - 12px) !important;
    }
    .sidenav.collapsed ::ng-deep .mat-mdc-list-item .mdc-list-item__content {
      padding: 0 !important;
      display: flex !important;
      justify-content: center !important;
    }
    .sidenav.collapsed ::ng-deep .mat-mdc-list-item .mdc-list-item__start,
    .sidenav.collapsed ::ng-deep .mat-mdc-list-item .mdc-list-item__primary-text {
      margin: 0 !important;
      padding: 0 !important;
    }
    .sidenav.collapsed ::ng-deep .mat-mdc-list-item .mat-icon {
      margin: 0 !important;
      font-size: 22px;
      width: 22px;
      height: 22px;
    }
    .sidenav.collapsed ::ng-deep .mdc-list-item__start {
      margin-inline-end: 0 !important;
    }
  `]
})
export class LayoutComponent implements OnInit, OnDestroy {
  currentUser: User | null = null;
  unreadCount = 0;
  searchQuery = '';
  searchResults: SearchResults | null = null;
  sidenavCollapsed = false;
  private searchSubject = new Subject<string>();
  private subs: Subscription[] = [];

  navItems: NavItem[] = [
    { label: 'Dashboard', icon: 'dashboard', route: '/' },
    { label: 'Products', icon: 'inventory_2', route: '/products' },
    { label: 'Processes', icon: 'account_tree', route: '/processes' },
    { label: 'Work Orders', icon: 'assignment', route: '/work-orders' },
    { label: 'Time Tracking', icon: 'timer', route: '/time-tracking' },
    { label: 'Users', icon: 'people', route: '/users', roles: ['admin', 'manager'] },
    { label: 'Stations', icon: 'location_on', route: '/stations', roles: ['admin', 'manager'] },
    { label: 'Kanban', icon: 'view_kanban', route: '/work-orders/kanban' },
    { label: 'Coordination', icon: 'hub', route: '/coordination' },
    { label: '3D Quality', icon: 'view_in_ar', route: '/quality-analysis' },
    { label: 'Reports', icon: 'bar_chart', route: '/reports' },
    { label: 'Audit Log', icon: 'history', route: '/audit', roles: ['admin', 'manager'] },
  ];

  get visibleNavItems(): NavItem[] {
    return this.navItems.filter(item =>
      !item.roles || item.roles.includes(this.auth.userRole)
    );
  }

  constructor(
    private auth: AuthService,
    private notificationService: NotificationService,
    private searchService: SearchService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.subs.push(
      this.auth.currentUser$.subscribe(user => this.currentUser = user),
      this.notificationService.unreadCount$.subscribe(c => this.unreadCount = c),
      this.searchSubject.pipe(
        debounceTime(300),
        switchMap(q => q.length >= 2 ? this.searchService.search(q) : of(null)),
      ).subscribe(results => this.searchResults = results),
    );
  }

  ngOnDestroy(): void {
    this.subs.forEach(s => s.unsubscribe());
  }

  onSearchInput(): void {
    this.searchSubject.next(this.searchQuery);
    if (this.searchQuery.length < 2) this.searchResults = null;
  }

  navigateTo(path: string): void {
    this.searchQuery = '';
    this.searchResults = null;
    this.router.navigateByUrl(path);
  }

  toggleSidenav(): void {
    this.sidenavCollapsed = !this.sidenavCollapsed;
  }

  logout(): void {
    this.auth.logout();
  }
}
