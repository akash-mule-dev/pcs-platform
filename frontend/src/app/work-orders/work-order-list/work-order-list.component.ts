import { Component, OnInit, AfterViewInit, ViewChild } from '@angular/core';
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
import { AuthService } from '../../core/services/auth.service';
import { canManage } from '../../core/permissions';
import { WorkOrderFormComponent } from '../work-order-form/work-order-form.component';

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
              <div class="cell-order">
                <div class="order-icon">
                  <mat-icon>assignment</mat-icon>
                </div>
                <div class="order-info">
                  <span class="order-num">{{ wo.orderNumber }}</span>
                  <span class="order-product">{{ wo.product?.name || '—' }}</span>
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

    .page-header {
      display: flex; justify-content: space-between; align-items: flex-start;
      margin-bottom: 24px;
    }
    .page-title {
      margin: 0; font-size: 24px; font-weight: 700; color: var(--clay-text);
      letter-spacing: -0.02em;
    }
    .page-subtitle { margin: 4px 0 0; font-size: 13px; color: var(--clay-text-muted); }

    .btn-primary {
      display: inline-flex; align-items: center; gap: 6px;
      background: var(--clay-primary); color: #fff;
      border: none; border-radius: var(--clay-radius-sm);
      padding: 10px 20px; font-size: 13px; font-weight: 600;
      cursor: pointer; transition: all 0.2s; font-family: inherit;
    }
    .btn-primary:hover { filter: brightness(1.1); transform: translateY(-1px); }
    .btn-primary mat-icon { font-size: 18px; width: 18px; height: 18px; }

    /* Toolbar & Filters */
    .toolbar {
      display: flex; align-items: flex-end; justify-content: space-between;
      margin-bottom: 16px; gap: 16px;
    }
    .filter-row { display: flex; gap: 12px; }
    .filter-group { display: flex; flex-direction: column; gap: 4px; }
    .filter-label {
      font-size: 10px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.06em; color: var(--clay-text-muted);
      font-family: 'Space Grotesk', sans-serif;
    }
    .filter-select {
      background: var(--clay-surface); border: 1px solid var(--clay-border);
      border-radius: var(--clay-radius-xs); padding: 7px 12px;
      font-size: 13px; color: var(--clay-text); font-family: inherit;
      cursor: pointer; min-width: 140px;
      transition: border-color 0.2s;
      -webkit-appearance: none; appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%238b90a0' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10z'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 10px center;
      padding-right: 30px;
    }
    .filter-select:focus { border-color: var(--clay-primary); outline: none; }
    .filter-select option { background: var(--clay-surface); color: var(--clay-text); }

    .meta-count { font-size: 12px; color: var(--clay-text-muted); font-family: 'Space Grotesk', sans-serif; }
    .count-num { font-weight: 600; color: var(--clay-text-secondary); }

    /* Table */
    .table-wrap {
      background: var(--clay-surface); border-radius: var(--clay-radius);
      border: 1px solid var(--clay-border); overflow: hidden;
    }
    .sb-table { width: 100%; }
    ::ng-deep .sb-table .mat-mdc-header-row { background: var(--clay-bg-warm) !important; height: 44px; }
    ::ng-deep .sb-table .mat-mdc-header-cell {
      color: var(--clay-text-muted) !important; font-weight: 600 !important;
      font-size: 11px !important; text-transform: uppercase;
      letter-spacing: 0.06em; border-bottom: 1px solid var(--clay-border) !important;
      font-family: 'Space Grotesk', sans-serif !important;
    }
    ::ng-deep .sb-table .mat-mdc-row {
      border-bottom: 1px solid var(--clay-border) !important;
      transition: background 0.15s; height: 64px;
    }
    ::ng-deep .sb-table .mat-mdc-row:hover { background: var(--clay-surface-hover) !important; }
    ::ng-deep .sb-table .mat-mdc-cell {
      color: var(--clay-text) !important; font-size: 13px; border-bottom: none !important;
    }

    /* Order cell */
    .cell-order { display: flex; align-items: center; gap: 12px; }
    .order-icon {
      width: 40px; height: 40px; border-radius: var(--clay-radius-xs);
      background: var(--kpi-blue-bg); color: var(--kpi-blue-fg);
      display: flex; align-items: center; justify-content: center; flex-shrink: 0;
    }
    .order-icon mat-icon { font-size: 20px; width: 20px; height: 20px; }
    .order-info { display: flex; flex-direction: column; gap: 2px; }
    .order-num {
      font-weight: 600; font-size: 13px; color: var(--clay-primary);
      font-family: 'Space Grotesk', sans-serif;
    }
    .order-product { font-size: 11px; color: var(--clay-text-muted); }

    .mono-val { font-family: 'Space Grotesk', monospace; font-weight: 500; }
    .mono-val.overdue { color: var(--danger); }

    /* Badges */
    .sb-badge {
      display: inline-block; padding: 3px 10px; border-radius: 4px;
      font-size: 10px; font-weight: 700; letter-spacing: 0.04em;
      text-transform: uppercase;
      font-family: 'Space Grotesk', sans-serif;
    }
    .badge-draft { background: var(--badge-draft-bg); color: var(--badge-draft-text); }
    .badge-pending { background: var(--badge-pending-bg); color: var(--badge-pending-text); }
    .badge-in_progress { background: var(--badge-progress-bg); color: var(--badge-progress-text); }
    .badge-completed { background: var(--badge-completed-bg); color: var(--badge-completed-text); }
    .badge-cancelled { background: var(--badge-cancelled-bg); color: var(--badge-cancelled-text); }
    .badge-pri-low { background: var(--success-bg); color: var(--success-text); }
    .badge-pri-medium { background: var(--warning-bg); color: var(--warning-text); }
    .badge-pri-high { background: var(--danger-bg); color: var(--danger-text); }
    .badge-pri-urgent { background: var(--danger); color: #fff; }

    .clickable-row { cursor: pointer; }

    @media (max-width: 768px) {
      .toolbar { flex-direction: column; align-items: stretch; }
      .filter-row { flex-wrap: wrap; }
    }
  `]
})
export class WorkOrderListComponent implements OnInit, AfterViewInit {
  dataSource = new MatTableDataSource<any>([]);
  columns = ['orderNumber', 'quantity', 'status', 'priority', 'dueDate'];
  statusFilter = '';
  priorityFilter = '';
  @ViewChild(MatPaginator) paginator!: MatPaginator;

  canEdit = false;

  constructor(private api: ApiService, private dialog: MatDialog, private router: Router, private auth: AuthService) {
    this.canEdit = canManage('work-orders', this.auth.userRole);
  }

  ngOnInit(): void { this.load(); }

  ngAfterViewInit(): void { this.dataSource.paginator = this.paginator; }

  load(): void {
    const params: any = {};
    if (this.statusFilter) params.status = this.statusFilter;
    if (this.priorityFilter) params.priority = this.priorityFilter;
    this.api.get<any>('/work-orders', params).subscribe(data => {
      this.dataSource.data = Array.isArray(data) ? data : data.data || [];
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
