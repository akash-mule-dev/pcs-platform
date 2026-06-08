import { Component, OnInit, OnDestroy, AfterViewInit, ViewChild } from '@angular/core';
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
import { MatDialog } from '@angular/material/dialog';
import { ApiService } from '../../core/services/api.service';
import { PermissionsService } from '../../core/services/permissions.service';
import { WorkOrderFormComponent } from '../work-order-form/work-order-form.component';
import { RealtimeService } from '../../core/services/realtime.service';
import { merge, Subscription } from 'rxjs';

@Component({
  selector: 'app-work-order-list',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, MatTableModule, MatPaginatorModule, MatFormFieldModule, MatSelectModule, MatButtonModule, MatIconModule, MatChipsModule, MatTooltipModule],
  template: `
    <div class="page-shell">
      <!-- Page Header -->
      <div class="page-header">
        <div class="header-left">
          <h1 class="page-title">Work Orders</h1>
          <p class="page-subtitle">Track and manage production orders across the floor</p>
        </div>
        @if (canEdit) {
          <button class="btn-primary" (click)="openForm()">
            <mat-icon>add</mat-icon>
            <span>New Work Order</span>
          </button>
        }
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
      <div class="table-wrap">
        <table mat-table [dataSource]="dataSource" class="sb-table">
          <ng-container matColumnDef="orderNumber">
            <th mat-header-cell *matHeaderCellDef>Order</th>
            <td mat-cell *matCellDef="let wo">
              <div class="cell-entity">
                <div class="entity-icon">
                  <mat-icon>assignment</mat-icon>
                </div>
                <div class="entity-info">
                  <span class="entity-name is-link">{{ wo.orderNumber }}</span>
                  <span class="entity-sub">{{ wo.product?.name || '—' }}</span>
                </div>
              </div>
            </td>
          </ng-container>
          <ng-container matColumnDef="quantity">
            <th mat-header-cell *matHeaderCellDef>Qty</th>
            <td mat-cell *matCellDef="let wo">
              <span class="mono-val">{{ wo.quantity }}</span>
            </td>
          </ng-container>
          <ng-container matColumnDef="status">
            <th mat-header-cell *matHeaderCellDef>Status</th>
            <td mat-cell *matCellDef="let wo">
              <span class="sb-badge" [class]="'badge-' + wo.status">{{ formatStatus(wo.status) }}</span>
            </td>
          </ng-container>
          <ng-container matColumnDef="priority">
            <th mat-header-cell *matHeaderCellDef>Priority</th>
            <td mat-cell *matCellDef="let wo">
              <span class="sb-badge" [class]="'badge-pri-' + wo.priority">{{ wo.priority | uppercase }}</span>
            </td>
          </ng-container>
          <ng-container matColumnDef="dueDate">
            <th mat-header-cell *matHeaderCellDef>Due Date</th>
            <td mat-cell *matCellDef="let wo">
              <span class="mono-val" [class.overdue]="isOverdue(wo)">
                {{ wo.dueDate ? (wo.dueDate | date:'mediumDate') : '—' }}
              </span>
            </td>
          </ng-container>
          <tr mat-header-row *matHeaderRowDef="columns"></tr>
          <tr mat-row *matRowDef="let row; columns: columns;" (click)="goToDetail(row)" class="clickable-row"></tr>
        </table>
      </div>

      <mat-paginator [pageSize]="10" [pageSizeOptions]="[5, 10, 25]" showFirstLastButtons></mat-paginator>
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

    @media (max-width: 768px) {
      .toolbar { flex-direction: column; align-items: stretch; }
      .filter-row { flex-wrap: wrap; }
    }
  `]
})
export class WorkOrderListComponent implements OnInit, OnDestroy, AfterViewInit {
  dataSource = new MatTableDataSource<any>([]);
  columns = ['orderNumber', 'quantity', 'status', 'priority', 'dueDate'];
  statusFilter = '';
  priorityFilter = '';
  @ViewChild(MatPaginator) paginator!: MatPaginator;

  canEdit = false;
  private realtimeSub?: Subscription;

  constructor(private api: ApiService, private dialog: MatDialog, private router: Router, private permissions: PermissionsService, private realtime: RealtimeService) {
    this.canEdit = this.permissions.canManage('work-orders');
  }

  ngOnInit(): void {
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

  ngAfterViewInit(): void { this.dataSource.paginator = this.paginator; }

  load(): void {
    const params: any = {};
    if (this.statusFilter) params.status = this.statusFilter;
    if (this.priorityFilter) params.priority = this.priorityFilter;
    this.api.getList<any>('/work-orders', params).subscribe(list => {
      this.dataSource.data = list;
    });
  }

  formatStatus(status: string): string {
    return (status || '').replace(/_/g, ' ').toUpperCase();
  }

  isOverdue(wo: any): boolean {
    return wo.dueDate && new Date(wo.dueDate) < new Date() && wo.status !== 'completed' && wo.status !== 'cancelled';
  }

  goToDetail(wo: any): void {
    this.router.navigate(['/work-orders', wo.id]);
  }

  openForm(): void {
    const ref = this.dialog.open(WorkOrderFormComponent, { width: '600px' });
    ref.afterClosed().subscribe(result => { if (result) this.load(); });
  }
}
