import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { ProjectsService, ProductionOrder } from '../core/services/projects.service';
import { PermissionsService } from '../core/services/permissions.service';
import { ToastService } from '../core/services/toast.service';
import { ConfirmDialogComponent } from '../shared/components/confirm-dialog/confirm-dialog.component';
import { ProjectWorkspaceStore } from './project-workspace.store';
import { TourLauncherComponent } from '../shared/components/tour-launcher/tour-launcher.component';

interface OrderTab { path: string; label: string; icon: string; }

/**
 * Work-order workspace shell: production tracking lives HERE, not on the project.
 * Hosts the per-order tabs (Board / Progress / Quality / Shipping) in a child
 * router-outlet, under /projects/:id/orders/:orderId. The project stays a pure
 * design container (assemblies + 3D + the list of attached work orders).
 */
@Component({
  selector: 'app-order-workspace',
  standalone: true,
  imports: [CommonModule, RouterModule, MatIconModule, MatMenuModule, MatTooltipModule, MatDialogModule, TourLauncherComponent],
  template: `
    <div class="ows">
      <a class="back" [routerLink]="['/projects', projectId, 'orders']"><mat-icon>arrow_back</mat-icon><span>Work orders</span></a>

      <header class="ohead" data-tour="ow-head">
        <div class="title">
          <mat-icon class="t-ico">receipt_long</mat-icon>
          <h2>{{ order?.number || 'Work order' }}</h2>
          @if (order) { <span class="pill st-{{ order.status }}">{{ statusLabel(order.status) }}</span> }
          <app-tour-launcher class="ow-tour" tourId="order-workspace" [auto]="true" tooltip="Tour this order"></app-tour-launcher>
          @if (order && perms.can('production-orders.delete')) {
            <button class="ow-more" [matMenuTriggerFor]="owMenu" matTooltip="More actions"><mat-icon>more_vert</mat-icon></button>
            <mat-menu #owMenu="matMenu">
              <button mat-menu-item class="danger-item" (click)="deleteOrder()"><mat-icon>delete</mat-icon><span>Delete work order</span></button>
            </mat-menu>
          }
        </div>
        <div class="meta">
          @if (order?.customerName) { <span><mat-icon>business</mat-icon>{{ order?.customerName }}</span> }
          @if (order) { <span><mat-icon>tag</mat-icon>Qty {{ order.quantity }}</span> }
          @if (order?.dueDate) { <span><mat-icon>event</mat-icon>Due {{ order?.dueDate | date:'mediumDate' }}</span> }
        </div>

        <nav class="tab-bar" data-tour="ow-tabs">
          @for (t of tabs; track t.path) {
            <a class="tab" [routerLink]="['/projects', projectId, 'orders', orderId, t.path]" routerLinkActive="active">
              <mat-icon>{{ t.icon }}</mat-icon><span>{{ t.label }}</span>
              @if (t.path === 'quality' && store.openNcr() > 0) { <span class="tab-badge bad">{{ store.openNcr() }}</span> }
            </a>
          }
          <!-- Shipping belongs to the work order itself, not the project route. -->
          <a class="tab out" [routerLink]="['/work-orders', orderId, 'shipping']" title="Shipping (work-order page)">
            <mat-icon>local_shipping</mat-icon><span>Shipping</span><mat-icon class="ext">open_in_new</mat-icon>
          </a>
        </nav>
      </header>

      <div class="ows-body"><router-outlet></router-outlet></div>
    </div>
  `,
  styles: [`
    .back { display: inline-flex; align-items: center; gap: 4px; color: var(--clay-text-muted); font-size: 13px; font-weight: 500; margin-bottom: 10px; text-decoration: none; }
    .back:hover { color: var(--clay-primary); }
    .back mat-icon { font-size: 18px; width: 18px; height: 18px; }

    .ohead { background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius); padding: 14px 18px 0; margin-bottom: 16px; }
    .title { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .ow-tour { margin-left: auto; }
    .ow-more { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border: 1px solid var(--clay-border); background: var(--clay-surface); color: var(--clay-text-secondary); border-radius: var(--clay-radius-sm); cursor: pointer; padding: 0; }
    .ow-more:hover { border-color: var(--clay-primary); color: var(--clay-primary); }
    .ow-more mat-icon { font-size: 18px; width: 18px; height: 18px; }
    ::ng-deep .danger-item { color: var(--danger) !important; }
    ::ng-deep .danger-item mat-icon { color: var(--danger) !important; }
    .t-ico { color: var(--clay-primary); }
    .title h2 { margin: 0; font-size: 19px; font-weight: 700; color: var(--clay-text); letter-spacing: -0.01em; }
    .pill { padding: 2px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; }
    .st-planned { background: var(--badge-draft-bg); color: var(--badge-draft-text); }
    .st-in_progress { background: var(--warning-bg); color: var(--warning-text); }
    .st-completed { background: var(--success-bg); color: var(--success-text); }
    .st-cancelled { background: var(--danger-bg); color: var(--danger-text); }
    .meta { display: flex; gap: 6px 16px; flex-wrap: wrap; margin-top: 7px; }
    .meta span { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--clay-text-secondary); }
    .meta mat-icon { font-size: 15px; width: 15px; height: 15px; color: var(--clay-text-muted); }

    .tab-bar { display: flex; gap: 2px; flex-wrap: wrap; margin-top: 10px; border-top: 1px solid var(--clay-border); padding: 0 2px; }
    .tab { display: inline-flex; align-items: center; gap: 6px; padding: 11px 13px 10px; font-size: 13px; font-weight: 600; color: var(--clay-text-muted); border-bottom: 2.5px solid transparent; white-space: nowrap; transition: color .15s; }
    .tab:hover { color: var(--clay-text); }
    .tab mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .tab.active { color: var(--clay-primary); border-bottom-color: var(--clay-primary); }
    .tab-badge { background: var(--info-bg); color: var(--clay-primary); border-radius: 999px; padding: 1px 7px; font-size: 11px; font-weight: 700; }
    .tab-badge.bad { background: var(--danger-bg); color: var(--danger-text); }
    .tab.out { margin-left: auto; }
    .tab.out .ext { font-size: 13px; width: 13px; height: 13px; opacity: .6; }

    .ows-body { min-height: 160px; }
  `],
})
export class OrderWorkspaceComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private svc = inject(ProjectsService);
  private dialog = inject(MatDialog);
  private toast = inject(ToastService);
  perms = inject(PermissionsService);
  store = inject(ProjectWorkspaceStore);

  projectId = '';
  orderId = '';
  order: ProductionOrder | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  readonly tabs: OrderTab[] = [
    { path: 'board', label: 'Board', icon: 'view_kanban' },
    { path: '3d', label: '3D', icon: 'view_in_ar' },
    { path: 'progress', label: 'Progress', icon: 'insights' },
    { path: 'materials', label: 'Materials', icon: 'category' },
    { path: 'time', label: 'Time & Labor', icon: 'timer' },
    { path: 'costs', label: 'Costs', icon: 'payments' },
    { path: 'quality', label: 'Quality', icon: 'verified' },
  ];

  ngOnInit(): void {
    this.orderId = this.route.snapshot.paramMap.get('orderId') ?? '';
    this.projectId = this.route.parent?.snapshot.paramMap.get('id') ?? '';
    this.loadOrder();
    // Keep the status pill live while stages are stepped on the board below.
    this.refreshTimer = setInterval(() => this.loadOrder(), 15000);
  }
  ngOnDestroy(): void { if (this.refreshTimer) clearInterval(this.refreshTimer); }

  private loadOrder(): void {
    if (!this.orderId) return;
    this.svc.getOrder(this.orderId).subscribe({
      next: (o) => { this.order = o; if (!this.projectId) this.projectId = o.projectId; },
      error: () => {},
    });
  }

  statusLabel(s: string): string {
    return ({ planned: 'Planned', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled' } as Record<string, string>)[s] ?? s;
  }

  /** Permanently delete this work order (its per-assembly WOs, stages, time, NCRs and shipments). */
  deleteOrder(): void {
    if (!this.order) return;
    const o = this.order;
    this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Delete work order?',
        message: `"${o.number}" and all of its per-assembly work orders, stages, logged time, stage history, shipments and NCRs will be permanently deleted. This cannot be undone.`,
        confirmText: 'Delete work order',
      },
    }).afterClosed().subscribe((ok: boolean) => {
      if (!ok) return;
      this.svc.deleteOrder(o.id).subscribe({
        next: () => { this.toast.success('Work order deleted'); this.router.navigate(['/projects', this.projectId, 'orders']); },
        error: (e) => this.toast.error(e?.error?.message || 'Could not delete work order'),
      });
    });
  }
}
