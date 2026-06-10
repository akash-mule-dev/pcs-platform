import { Routes } from '@angular/router';
import { ProjectWorkspaceStore } from './project-workspace.store';

/**
 * Lazily-loaded projects feature routes. Kept out of the main bundle (loaded via
 * `loadChildren` from app.routes) so the workspace shell + ProjectWorkspaceStore
 * ship in the projects chunk. The `:id` workspace provides one store instance,
 * shared by every tab rendered in its child router-outlet.
 *
 * Structure: the PROJECT is the pure design container (overview / assemblies+3D /
 * work orders). Production tracking (board, progress, quality, shipping) lives
 * INSIDE each work order: /projects/:id/orders/:orderId/(board|progress|quality|shipping).
 */
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
      { path: 'orders', loadComponent: () => import('./project-orders.component').then((m) => m.ProjectOrdersComponent) },
      {
        path: 'orders/:orderId',
        loadComponent: () => import('./order-workspace.component').then((m) => m.OrderWorkspaceComponent),
        children: [
          { path: '', redirectTo: 'board', pathMatch: 'full' },
          { path: 'board', loadComponent: () => import('./order-board.component').then((m) => m.OrderBoardComponent) },
          { path: 'progress', loadComponent: () => import('./project-progress.component').then((m) => m.ProjectProgressComponent) },
          { path: 'quality', loadComponent: () => import('./project-quality.component').then((m) => m.ProjectQualityComponent) },
          { path: 'shipping', loadComponent: () => import('./project-shipping.component').then((m) => m.ProjectShippingComponent) },
        ],
      },
      // Legacy project-level production URLs → the work-orders list.
      { path: 'progress', redirectTo: 'orders' },
      { path: 'shipping', redirectTo: 'orders' },
      { path: 'quality', redirectTo: 'orders' },
    ],
  },
];
