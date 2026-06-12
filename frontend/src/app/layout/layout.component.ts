import { Component, OnInit, OnDestroy, HostListener } from '@angular/core';
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
import { MatMenuModule } from '@angular/material/menu';
import { Subscription, Subject, debounceTime, switchMap, of } from 'rxjs';
import { AuthService, User } from '../core/services/auth.service';
import { NotificationService } from '../core/services/notification.service';
import { SearchService, SearchResults } from '../core/services/search.service';
import { ThemeService, FONT_SIZE_OPTIONS } from '../core/services/theme.service';
import { BUILD_INFO } from '../../build-info';
import { PermissionsService } from '../core/services/permissions.service';

interface NavItem {
  label: string;
  icon: string;
  route: string;
  feature?: string;
  roles?: string[];
}

interface NavGroup {
  label: string;
  icon: string;
  expanded: boolean;
  items: (NavItem & { feature: string })[];
}

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [
    CommonModule, RouterModule, FormsModule,
    MatToolbarModule, MatListModule, MatIconModule,
    MatButtonModule, MatBadgeModule, MatFormFieldModule, MatInputModule,
    MatAutocompleteModule, MatTooltipModule, MatMenuModule,
  ],
  template: `
    <div class="layout-container">
      <div class="sidenav-overlay" [class.visible]="mobileMenuOpen" (click)="closeMobileMenu()"></div>
      <aside class="sidenav" [class.collapsed]="sidenavCollapsed" [class.mobile-open]="mobileMenuOpen">
        <div class="sidenav-header">
          <div class="logo-mark">SB</div>
          @if (!sidenavCollapsed) {
            <div class="logo-block">
              <span class="logo-text">SpadeBloom</span>
              <span class="logo-sub">Production Control</span>
            </div>
          }
        </div>
        <mat-nav-list>
          @if (sidenavCollapsed) {
            <!-- Collapsed: flat icon rail with tooltips -->
            @for (item of visibleNavItems; track item.route) {
              <a mat-list-item [routerLink]="item.route" routerLinkActive="active-link"
                 [routerLinkActiveOptions]="{ exact: item.route === '/' || item.route === '/work-orders' }"
                 [matTooltip]="item.label" matTooltipPosition="right" (click)="closeMobileMenu()">
                <mat-icon matListItemIcon>{{ item.icon }}</mat-icon>
              </a>
            }
          } @else {
            <!-- Expanded: Dashboard pinned, then collapsible groups -->
            <a mat-list-item [routerLink]="dashboardItem.route" routerLinkActive="active-link"
               [routerLinkActiveOptions]="{ exact: true }" (click)="closeMobileMenu()">
              <mat-icon matListItemIcon>{{ dashboardItem.icon }}</mat-icon>
              <span matListItemTitle>{{ dashboardItem.label }}</span>
            </a>
            @for (group of visibleGroups; track group.label) {
              <div class="nav-group">
                <button type="button" class="nav-group-header" (click)="toggleGroup(group)">
                  <mat-icon class="grp-icon">{{ group.icon }}</mat-icon>
                  <span class="grp-label">{{ group.label }}</span>
                  <mat-icon class="grp-chevron">{{ group.expanded ? 'expand_less' : 'expand_more' }}</mat-icon>
                </button>
                @if (group.expanded) {
                  @for (item of visibleItems(group); track item.route) {
                    <a mat-list-item class="nav-sub" [routerLink]="item.route" routerLinkActive="active-link"
                       [routerLinkActiveOptions]="{ exact: item.route === '/work-orders' }" (click)="closeMobileMenu()">
                      <mat-icon matListItemIcon>{{ item.icon }}</mat-icon>
                      <span matListItemTitle>{{ item.label }}</span>
                    </a>
                  }
                }
              </div>
            }
          }
        </mat-nav-list>
        @if (!sidenavCollapsed) {
          <div class="build-info" [matTooltip]="buildInfo.message" matTooltipPosition="right">
            <span class="build-commit">{{ buildInfo.branch }}&#64;{{ buildInfo.commit }}</span>
            <span class="build-time">{{ buildInfo.buildTime | date:'short' }}</span>
          </div>
        }
      </aside>
      <div class="main-content" [class.collapsed]="sidenavCollapsed">
        <mat-toolbar color="primary" class="top-toolbar">
          <button mat-icon-button (click)="toggleSidenav()" matTooltip="Toggle menu">
            <mat-icon>{{ sidenavCollapsed ? 'menu' : 'menu_open' }}</mat-icon>
          </button>
          <!-- Global Search -->
          <div class="search-container">
            <mat-icon class="search-icon">search</mat-icon>
            <input type="text" class="search-input" placeholder="Search orders, users..."
                   [(ngModel)]="searchQuery" (input)="onSearchInput()">
            @if (searchResults && searchQuery.length >= 2) {
              <div class="search-dropdown">
                @if (searchResults.workOrders.length > 0) {
                  <div class="search-group">
                    <div class="search-group-title">Work Orders</div>
                    @for (wo of searchResults.workOrders; track wo.id) {
                      <div class="search-item" (click)="navigateTo('/work-orders/legacy/' + wo.id)">
                        <mat-icon>assignment</mat-icon>
                        <span>{{ wo.orderNumber }}</span>
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
                @if (searchLoading) {
                  <div class="search-empty">Searching...</div>
                } @else if (searchResults.workOrders.length === 0 && searchResults.users.length === 0) {
                  <div class="search-empty">No results found for "{{ searchQuery }}"</div>
                }
              </div>
            }
          </div>

          <span class="toolbar-spacer"></span>

          <!-- Font Size -->
          <button mat-icon-button [matMenuTriggerFor]="fontSizeMenu" matTooltip="Font size">
            <mat-icon>text_fields</mat-icon>
          </button>
          <mat-menu #fontSizeMenu="matMenu">
            @for (opt of fontSizeOptions; track opt.value) {
              <button mat-menu-item (click)="themeService.setFontSize(opt.value)"
                      [class.font-size-active]="themeService.fontSize() === opt.value">
                <mat-icon>{{ themeService.fontSize() === opt.value ? 'check' : '' }}</mat-icon>
                <span>{{ opt.label }}</span>
              </button>
            }
          </mat-menu>

          <!-- Theme Toggle -->
          <button mat-icon-button (click)="themeService.toggle()"
                  [matTooltip]="themeService.theme() === 'dark' ? 'Switch to light' : 'Switch to dark'">
            <mat-icon>{{ themeService.theme() === 'dark' ? 'light_mode' : 'dark_mode' }}</mat-icon>
          </button>

          <!-- Notification Bell -->
          <button mat-icon-button (click)="navigateTo('/notifications')" matTooltip="Notifications"
                  [matBadge]="unreadCount > 0 ? (unreadCount > 99 ? '99+' : unreadCount) : null" matBadgeColor="accent" matBadgeSize="small">
            <mat-icon>notifications</mat-icon>
          </button>

          @if (currentUser) {
            <span class="user-name">{{ currentUser.firstName }} {{ currentUser.lastName }}</span>
            <span class="user-role">({{ currentUser.role.name || currentUser.role }})</span>
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

    /* ======================== SIDEBAR ======================== */
    .sidenav {
      width: 260px;
      min-width: 260px;
      background: var(--clay-sidebar);
      color: var(--clay-sidebar-text);
      border-right: 1px solid rgba(255, 255, 255, 0.06);
      transition: width 0.25s ease, min-width 0.25s ease;
      overflow-x: hidden;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
    }
    .sidenav.collapsed {
      width: 64px;
      min-width: 64px;
    }

    .sidenav-header {
      display: flex;
      align-items: center;
      padding: 20px;
      gap: 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      white-space: nowrap;
      overflow: hidden;
    }
    .sidenav.collapsed .sidenav-header {
      justify-content: center;
      padding: 20px 12px;
    }

    .logo-mark {
      width: 36px; height: 36px;
      background: linear-gradient(135deg, var(--clay-sidebar-accent), var(--clay-accent));
      border-radius: 8px;
      display: flex; align-items: center; justify-content: center;
      font-size: 13px; font-weight: 700; color: #fff;
      letter-spacing: 0.02em;
      flex-shrink: 0;
    }
    .logo-block {
      display: flex;
      flex-direction: column;
      gap: 1px;
    }
    .logo-text {
      font-size: 16px; font-weight: 700;
      color: #ffffff;
      letter-spacing: -0.01em;
    }
    .logo-sub {
      font-size: 11px;
      color: var(--clay-sidebar-text);
      letter-spacing: 0.02em;
    }

    /* Nav items — force text/icon colors on all Material internals */
    .sidenav ::ng-deep .mat-mdc-list-item {
      color: var(--clay-sidebar-text) !important;
      border-radius: 0 var(--clay-radius-sm) var(--clay-radius-sm) 0;
      margin: 1px 12px 1px 0;
      transition: all var(--clay-transition);
      height: 42px !important;
    }
    .sidenav ::ng-deep .mat-mdc-list-item .mdc-list-item__primary-text,
    .sidenav ::ng-deep .mat-mdc-list-item .mat-mdc-list-item-title,
    .sidenav ::ng-deep .mat-mdc-list-item span[matlistitemtitle] {
      color: var(--clay-sidebar-text) !important;
    }
    .sidenav ::ng-deep .mat-mdc-list-item .mat-icon,
    .sidenav ::ng-deep .mat-mdc-list-item .mdc-list-item__start {
      color: var(--clay-sidebar-text) !important;
      font-size: 20px;
      width: 20px;
      height: 20px;
      transition: color var(--clay-transition);
    }

    .sidenav ::ng-deep .mat-mdc-list-item:hover {
      background: rgba(255, 255, 255, 0.06) !important;
    }
    .sidenav ::ng-deep .mat-mdc-list-item:hover .mdc-list-item__primary-text,
    .sidenav ::ng-deep .mat-mdc-list-item:hover span[matlistitemtitle],
    .sidenav ::ng-deep .mat-mdc-list-item:hover .mat-icon {
      color: var(--clay-sidebar-text-hover) !important;
    }

    .sidenav ::ng-deep .active-link {
      background: rgba(255, 255, 255, 0.08) !important;
      font-weight: 600;
    }
    .sidenav ::ng-deep .active-link .mdc-list-item__primary-text,
    .sidenav ::ng-deep .active-link span[matlistitemtitle] {
      color: var(--clay-sidebar-text-active) !important;
    }
    .sidenav ::ng-deep .active-link .mat-icon {
      color: var(--clay-sidebar-accent) !important;
    }

    /* Collapsed sidenav */
    .sidenav.collapsed ::ng-deep .mat-mdc-nav-list { padding: 8px 0; }
    .sidenav.collapsed ::ng-deep .mat-mdc-list-item {
      margin: 2px 6px !important;
      border-radius: var(--clay-radius-sm) !important;
      height: 44px !important;
      min-height: 44px !important;
      padding: 0 !important;
      width: calc(100% - 12px) !important;
    }
    .sidenav.collapsed ::ng-deep .mat-mdc-list-item .mdc-list-item__content {
      padding: 0 !important; display: flex !important; justify-content: center !important;
    }
    .sidenav.collapsed ::ng-deep .mat-mdc-list-item .mdc-list-item__start,
    .sidenav.collapsed ::ng-deep .mat-mdc-list-item .mdc-list-item__primary-text {
      margin: 0 !important; padding: 0 !important;
    }
    .sidenav.collapsed ::ng-deep .mat-mdc-list-item .mat-icon {
      margin: 0 !important; font-size: 22px; width: 22px; height: 22px;
    }
    .sidenav.collapsed ::ng-deep .mdc-list-item__start { margin-inline-end: 0 !important; }
    .sidenav.collapsed ::ng-deep .mat-mdc-list-item { overflow: visible !important; }

    /* Nav groups */
    .nav-group { margin-top: 2px; }
    .nav-group-header {
      display: flex; align-items: center; gap: 12px;
      width: calc(100% - 12px); margin: 1px 12px 1px 0;
      padding: 8px 16px; height: 36px;
      background: transparent; border: none; cursor: pointer;
      color: var(--clay-sidebar-text); font: inherit; text-align: left;
      border-radius: 0 var(--clay-radius-sm) var(--clay-radius-sm) 0;
      opacity: 0.7; transition: all var(--clay-transition);
    }
    .nav-group-header:hover { background: rgba(255, 255, 255, 0.05); opacity: 1; }
    .nav-group-header .grp-icon { font-size: 18px; width: 18px; height: 18px; flex-shrink: 0; }
    .nav-group-header .grp-label {
      flex: 1; font-size: 11px; font-weight: 700; letter-spacing: 0.06em;
      text-transform: uppercase; font-family: 'Space Grotesk', sans-serif; white-space: nowrap;
    }
    .nav-group-header .grp-chevron { font-size: 18px; width: 18px; height: 18px; opacity: 0.6; }
    .sidenav ::ng-deep a.nav-sub { padding-left: 10px !important; }
    .sidenav ::ng-deep a.nav-sub .mat-icon { font-size: 18px; width: 18px; height: 18px; }

    /* Build info */
    .build-info {
      padding: 12px 20px;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
      font-size: 11px;
      color: var(--clay-sidebar-text);
      display: flex;
      flex-direction: column;
      gap: 2px;
      margin-top: auto;
      cursor: default;
      opacity: 0.6;
    }
    .build-commit { font-family: 'Space Grotesk', monospace; font-weight: 600; }
    .build-time { opacity: 0.7; }

    /* ======================== MAIN CONTENT ======================== */
    .main-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      min-width: 0;
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
    .user-name { margin-right: 4px; font-size: 13px; font-weight: 500; color: var(--clay-text); }
    .user-role { margin-right: 12px; font-size: 11px; color: var(--clay-text-muted); }

    .page-content {
      padding: 24px;
      background: var(--clay-bg);
      flex: 1;
      overflow-y: auto;
    }

    /* ======================== SEARCH ======================== */
    .search-container {
      position: relative; display: flex; align-items: center;
      background: var(--clay-bg); border-radius: var(--clay-radius-sm);
      padding: 4px 12px; max-width: 380px; width: 100%;
      border: 1px solid var(--clay-border);
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
      padding: 4px 16px; font-size: 10px; font-weight: 700; color: var(--clay-text-muted);
      text-transform: uppercase; letter-spacing: 0.08em;
      font-family: 'Space Grotesk', sans-serif;
    }
    .search-item {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 16px; cursor: pointer; font-size: 13px;
      transition: background 0.15s; color: var(--clay-text);
    }
    .search-item:hover { background: var(--clay-bg); }
    .search-item mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--clay-text-muted); }
    .search-empty { padding: 16px; text-align: center; color: var(--clay-text-muted); font-size: 13px; }

    /* Font size menu active item */
    ::ng-deep .font-size-active {
      font-weight: 600;
      color: var(--clay-primary) !important;
    }

    /* Mobile overlay */
    .sidenav-overlay {
      display: none;
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 99;
      backdrop-filter: blur(2px);
    }

    @media (max-width: 768px) {
      .sidenav {
        position: fixed;
        top: 0; left: 0; bottom: 0;
        z-index: 100;
        transform: translateX(-100%);
        transition: transform 0.25s ease;
      }
      .sidenav.mobile-open { transform: translateX(0); }
      .sidenav.collapsed { transform: translateX(-100%); }
      .sidenav.collapsed.mobile-open {
        transform: translateX(0);
        width: 260px; min-width: 260px;
      }
      .main-content { margin-left: 0 !important; }
      .sidenav-overlay.visible { display: block; }
      .search-container { max-width: 160px; }
      .user-name, .user-role { display: none; }
      .page-content { padding: 16px; }
    }
  `]
})
export class LayoutComponent implements OnInit, OnDestroy {
  buildInfo = BUILD_INFO;
  fontSizeOptions = FONT_SIZE_OPTIONS;
  currentUser: User | null = null;
  unreadCount = 0;
  searchQuery = '';
  searchResults: SearchResults | null = null;
  searchLoading = false;
  sidenavCollapsed = false;
  mobileMenuOpen = false;
  private isMobile = false;
  private searchSubject = new Subject<string>();
  private subs: Subscription[] = [];

