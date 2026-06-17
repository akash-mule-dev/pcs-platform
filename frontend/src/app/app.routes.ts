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
        // Projects feature (portfolio list + per-project workspace with tabbed
        // child routes). Lazily loaded so the workspace shell + store stay out of
        // the main bundle.
        path: 'projects',
        canActivate: [featureGuard('projects')],
        loadChildren: () => import('./projects/projects.routes').then(m => m.PROJECTS_ROUTES),
      },
      {
        // Tenant-wide package monitor: live import pipeline (queue positions,
        // stage/%) + upload history across every project of the org.
        path: 'package-monitor',
        canActivate: [featureGuard('projects')],
        loadComponent: () => import('./projects/package-monitor.component').then(m => m.PackageMonitorComponent)
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
        // Production cockpit: KPIs, stage funnel and every production order with
        // live progress. The legacy flat work-order list moved to /legacy.
        path: 'work-orders',
        canActivate: [featureGuard('work-orders')],
        loadComponent: () => import('./work-orders/work-orders-dashboard.component').then(m => m.WorkOrdersDashboardComponent)
      },
      {
        path: 'work-orders/legacy',
        canActivate: [featureGuard('work-orders')],
        loadComponent: () => import('./work-orders/work-order-list/work-order-list.component').then(m => m.WorkOrderListComponent)
      },
      {
        // Legacy work-order detail (the audit dashboard owns /work-orders/:id now).
        path: 'work-orders/legacy/:id',
        canActivate: [featureGuard('work-orders')],
        loadComponent: () => import('./work-orders/work-order-detail/work-order-detail.component').then(m => m.WorkOrderDetailComponent)
      },
      {
        path: 'work-orders/kanban',
        canActivate: [featureGuard('kanban')],
        loadComponent: () => import('./work-orders/work-order-kanban/work-order-kanban.component').then(m => m.WorkOrderKanbanComponent)
      },
      {
        // Shipping is part of the WORK ORDER (production order), not the project.
        path: 'work-orders/:id/shipping',
        canActivate: [featureGuard('shipping')],
        loadComponent: () => import('./work-orders/work-order-shipping.component').then(m => m.WorkOrderShippingComponent)
      },
      {
        // Per-order AUDIT dashboard: assemblies left, full stage trail right, bulk edit.
        path: 'work-orders/:id',
        canActivate: [featureGuard('work-orders')],
        loadComponent: () => import('./work-orders/work-order-audit.component').then(m => m.WorkOrderAuditComponent)
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
        path: 'quality-insights',
        canActivate: [featureGuard('quality-analysis')],
        loadComponent: () => import('./quality-insights/quality-insights.component').then(m => m.QualityInsightsComponent)
      },
      {
        path: 'materials',
        canActivate: [featureGuard('materials')],
        loadComponent: () => import('./materials/materials.component').then(m => m.MaterialsComponent)
      },
      {
        path: 'quality-reports',
        canActivate: [featureGuard('quality-reports')],
        loadComponent: () => import('./quality-reports/reports-list.component').then(m => m.ReportsListComponent)
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
        canActivate: [featureGuard('roles')],
        loadComponent: () => import('./rbac/rbac.component').then(m => m.RbacComponent)
      },
      {
        path: 'organizations',
        canActivate: [featureGuard('organizations')],
        loadComponent: () => import('./organizations/organizations.component').then(m => m.OrganizationsComponent)
      },
      {
        path: 'library',
        canActivate: [featureGuard('library')],
        loadComponent: () => import('./library/library.component').then(m => m.LibraryComponent)
      },
      {
        path: 'platform-insights',
        canActivate: [featureGuard('platform-insights')],
        loadComponent: () => import('./platform-insights/platform-insights.component').then(m => m.PlatformInsightsComponent)
      },
      {
        path: 'company',
        canActivate: [featureGuard('company')],
        loadComponent: () => import('./company/company.component').then(m => m.CompanyComponent)
      },
      {
        path: 'support',
        canActivate: [featureGuard('support')],
        loadComponent: () => import('./support/support.component').then(m => m.SupportComponent)
      },
      {
        path: 'support-desk',
        canActivate: [featureGuard('support-desk')],
        loadComponent: () => import('./support/support-desk.component').then(m => m.SupportDeskComponent)
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
    // Full-screen QC report fill page — OUTSIDE the shell and auth guard so the
    // mobile app can open it in a browser with ?token=<jwt> (stored + stripped
    // by the component; the API itself still requires the bearer token).
    path: 'qr/:id',
    loadComponent: () => import('./quality-reports/report-fill.component').then(m => m.ReportFillComponent)
  },
  {
    path: '404',
    loadComponent: () => import('./shared/not-found/not-found.component').then(m => m.NotFoundComponent)
  },
  { path: '**', redirectTo: '404' }
];
