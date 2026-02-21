import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { roleGuard } from './core/guards/role.guard';
import { LayoutComponent } from './layout/layout.component';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./auth/login/login.component').then(m => m.LoginComponent)
  },
  {
    path: '',
    component: LayoutComponent,
    canActivate: [authGuard],
    children: [
      {
        path: '',
        loadComponent: () => import('./dashboard/dashboard.component').then(m => m.DashboardComponent)
      },
      {
        path: 'products',
        loadComponent: () => import('./products/product-list/product-list.component').then(m => m.ProductListComponent)
      },
      {
        path: 'processes',
        loadComponent: () => import('./processes/process-list/process-list.component').then(m => m.ProcessListComponent)
      },
      {
        path: 'processes/:id',
        loadComponent: () => import('./processes/process-detail/process-detail.component').then(m => m.ProcessDetailComponent)
      },
      {
        path: 'work-orders',
        loadComponent: () => import('./work-orders/work-order-list/work-order-list.component').then(m => m.WorkOrderListComponent)
      },
      {
        path: 'work-orders/:id',
        loadComponent: () => import('./work-orders/work-order-detail/work-order-detail.component').then(m => m.WorkOrderDetailComponent)
      },
      {
        path: 'time-tracking',
        loadComponent: () => import('./time-tracking/time-tracking-live/time-tracking-live.component').then(m => m.TimeTrackingLiveComponent)
      },
      {
        path: 'time-tracking/history',
        loadComponent: () => import('./time-tracking/time-tracking-history/time-tracking-history.component').then(m => m.TimeTrackingHistoryComponent)
      },
      {
        path: 'users',
        canActivate: [roleGuard('admin', 'manager')],
        loadComponent: () => import('./users/user-list/user-list.component').then(m => m.UserListComponent)
      },
      {
        path: 'stations',
        canActivate: [roleGuard('admin', 'manager')],
        loadComponent: () => import('./stations/station-management/station-management.component').then(m => m.StationManagementComponent)
      },
      {
        path: 'reports',
        loadComponent: () => import('./reports/reports.component').then(m => m.ReportsComponent)
      }
    ]
  },
  { path: '**', redirectTo: '' }
];