  dashboardItem: NavItem & { feature: string } = { label: 'Dashboard', icon: 'dashboard', route: '/', feature: 'dashboard' };

  navGroups: NavGroup[] = [
    { label: 'Production', icon: 'precision_manufacturing', expanded: true, items: [
      { label: 'Projects', icon: 'foundation', route: '/projects', feature: 'projects' },
      { label: 'Work Orders', icon: 'assignment', route: '/work-orders', feature: 'work-orders' },
      { label: 'Kanban', icon: 'view_kanban', route: '/work-orders/kanban', feature: 'kanban' },
      { label: 'Processes', icon: 'account_tree', route: '/processes', feature: 'processes' },
      { label: 'Capacity', icon: 'calendar_month', route: '/scheduling', feature: 'scheduling' },
    ] },
    { label: 'Shop Floor', icon: 'engineering', expanded: true, items: [
      { label: 'Time Tracking', icon: 'timer', route: '/time-tracking', feature: 'time-tracking' },
      { label: 'Equipment', icon: 'precision_manufacturing', route: '/equipment', feature: 'equipment' },
      { label: 'Stations', icon: 'location_on', route: '/stations', feature: 'stations' },
      { label: 'Workforce', icon: 'badge', route: '/workforce', feature: 'workforce' },
    ] },
    { label: 'Materials', icon: 'inventory_2', expanded: false, items: [
      { label: 'Materials', icon: 'category', route: '/materials', feature: 'materials' },
      { label: 'Traceability', icon: 'qr_code_2', route: '/traceability', feature: 'traceability' },
    ] },
    { label: 'Quality', icon: 'verified', expanded: false, items: [
      { label: 'QC Reports', icon: 'fact_check', route: '/quality-reports', feature: 'quality-reports' },
      { label: 'Report Templates', icon: 'dashboard_customize', route: '/templates', feature: 'templates' },
      { label: 'NCR / CAPA', icon: 'report_problem', route: '/ncr', feature: 'ncr' },
      { label: '3D Quality', icon: 'view_in_ar', route: '/quality-analysis', feature: 'quality-analysis' },
    ] },
    { label: 'Engineering', icon: 'hub', expanded: false, items: [
      { label: 'Coordination', icon: 'hub', route: '/coordination', feature: 'coordination' },
      { label: '3D Conversion', icon: 'transform', route: '/conversion', feature: 'coordination' },
      { label: 'Model Viewer', icon: 'view_in_ar', route: '/model-viewer', feature: 'coordination' },
    ] },
    { label: 'Analytics', icon: 'insights', expanded: false, items: [
      { label: 'Reports', icon: 'bar_chart', route: '/reports', feature: 'reports' },
      { label: 'Costing', icon: 'payments', route: '/costing', feature: 'costing' },
      { label: 'Audit Log', icon: 'history', route: '/audit', feature: 'audit' },
    ] },
    { label: 'Administration', icon: 'settings', expanded: false, items: [
      { label: 'Organizations', icon: 'corporate_fare', route: '/organizations', feature: 'organizations' },
      { label: 'Users', icon: 'people', route: '/users', feature: 'users' },
      { label: 'Roles & Access', icon: 'admin_panel_settings', route: '/rbac', feature: 'roles' },
    ] },
  ];

