import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatIconModule } from '@angular/material/icon';
import { ApiService } from '../../core/services/api.service';
import { DurationPipe } from '../../shared/pipes/duration.pipe';

@Component({
  selector: 'app-time-tracking-history',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, MatTableModule, MatPaginatorModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule, MatDatepickerModule, MatNativeDateModule, MatIconModule, DurationPipe],
  template: `
    <div class="page-header">
      <h2>Time Tracking — History</h2>
      <a mat-button routerLink="/time-tracking">← Back to Live</a>
    </div>

    <div class="filters">
      <mat-form-field appearance="outline">
        <mat-label>User</mat-label>
        <mat-select [(ngModel)]="filterUser" (selectionChange)="load()">
          <mat-option value="">All</mat-option>
          @for (u of users; track u.id) {
            <mat-option [value]="u.id">{{ u.firstName }} {{ u.lastName }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
      <mat-form-field appearance="outline">
        <mat-label>From</mat-label>
        <input matInput [matDatepicker]="fromPicker" [(ngModel)]="filterFrom" (dateChange)="load()">
        <mat-datepicker-toggle matSuffix [for]="fromPicker"></mat-datepicker-toggle>
        <mat-datepicker #fromPicker></mat-datepicker>
      </mat-form-field>
      <mat-form-field appearance="outline">
        <mat-label>To</mat-label>
        <input matInput [matDatepicker]="toPicker" [(ngModel)]="filterTo" (dateChange)="load()">
        <mat-datepicker-toggle matSuffix [for]="toPicker"></mat-datepicker-toggle>
        <mat-datepicker #toPicker></mat-datepicker>
      </mat-form-field>
    </div>

    <div class="table-container">
    <table mat-table [dataSource]="entries" class="full-width mat-elevation-z2">
      <ng-container matColumnDef="operator">
        <th mat-header-cell *matHeaderCellDef>Operator</th>
        <td mat-cell *matCellDef="let e">{{ e.user?.firstName }} {{ e.user?.lastName }}</td>
      </ng-container>
      <ng-container matColumnDef="workOrder">
        <th mat-header-cell *matHeaderCellDef>Work Order</th>
        <td mat-cell *matCellDef="let e">{{ e.workOrderStage?.workOrder?.orderNumber || '—' }}</td>
      </ng-container>
      <ng-container matColumnDef="stage">
        <th mat-header-cell *matHeaderCellDef>Stage</th>
        <td mat-cell *matCellDef="let e">{{ e.workOrderStage?.stage?.name || '—' }}</td>
      </ng-container>
      <ng-container matColumnDef="start">
        <th mat-header-cell *matHeaderCellDef>Start</th>
        <td mat-cell *matCellDef="let e">{{ e.startTime | date:'short' }}</td>
      </ng-container>
      <ng-container matColumnDef="end">
        <th mat-header-cell *matHeaderCellDef>End</th>
        <td mat-cell *matCellDef="let e">{{ e.endTime ? (e.endTime | date:'short') : 'Active' }}</td>
      </ng-container>
      <ng-container matColumnDef="duration">
        <th mat-header-cell *matHeaderCellDef>Duration</th>
        <td mat-cell *matCellDef="let e">{{ e.durationSeconds | duration }}</td>
      </ng-container>
      <ng-container matColumnDef="target">
        <th mat-header-cell *matHeaderCellDef>Target</th>
        <td mat-cell *matCellDef="let e">{{ e.workOrderStage?.stage?.targetTimeSeconds | duration }}</td>
      </ng-container>
      <ng-container matColumnDef="variance">
        <th mat-header-cell *matHeaderCellDef>Variance</th>
        <td mat-cell *matCellDef="let e" [class.over-target]="getVariance(e) > 0" [class.under-target]="getVariance(e) <= 0">
          {{ getVariance(e) > 0 ? '+' : '' }}{{ getVariance(e) | number:'1.0-0' }}%
        </td>
      </ng-container>
      <ng-container matColumnDef="method">
        <th mat-header-cell *matHeaderCellDef>Method</th>
        <td mat-cell *matCellDef="let e">{{ e.inputMethod || '—' }}</td>
      </ng-container>
      <tr mat-header-row *matHeaderRowDef="columns; sticky: true"></tr>
      <tr mat-row *matRowDef="let row; columns: columns;"></tr>
    </table>
    </div>

    <mat-paginator [length]="totalEntries" [pageSize]="20" [pageSizeOptions]="[10, 20, 50]"
      (page)="onPage($event)"></mat-paginator>
  `,
  styles: [`
    .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    h2 { margin: 0; color: var(--clay-text); }
    .filters { display: flex; gap: 16px; margin-bottom: 16px; flex-wrap: wrap; }
    .full-width { width: 100%; }
    .table-container { max-height: 70vh; overflow: auto; }
    .over-target { color: #c62828; font-weight: 500; }
    .under-target { color: #2e7d32; font-weight: 500; }
    ::ng-deep .mat-mdc-header-row { background: var(--clay-surface, #f5f0e8) !important; }
  `]
})
export class TimeTrackingHistoryComponent implements OnInit {
  entries: any[] = [];
  users: any[] = [];
  columns = ['operator', 'workOrder', 'stage', 'start', 'end', 'duration', 'target', 'variance', 'method'];
  totalEntries = 0;
  page = 1;
  filterUser = '';
  filterFrom: Date | null = null;
  filterTo: Date | null = null;

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.load();
    this.api.get<any>('/users').subscribe(data => {
      this.users = Array.isArray(data) ? data : data.data || [];
    });
  }

  load(): void {
    const params: any = { page: this.page, limit: 20 };
    if (this.filterUser) params.userId = this.filterUser;
    if (this.filterFrom) params.startDate = this.filterFrom.toISOString();
    if (this.filterTo) params.endDate = this.filterTo.toISOString();
    this.api.get<any>('/time-tracking/history', params).subscribe(data => {
      if (Array.isArray(data)) {
        this.entries = data;
        this.totalEntries = data.length;
      } else {
        this.entries = data.data || [];
        this.totalEntries = data.total || this.entries.length;
      }
    });
  }

  onPage(event: PageEvent): void {
    this.page = event.pageIndex + 1;
    this.load();
  }

  getVariance(entry: any): number {
    const target = entry.workOrderStage?.stage?.targetTimeSeconds;
    const actual = entry.durationSeconds;
    if (!target || !actual) return 0;
    return ((actual - target) / target) * 100;
  }
}
