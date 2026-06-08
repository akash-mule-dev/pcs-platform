import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { featureGuard } from './core/guards/role.guard';
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
        canActivate: [featureGuard('dashboard')],
        loadComponent: () => import('./dashboard/dashboard.component').then(m => m.DashboardComponent)
      },
      {
        path: 'products',
        canActivate: [featureGuard('products')],
        loadComponent: () => import('./products/product-list/product-list.component').then(m => m.ProductListComponent)
      },
      {
        path: 'processes',
        canActivate: [featureGuard('processes')],
        loadComponent: () => import('./processes/process-list/process-list.component').then(m => m.ProcessListComponent)
      },
      {
        path: 'processes/:id',
        canActivate: [featureGuard('processes')],
        loadComponent: () => import('./processes/process-detail/process-detail.component').then(m => m.ProcessDetailComponent)
      },
      {
        path: 'work-orders',
        canActivate: [featureGuard('work-orders')],
        loadComponent: () => import('./work-orders/work-order-list/work-order-list.component').then(m => m.WorkOrderListComponent)
      },
      {
        path: 'work-orders/kanban',
        canActivate: [featureGuard('kanban')],
        loadComponent: () => import('./work-orders/work-order-kanban/work-order-kanban.component').then(m => m.WorkOrderKanbanComponent)
      },
      {
        path: 'work-orders/:id',
        canActivate: [featureGuard('work-orders')],
        loadComponent: () => import('./work-orders/work-order-detail/work-order-detail.component').then(m => m.WorkOrderDetailComponent)
      },
      {
        path: 'time-tracking',
        canActivate: [featureGuard('time-tracking')],
        loadComponent: () => import('./time-tracking/time-tracking-live/time-tracking-live.component').then(m => m.TimeTrackingLiveComponent)
      },
      {
        path: 'time-tracking/history',
        canActivate: [featureGuard('time-tracking')],
        loadComponent: () => import('./time-tracking/time-tracking-history/time-tracking-history.component').then(m => m.TimeTrackingHistoryComponent)
      },
      {
        path: 'users',
        canActivate: [featureGuard('users')],
        loadComponent: () => import('./users/user-list/user-list.component').then(m => m.UserListComponent)
      },
      {
        path: 'stations',
        canActivate: [featureGuard('stations')],
        loadComponent: () => import('./stations/station-management/station-management.component').then(m => m.StationManagementComponent)
      },
      {
        path: 'quality-analysis',
        canActivate: [featureGuard('quality-analysis')],
        loadComponent: () => import('./quality-analysis/quality-analysis.component').then(m => m.QualityAnalysisComponent)
      },
      {
        path: 'materials',
        canActivate: [featureGuard('materials')],
        loadComponent: () => import('./materials/materials.component').then(m => m.MaterialsComponent)
      },
      {
        path: 'ncr',
        canActivate: [featureGuard('ncr')],
        loadComponent: () => import('./quality-ncr/ncr.component').then(m => m.NcrComponent)
      },
      {
        path: 'equipment',
        canActivate: [featureGuard('equipment')],
        loadComponent: () => import('./equipment/equipment.component').then(m => m.EquipmentComponent)
      },
      {
        path: 'workforce',
        canActivate: [featureGuard('workforce')],
        loadComponent: () => import('./workforce/workforce.component').then(m => m.WorkforceComponent)
      },
      {
        path: 'scheduling',
        canActivate: [featureGuard('scheduling')],
        loadComponent: () => import('./scheduling/scheduling.component').then(m => m.SchedulingComponent)
      },
      {
        path: 'traceability',
        canActivate: [featureGuard('traceability')],
        loadComponent: () => import('./traceability/traceability.component').then(m => m.TraceabilityComponent)
      },
      {
        path: 'rbac',
        canActivate: [featureGuard('rbac')],
        loadComponent: () => import('./rbac/rbac.component').then(m => m.RbacComponent)
      },
      {
        path: 'organizations',
        canActivate: [featureGuard('organizations')],
        loadComponent: () => import('./organizations/organizations.component').then(m => m.OrganizationsComponent)
      },
      {
        path: 'costing',
        canActivate: [featureGuard('costing')],
        loadComponent: () => import('./costing/costing.component').then(m => m.CostingComponent)
      },
      {
        path: 'templates',
        canActivate: [featureGuard('templates')],
        loadComponent: () => import('./templates/templates.component').then(m => m.TemplatesComponent)
      },
      {
        path: 'notifications',
        loadComponent: () => import('./notifications/notifications.component').then(m => m.NotificationsComponent)
      },
      {
        path: 'audit',
        canActivate: [featureGuard('audit')],
        loadComponent: () => import('./audit/audit.component').then(m => m.AuditComponent)
      },
      {
        path: 'reports',
        canActivate: [featureGuard('reports')],
        loadComponent: () => import('./reports/reports.component').then(m => m.ReportsComponent)
      },
      {
        path: 'coordination',
        canActivate: [featureGuard('coordination')],
        loadComponent: () => import('./coordination/coordination-list.component').then(m => m.CoordinationListComponent)
      },
      {
        path: 'coordination/:id',
        canActivate: [featureGuard('coordination')],
        loadComponent: () => import('./coordination/coordination-view.component').then(m => m.CoordinationViewComponent)
      },
      {
        path: 'conversion',
        canActivate: [featureGuard('coordination')],
        loadComponent: () => import('./conversion/conversion-upload.component').then(m => m.ConversionUploadComponent)
      },
      {
        path: 'model-viewer',
        canActivate: [featureGuard('coordination')],
        loadComponent: () => import('./engineering/glb-viewer/glb-viewer.component').then(m => m.GlbViewerComponent)
      }
    ]
  },
  {
    path: '404',
    loadComponent: () => import('./shared/not-found/not-found.component').then(m => m.NotFoundComponent)
  },
  { path: '**', redirectTo: '404' }
];