  visibleItems(group: NavGroup): (NavItem & { feature: string })[] {
    return group.items.filter(item => this.permissions.canView(item.feature));
  }

  get visibleGroups(): NavGroup[] {
    return this.navGroups.filter(g => this.visibleItems(g).length > 0);
  }

  get visibleNavItems(): (NavItem & { feature: string })[] {
    const all = [this.dashboardItem, ...this.navGroups.flatMap(g => g.items)];
    return all.filter(item => this.permissions.canView(item.feature));
  }

  toggleGroup(group: NavGroup): void {
    group.expanded = !group.expanded;
  }

  constructor(
    private auth: AuthService,
    private notificationService: NotificationService,
    private searchService: SearchService,
    private router: Router,
    public themeService: ThemeService,
    private permissions: PermissionsService,
  ) {}

  ngOnInit(): void {
    // Auto-expand the group containing the active route so the active item is visible.
    const url = this.router.url;
    for (const g of this.navGroups) {
      if (g.items.some(i => url === i.route || url.startsWith(i.route + '/'))) g.expanded = true;
    }
    this.subs.push(
      this.auth.currentUser$.subscribe(user => this.currentUser = user),
      this.notificationService.unreadCount$.subscribe(c => this.unreadCount = c),
      this.searchSubject.pipe(
        debounceTime(300),
        switchMap(q => {
          if (q.length >= 2) {
            this.searchLoading = true;
            return this.searchService.search(q);
          }
          return of(null);
        }),
      ).subscribe(results => { this.searchResults = results; this.searchLoading = false; }),
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
    this.isMobile = window.innerWidth <= 768;
    if (this.isMobile) {
      this.mobileMenuOpen = !this.mobileMenuOpen;
    } else {
      this.sidenavCollapsed = !this.sidenavCollapsed;
    }
  }

  closeMobileMenu(): void {
    this.mobileMenuOpen = false;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event): void {
    const target = event.target as HTMLElement;
    if (!target.closest('.search-container')) {
      this.searchResults = null;
    }
  }

  logout(): void {
    this.auth.logout();
  }
}
