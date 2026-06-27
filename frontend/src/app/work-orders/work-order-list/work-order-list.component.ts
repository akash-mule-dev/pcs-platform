import { Component, OnInit, OnDestroy, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatPaginatorModule, MatPaginator } from '@angular/material/paginator';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { ApiService } from '../../core/services/api.service';
import { RealtimeService } from '../../core/services/realtime.service';
import { PermissionsService } from '../../core/services/permissions.service';
import { ToastService } from '../../core/services/toast.service';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog/confirm-dialog.component';
import { ListStateComponent } from '../../shared/components/list-state/list-state.component';
import { merge, Subscription } from 'rxjs';

@Component({
  selector: 'app-work-order-list',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, MatTableModule, MatPaginatorModule, MatFormFieldModule, MatSelectModule, MatButtonModule, MatIconModule, MatChipsModule, MatTooltipModule, MatMenuModule, MatDialogModule, ListStateComponent],
  template: `
    <div class="page-shell">
      <!-- Page Header -->
      <div class="page-header">
        <div class="header-left">
          <h1 class="page-title">Work Orders</h1>
          <p class="page-subtitle">Track and manage production orders across the floor</p>
        </div>
      </div>

      <!-- Filters -->
      <div class="toolbar">
        <div class="filter-row">
          <div class="filter-group">
            <label class="filter-label">Status</label>
            <select class="filter-select" [(ngModel)]="statusFilter" (change)="load()">
              <option value="">All</option>
              <option value="draft">Draft</option>
              <option value="pending">Pending</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          <div class="filter-group">
            <label class="filter-label">Priority</label>
            <select class="filter-select" [(ngModel)]="priorityFilter" (change)="load()">
              <option value="">All</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
        </div>
        <div class="meta-count">
          <span class="count-num">{{ dataSource.filteredData.length }}</span> orders
        </div>
      </div>

      <!-- Table -->
      <app-list-state
        [loading]="loading"
        [error]="error"
        [empty]="!loading && !error && dataSource.data.length === 0"
        loadingText="Loading work orders…"
        emptyIcon="assignment"
        emptyTitle="No work orders"
        [emptyText]="statusFilter || priorityFilter ? 'No work orders match the current filters.' : 'Release a production order to generate work orders.'"
        (retry)="load()">
        <div class="table-wrap">
          <table mat-table [dataSource]="dataSource" class="sb-table stack-cards">
            <ng-container matColumnDef="orderNumber">
              <th mat-header-cell *matHeaderCellDef>Order</th>
              <td mat-cell *matCellDef="let wo" [attr.data-label]="'Order'">
                <div class="cell-entity">
                  <div class="entity-icon">
                    <mat-icon>assignment</mat-icon>
                  </div>
                  <div class="entity-info">
                    <span class="entity-name is-link">{{ wo.orderNumber }}</span>
                    <span class="entity-sub">{{ wo.process?.name || '—' }}</span>
                  </div>
                </div>
              </td>
            </ng-container>
            <ng-container matColumnDef="quantity">
              <th mat-header-cell *matHeaderCellDef>Qty</th>
              <td mat-cell *matCellDef="let wo" [attr.data-label]="'Qty'">
                <span class="mono-val">{{ wo.quantity }}</span>
              </td>
            </ng-container>
            <ng-container matColumnDef="status">
              <th mat-header-cell *matHeaderCellDef>Status</th>
              <td mat-cell *matCellDef="let wo" [attr.data-label]="'Status'">
                <span class="sb-badge" [class]="'badge-' + wo.status">{{ formatStatus(wo.status) }}</span>
              </td>
            </ng-container>
            <ng-container matColumnDef="priority">
              <th mat-header-cell *matHeaderCellDef>Priority</th>
              <td mat-cell *matCellDef="let wo" [attr.data-label]="'Priority'">
                <span class="sb-badge" [class]="'badge-pri-' + wo.priority">{{ wo.priority | uppercase }}</span>
              </td>
            </ng-container>
            <ng-container matColumnDef="dueDate">
              <th mat-header-cell *matHeaderCellDef>Due Date</th>
              <td mat-cell *matCellDef="let wo" [attr.data-label]="'Due date'">
                <span class="mono-val" [class.overdue]="isOverdue(wo)">
                  {{ wo.dueDate ? (wo.dueDate | date:'mediumDate') : '—' }}
                </span>
              </td>
            </ng-container>
            <ng-container matColumnDef="actions">
              <th mat-header-cell *matHeaderCellDef aria-label="Actions"></th>
              <td mat-cell *matCellDef="let wo" [attr.data-label]="'Actions'" (click)="$event.stopPropagation()">
                <button mat-icon-button [matMenuTriggerFor]="rowMenu" aria-label="Work order actions"
                        matTooltip="Work order actions">
                  <mat-icon>more_vert</mat-icon>
                </button>
                <mat-menu #rowMenu="matMenu">
                  <button mat-menu-item class="danger-item" (click)="deleteWorkOrder(wo)">
                    <mat-icon>delete</mat-icon><span>Delete work order</span>
                  </button>
                </mat-menu>
              </td>
            </ng-container>
            <tr mat-header-row *matHeaderRowDef="columns"></tr>
            <tr mat-row *matRowDef="let row; columns: columns;" (click)="goToDetail(row)"
                (keydown.enter)="goToDetail(row)" tabindex="0" role="button"
                [attr.aria-label]="'Open work order ' + row.orderNumber" class="clickable-row"></tr>
          </table>
        </div>

        <mat-paginator [pageSize]="10" [pageSizeOptions]="[5, 10, 25]" showFirstLastButtons></mat-paginator>
      </app-list-state>
    </div>
  `,
  styles: [`
    .page-shell { max-width: 1200px; }
    /* Page scaffold, table theme (.table-wrap/.sb-table), .cell-entity, badges
       (.sb-badge/.badge-*), filter controls (.filter-*), .mono-val & .clickable-row
       all come from global styles.scss. */

    /* This page bottom-aligns its filter toolbar (vs. the global centered default). */
    .toolbar { align-items: flex-end; }
    .mono-val.overdue { color: var(--danger); }
    ::ng-deep .danger-item, ::ng-deep .danger-item mat-icon { color: var(--danger-text); }

    @media (max-width: 768px) {
      .toolbar { flex-direction: column; align-items: stretch; }
      .filter-row { flex-wrap: wrap; }
    }
  `]
})
export class WorkOrderListComponent implements OnInit, OnDestroy {
  dataSource = new MatTableDataSource<any>([]);
  columns = ['orderNumber', 'quantity', 'status', 'priority', 'dueDate'];
  statusFilter = '';
  priorityFilter = '';
  loading = true;
  error: string | null = null;

