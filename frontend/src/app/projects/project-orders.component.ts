import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { ProjectsService, ProductionOrder } from '../core/services/projects.service';
import { PermissionsService } from '../core/services/permissions.service';
import { ToastService } from '../core/services/toast.service';
import { ConfirmDialogComponent } from '../shared/components/confirm-dialog/confirm-dialog.component';

/**
 * Work orders (production instances) for a project — the project's Work Orders
 * tab. Lists this project's orders; creating one is the CENTRALISED flow on the
 * Work Orders dashboard, so "New work order" jumps there with this project
 * pre-selected (rather than holding a second, project-local create form).
 */
@Component({
  selector: 'app-project-orders',
  standalone: true,
  imports: [CommonModule, RouterModule, MatIconModule, MatTooltipModule, MatProgressSpinnerModule, MatDialogModule],
  template: `
    <div class="orders">
      <div class="head">
        <p class="hint">Each work order is one production run (e.g. for a customer) — its own process &amp; quantity, tracked independently.</p>
        @if (perms.can('production-orders.create')) {
          <button class="new-btn" (click)="newWorkOrder()">
            <mat-icon>add</mat-icon><span>New work order</span>
          </button>
        }
      </div>

      @if (error) { <p class="err">{{ error }}</p> }

      @if (loading) {
        <div class="center"><mat-spinner diameter="30"></mat-spinner></div>
      } @else if (orders.length === 0) {
        <div class="empty">
          <mat-icon>receipt_long</mat-icon>
          <p>No work orders yet.</p>
          @if (perms.can('production-orders.create')) {
            <button class="new-btn" (click)="newWorkOrder()"><mat-icon>add</mat-icon><span>New work order</span></button>
          }
        </div>
      } @else {
        <div class="grid">
          @for (o of orders; track o.id) {
            <!-- Work orders open the per-order AUDIT dashboard (stage trail + bulk edit). -->
            <div class="card-wrap">
              <a class="card" [routerLink]="['/work-orders', o.id]">
                <div class="card-top">
                  <span class="num">{{ o.number }}</span>
                  <span class="pill st-{{ o.status }}">{{ statusLabel(o.status) }}</span>
                </div>
                <div class="meta">
                  @if (o.customerName) { <span><mat-icon>business</mat-icon>{{ o.customerName }}</span> }
                  <span><mat-icon>tag</mat-icon>Qty {{ o.quantity }}</span>
                </div>
              </a>
              @if (perms.can('production-orders.delete')) {
                <button class="card-del" (click)="deleteOrder(o, $event)" matTooltip="Delete work order" aria-label="Delete work order">
                  <mat-icon>delete</mat-icon>
                </button>
              }
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
    .hint { color: var(--clay-text-secondary); font-size: 13px; margin: 0; flex: 1; min-width: 220px; }
    .new-btn { display: inline-flex; align-items: center; gap: 6px; background: var(--clay-primary); color: #fff; border: none; border-radius: var(--clay-radius-sm); padding: 9px 14px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; }
    .new-btn:hover { filter: brightness(1.08); }
    .new-btn mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .err { color: var(--danger-text); font-size: 13px; }
    .center, .empty { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 48px 0; color: var(--clay-text-muted); }
    .empty mat-icon { font-size: 40px; width: 40px; height: 40px; opacity: .5; }
    .empty .new-btn { opacity: 1; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; }
    .card-wrap { position: relative; }
    .card { display: block; background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius); padding: 14px 16px; text-decoration: none; transition: border-color .15s, transform .1s; }
    .card:hover { border-color: var(--clay-primary); transform: translateY(-1px); }
    .card-del { position: absolute; bottom: 8px; right: 8px; display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border: 1px solid var(--clay-border); background: var(--clay-surface); color: var(--clay-text-muted); border-radius: var(--clay-radius-sm); cursor: pointer; padding: 0; opacity: .55; transition: opacity .15s, color .15s, border-color .15s; }
    .card-wrap:hover .card-del { opacity: 1; }
    .card-del:hover { color: var(--danger-text); border-color: var(--danger); background: var(--danger-bg); }
    .card-del mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .card-top { display: flex; align-items: center; justify-content: space-between; }
    .num { font-size: 15px; font-weight: 700; color: var(--clay-text); }
    .pill { padding: 2px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; }
    .st-planned { background: var(--badge-draft-bg); color: var(--badge-draft-text); }
    .st-in_progress { background: var(--warning-bg); color: var(--warning-text); }
    .st-completed { background: var(--success-bg); color: var(--success-text); }
    .st-cancelled { background: var(--danger-bg); color: var(--danger-text); }
    .meta { display: flex; gap: 14px; margin-top: 8px; flex-wrap: wrap; }
    .meta span { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--clay-text-secondary); }
    .meta mat-icon { font-size: 15px; width: 15px; height: 15px; color: var(--clay-text-muted); }
  `],
})
export class ProjectOrdersComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private svc = inject(ProjectsService);
  private dialog = inject(MatDialog);
  private toast = inject(ToastService);
  perms = inject(PermissionsService);

  projectId = '';
  orders: ProductionOrder[] = [];
  loading = true;
  error: string | null = null;

  ngOnInit(): void {
    this.projectId = this.route.parent?.snapshot.paramMap.get('id') ?? this.route.snapshot.paramMap.get('id') ?? '';
    this.load();
  }

  load(): void {
    this.loading = true;
    this.svc.listOrders(this.projectId).subscribe({
      next: (o) => { this.orders = o; this.loading = false; },
      error: (e) => { this.error = e?.error?.message || 'Could not load work orders.'; this.loading = false; },
    });
  }

  /** Creation is centralised on the Work Orders dashboard — open it there with this project pre-selected. */
  newWorkOrder(): void {
    this.router.navigate(['/work-orders'], { queryParams: { newOrder: 1, project: this.projectId } });
  }

  /** Permanently delete a work order (production run) from the project's list. */
  deleteOrder(o: ProductionOrder, ev: Event): void {
    ev.preventDefault();
    ev.stopPropagation();
    this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Delete work order?',
        message: `"${o.number}" and all of its per-assembly work orders, stages, logged time, stage history, shipments and NCRs will be permanently deleted. This cannot be undone.`,
        confirmText: 'Delete work order',
      },
    }).afterClosed().subscribe((ok: boolean) => {
      if (!ok) return;
      this.svc.deleteOrder(o.id).subscribe({
        next: () => { this.orders = this.orders.filter((x) => x.id !== o.id); this.toast.success('Work order deleted'); },
        error: (e) => { this.error = e?.error?.message || 'Could not delete work order.'; },
      });
    });
  }

  statusLabel(s: string): string {
    return ({ planned: 'Planned', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled' } as Record<string, string>)[s] ?? s;
  }
}
