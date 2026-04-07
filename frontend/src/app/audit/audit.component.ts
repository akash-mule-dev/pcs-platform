import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { ApiService } from '../core/services/api.service';

@Component({
  selector: 'app-audit',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatCardModule, MatTableModule,
    MatPaginatorModule, MatFormFieldModule, MatSelectModule,
    MatIconModule, MatChipsModule,
  ],
  template: `
    <h2>Audit Log</h2>

    <div class="filters">
      <mat-form-field appearance="outline">
        <mat-label>Entity Type</mat-label>
        <mat-select [(ngModel)]="entityTypeFilter" (selectionChange)="load()">
          <mat-option value="">All</mat-option>
          <mat-option value="work_order">Work Orders</mat-option>
          <mat-option value="quality_data">Quality Data</mat-option>
          <mat-option value="time_entry">Time Entries</mat-option>
          <mat-option value="user">Users</mat-option>
        </mat-select>
      </mat-form-field>
    </div>

    <mat-card>
      <table mat-table [dataSource]="logs" class="full-width">
        <ng-container matColumnDef="timestamp">
          <th mat-header-cell *matHeaderCellDef>When</th>
          <td mat-cell *matCellDef="let l">{{ l.createdAt | date:'short' }}</td>
        </ng-container>
        <ng-container matColumnDef="user">
          <th mat-header-cell *matHeaderCellDef>User</th>
          <td mat-cell *matCellDef="let l">{{ l.user ? l.user.firstName + ' ' + l.user.lastName : 'System' }}</td>
        </ng-container>
        <ng-container matColumnDef="action">
          <th mat-header-cell *matHeaderCellDef>Action</th>
          <td mat-cell *matCellDef="let l">
            <span class="action-chip" [class]="l.action">{{ l.action }}</span>
          </td>
        </ng-container>
        <ng-container matColumnDef="entityType">
          <th mat-header-cell *matHeaderCellDef>Entity</th>
          <td mat-cell *matCellDef="let l">{{ l.entityType }}</td>
        </ng-container>
        <ng-container matColumnDef="details">
          <th mat-header-cell *matHeaderCellDef>Details</th>
          <td mat-cell *matCellDef="let l" class="details-cell">
            {{ summarize(l) }}
          </td>
        </ng-container>
        <tr mat-header-row *matHeaderRowDef="columns"></tr>
        <tr mat-row *matRowDef="let row; columns: columns"></tr>
      </table>
      @if (logs.length === 0) {
        <div class="empty-state">
          <mat-icon>history</mat-icon>
          <p>No audit records found</p>
        </div>
      }
      <mat-paginator [length]="totalItems" [pageSize]="20" [pageSizeOptions]="[10, 20, 50]"
                     (page)="onPage($event)"></mat-paginator>
    </mat-card>
  `,
  styles: [`
    h2 { margin: 0 0 20px; color: var(--clay-text); }
    .filters { margin-bottom: 16px; }
    .full-width { width: 100%; }
    .action-chip {
      display: inline-block; padding: 2px 8px; border-radius: 8px; font-size: 11px; font-weight: 600;
      text-transform: capitalize;
    }
    .action-chip.create { background: var(--success-bg); color: var(--success-text); }
    .action-chip.update { background: var(--info-bg); color: var(--info-text); }
    .action-chip.delete { background: var(--danger-bg); color: var(--danger-text); }
    .action-chip.status_change { background: var(--warning-bg); color: var(--warning-text); }
    .details-cell { max-width: 300px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 12px; color: var(--clay-text-secondary); }
    .empty-state { text-align: center; padding: 40px; color: var(--clay-text-muted); }
    .empty-state mat-icon { font-size: 48px; width: 48px; height: 48px; opacity: 0.3; }
    .empty-state p { margin-top: 8px; }
  `]
})
export class AuditComponent implements OnInit {
  logs: any[] = [];
  columns = ['timestamp', 'user', 'action', 'entityType', 'details'];
  totalItems = 0;
  page = 1;
  entityTypeFilter = '';

  constructor(private api: ApiService) {}

  ngOnInit(): void { this.load(); }

  load(): void {
    const params: Record<string, any> = { page: this.page, limit: 20 };
    if (this.entityTypeFilter) params['entityType'] = this.entityTypeFilter;
    this.api.get<any>('/audit', params).subscribe({
      next: (res) => {
        this.logs = res.data || [];
        this.totalItems = res.meta?.itemCount || 0;
      },
    });
  }

  onPage(event: PageEvent): void {
    this.page = event.pageIndex + 1;
    this.load();
  }

  summarize(log: any): string {
    if (log.newValues) {
      const keys = Object.keys(log.newValues).slice(0, 3);
      return keys.map(k => `${k}: ${log.newValues[k]}`).join(', ');
    }
    return log.action;
  }
}