  // The table (and its paginator) is conditionally rendered inside <app-list-state>,
  // so bind the paginator via a setter — it arrives only once data is shown.
  @ViewChild(MatPaginator) set paginator(p: MatPaginator | undefined) {
    if (p) this.dataSource.paginator = p;
  }

  private realtimeSub?: Subscription;

  constructor(
    private api: ApiService,
    private router: Router,
    private realtime: RealtimeService,
    private dialog: MatDialog,
    private toast: ToastService,
    public perms: PermissionsService,
  ) {}

  ngOnInit(): void {
    // Only privileged users (admin-only by default) get the delete action column.
    if (this.perms.can('work-orders.delete')) this.columns = [...this.columns, 'actions'];
    this.load();
    // Live-update the list when work orders or their stages change on any client.
    this.realtimeSub = merge(
      this.realtime.on('work-order-update'),
      this.realtime.on('stage-update'),
    ).subscribe(() => this.load());
  }

  ngOnDestroy(): void {
    this.realtimeSub?.unsubscribe();
  }

  load(): void {
    const params: any = {};
    if (this.statusFilter) params.status = this.statusFilter;
    if (this.priorityFilter) params.priority = this.priorityFilter;
    this.loading = true;
    this.error = null;
    this.api.getList<any>('/work-orders', params).subscribe({
      next: (list) => { this.dataSource.data = list; this.loading = false; },
      error: () => { this.loading = false; this.error = 'Could not load work orders. Check your connection and try again.'; },
    });
  }

  formatStatus(status: string): string {
    return (status || '').replace(/_/g, ' ').toUpperCase();
  }

  isOverdue(wo: any): boolean {
    return wo.dueDate && new Date(wo.dueDate) < new Date() && wo.status !== 'completed' && wo.status !== 'cancelled';
  }

  goToDetail(wo: any): void {
    // Legacy detail page — /work-orders/:id is the per-order audit dashboard.
    this.router.navigate(['/work-orders/legacy', wo.id]);
  }

  /** Permanently delete a work order (admin-only). Hard delete — there is no Trash for work orders. */
  deleteWorkOrder(wo: any): void {
    this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Delete work order?',
        message: `"${wo.orderNumber}" and all of its stages, time logs and stage history will be permanently deleted. This cannot be undone.`,
        confirmText: 'Delete work order',
      },
    }).afterClosed().subscribe((ok: boolean) => {
      if (!ok) return;
      this.api.delete(`/work-orders/${wo.id}`).subscribe({
        next: () => {
          this.toast.success(`Work order ${wo.orderNumber} deleted`);
          this.dataSource.data = this.dataSource.data.filter((x) => x.id !== wo.id);
        },
        error: (e) => this.toast.error(e?.error?.message || 'Could not delete work order'),
      });
    });
  }
}
