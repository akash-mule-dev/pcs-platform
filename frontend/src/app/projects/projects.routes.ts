import { Routes, Router, ActivatedRouteSnapshot } from '@angular/router';
import { inject } from '@angular/core';
import { ProjectWorkspaceStore } from './project-workspace.store';

/**
 * Lazily-loaded projects feature routes. Kept out of the main bundle (loaded via
 * `loadChildren` from app.routes) so the workspace shell + ProjectWorkspaceStore
 * ship in the projects chunk. The `:id` workspace provides one store instance,
 * shared by every tab rendered in its child router-outlet.
 *
 * Structure: the PROJECT is the pure design container (overview / assemblies+3D /
 * work orders). Production tracking (board, progress, quality) lives INSIDE each
 * work order: /projects/:id/orders/:orderId/(board|progress|quality). SHIPPING is
 * owned by the work order itself and lives at /work-orders/:orderId/shipping —
 * the old project-nested shipping URL redirects there.
 */
// Redirect the legacy project-nested shipping URL to the work-order's own page.
const shippingRedirect = (route: ActivatedRouteSnapshot) => {
  const orderId = route.parent?.paramMap.get('orderId') ?? '';
  return inject(Router).createUrlTree(['/work-orders', orderId, 'shipping']);
};
export const PROJECTS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./project-list.component').then((m) => m.ProjectListComponent),
  },
  {
    path: ':id',
    providers: [ProjectWorkspaceStore],
    loadComponent: () => import('./project-workspace.component').then((m) => m.ProjectWorkspaceComponent),
    children: [
      { path: '', redirectTo: 'overview', pathMatch: 'full' },
      { path: 'overview', loadComponent: () => import('./project-overview.component').then((m) => m.ProjectOverviewComponent) },
      { path: 'assemblies', loadComponent: () => import('./project-assemblies.component').then((m) => m.ProjectAssembliesComponent) },
      // Per-unit bill of materials (from the assembly tree) + stock coverage.
      { path: 'materials', loadComponent: () => import('./project-materials.component').then((m) => m.ProjectMaterialsComponent) },
      { path: 'orders', loadComponent: () => import('./project-orders.component').then((m) => m.ProjectOrdersComponent) },
      // Import pipeline monitoring: live upload/extract/convert progress + full history.
      { path: 'monitoring', loadComponent: () => import('./project-monitoring.component').then((m) => m.ProjectMonitoringComponent) },
      // Earned value / progress billing report.
      { path: 'reports', loadComponent: () => import('./project-reports.component').then((m) => m.ProjectReportsComponent) },
      {
        path: 'orders/:orderId',
        loadComponent: () => import('./order-workspace.component').then((m) => m.OrderWorkspaceComponent),
        children: [
          { path: '', redirectTo: 'board', pathMatch: 'full' },
          { path: 'board', loadComponent: () => import('./order-board.component').then((m) => m.OrderBoardComponent) },
          // Per-order 3D viewer: the order's pieces coloured by THIS order's status.
          { path: '3d', loadComponent: () => import('./order-viewer.component').then((m) => m.OrderViewerComponent) },
          { path: 'progress', loadComponent: () => import('./project-progress.component').then((m) => m.ProjectProgressComponent) },
          // Requirement × order quantity, issue-from-stock, fulfillment.
          { path: 'materials', loadComponent: () => import('./order-materials.component').then((m) => m.OrderMaterialsComponent) },
          // Actual vs estimated material/labor/overhead cost.
          { path: 'costs', loadComponent: () => import('./order-costs.component').then((m) => m.OrderCostsComponent) },
          // Labor logged per assembly/stage/worker (feeds costing).
          { path: 'time', loadComponent: () => import('./order-time.component').then((m) => m.OrderTimeComponent) },
          { path: 'quality', loadComponent: () => import('./project-quality.component').then((m) => m.ProjectQualityComponent) },
          // Shipping moved to the work order — redirect any bookmarked URL.
          { path: 'shipping', canActivate: [shippingRedirect], loadComponent: () => import('../work-orders/work-order-shipping.component').then((m) => m.WorkOrderShippingComponent) },
        ],
      },
      // Legacy project-level production URLs → the work-orders list.
      { path: 'progress', redirectTo: 'orders' },
      { path: 'shipping', redirectTo: 'orders' },
      { path: 'quality', redirectTo: 'orders' },
    ],
  },
];
