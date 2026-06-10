import { Routes } from '@angular/router';
import { ProjectWorkspaceStore } from './project-workspace.store';

/**
 * Lazily-loaded projects feature routes. Kept out of the main bundle (loaded via
 * `loadChildren` from app.routes) so the workspace shell + ProjectWorkspaceStore
 * ship in the projects chunk. The `:id` workspace provides one store instance,
 * shared by every tab rendered in its child router-outlet.
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
      { path: 'progress', loadComponent: () => import('./project-progress.component').then((m) => m.ProjectProgressComponent) },
      { path: 'shipping', loadComponent: () => import('./project-shipping.component').then((m) => m.ProjectShippingComponent) },
      { path: 'quality', loadComponent: () => import('./project-quality.component').then((m) => m.ProjectQualityComponent) },
    ],
  },
];
