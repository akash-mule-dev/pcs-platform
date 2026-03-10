import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { ApiService } from '../../core/services/api.service';
import { WorkOrderFormComponent } from '../work-order-form/work-order-form.component';

@Component({
  selector: 'app-work-order-list',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, MatTableModule, MatPaginatorModule, MatFormFieldModule, MatSelectModule, MatButtonModule, MatIconModule, MatChipsModule],
  template: `
    <div class="page-header">
      <h2>Work Orders</h2>
      <button mat-raised-button color="primary" (click)="openForm()">
        <mat-icon>add</mat-icon> New Work Order
      </button>
    </div>

    <div class="filters">
      <mat-form-field appearance="outline">
        <mat-label>Status</mat-label>
        <mat-select [(ngModel)]="statusFilter" (selectionChange)="load()">
          <mat-option value="">All</mat-option>
          <mat-option value="draft">Draft</mat-option>
          <mat-option value="pending">Pending</mat-option>
          <mat-option value="in_progress">In Progress</mat-option>
          <mat-option value="completed">Completed</mat-option>
          <mat-option value="cancelled">Cancelled</mat-option>
        </mat-select>
      </mat-form-field>
      <mat-form-field appearance="outline">
        <mat-label>Priority</mat-label>
        <mat-select [(ngModel)]="priorityFilter" (selectionChange)="load()">
          <mat-option value="">All</mat-option>
          <mat-option value="low">Low</mat-option>
          <mat-option value="medium">Medium</mat-option>
          <mat-option value="high">High</mat-option>
          <mat-option value="urgent">Urgent</mat-option>
        </mat-select>
      </mat-form-field>
    </div>

    <table mat-table [dataSource]="workOrders" class="full-width mat-elevation-z2">
      <ng-container matColumnDef="orderNumber">
        <th mat-header-cell *matHeaderCellDef>Order #</th>
        <td mat-cell *matCellDef="let wo">
          <a [routerLink]="['/work-orders', wo.id]" class="link">{{ wo.orderNumber }}</a>
        </td>
      </ng-container>
      <ng-container matColumnDef="product">
        <th mat-header-cell *matHeaderCellDef>Product</th>
        <td mat-cell *matCellDef="let wo">{{ wo.product?.name || '—' }}</td>
      </ng-container>
      <ng-container matColumnDef="quantity">
        <th mat-header-cell *matHeaderCellDef>Qty</th>
        <td mat-cell *matCellDef="let wo">{{ wo.quantity }}</td>
      </ng-container>
      <ng-container matColumnDef="status">
        <th mat-header-cell *matHeaderCellDef>Status</th>
        <td mat-cell *matCellDef="let wo">
          <span class="status-chip" [class]="'status-' + wo.status">{{ wo.status | uppercase }}</span>
        </td>
      </ng-container>
      <ng-container matColumnDef="priority">
        <th mat-header-cell *matHeaderCellDef>Priority</th>
        <td mat-cell *matCellDef="let wo">
          <span class="priority-chip" [class]="'priority-' + wo.priority">{{ wo.priority | uppercase }}</span>
        </td>
      </ng-container>
      <ng-container matColumnDef="dueDate">
        <th mat-header-cell *matHeaderCellDef>Due Date</th>
        <td mat-cell *matCellDef="let wo">{{ wo.dueDate ? (wo.dueDate | date:'mediumDate') : '—' }}</td>
      </ng-container>
      <tr mat-header-row *matHeaderRowDef="columns"></tr>
      <tr mat-row *matRowDef="let row; columns: columns;"></tr>
    </table>
  `,
  styles: [`
    .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    h2 { margin: 0; color: var(--clay-text); }
    .filters { display: flex; gap: 16px; margin-bottom: 16px; }
    .full-width { width: 100%; }
    .link { color: var(--clay-primary); text-decoration: none; font-weight: 500; }
    .status-chip, .priority-chip {
      padding: 4px 12px; border-radius: 16px; font-size: 11px; font-weight: 600;
    }
    .status-draft { background: #e8e2d6; color: #7a7062; box-shadow: var(--clay-shadow-soft); }
    .status-pending { background: #f5e6d0; color: #c06820; box-shadow: var(--clay-shadow-soft); }
    .status-in_progress { background: #dce8f3; color: var(--clay-primary); box-shadow: var(--clay-shadow-soft); }
    .status-completed { background: #d8edda; color: #3a7d3e; box-shadow: var(--clay-shadow-soft); }
    .status-cancelled { background: #f2dbd8; color: #a03528; box-shadow: var(--clay-shadow-soft); }
    .priority-low { background: #d8edda; color: #3a7d3e; box-shadow: var(--clay-shadow-soft); }
    .priority-medium { background: #f5e6d0; color: #c06820; box-shadow: var(--clay-shadow-soft); }
    .priority-high { background: #f2dbd8; color: #a03528; box-shadow: var(--clay-shadow-soft); }
    .priority-urgent { background: #f44336; color: white; }
  `]
})
export class WorkOrderListComponent implements OnInit {
  workOrders: any[] = [];
  columns = ['orderNumber', 'product', 'quantity', 'status', 'priority', 'dueDate'];
  statusFilter = '';
  priorityFilter = '';

  constructor(private api: ApiService, private dialog: MatDialog) {}

  ngOnInit(): void { this.load(); }

  load(): void {
    const params: any = {};
    if (this.statusFilter) params.status = this.statusFilter;
    if (this.priorityFilter) params.priority = this.priorityFilter;
    this.api.get<any>('/work-orders', params).subscribe(data => {
      this.workOrders = Array.isArray(data) ? data : data.data || [];
    });
  }

  openForm(): void {
    const ref = this.dialog.open(WorkOrderFormComponent, { width: '600px' });
    ref.afterClosed().subscribe(result => { if (result) this.load(); });
  }
}
