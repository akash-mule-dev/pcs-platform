import { Component, OnInit, inject } from '@angular/core';
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
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { forkJoin } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { TimeTrackingService } from '../../core/services/time-tracking.service';
import { PermissionsService } from '../../core/services/permissions.service';
import { DurationPipe } from '../../shared/pipes/duration.pipe';
import { ListStateComponent } from '../../shared/components/list-state/list-state.component';
import { TimeEntryDialogComponent, TimeEntryDialogData } from '../time-entry-dialog.component';

@Component({
  selector: 'app-time-tracking-history',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, MatTableModule, MatPaginatorModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule, MatDatepickerModule, MatNativeDateModule, MatIconModule, MatTooltipModule, DurationPipe, ListStateComponent],
  template: `
    <div class="page-header">
      <h2>Time Tracking — History</h2>
      <a mat-button routerLink="/time-tracking">← Back to Console</a>
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

    <app-list-state [loading]="loading" [error]="error"
      [empty]="!loading && !error && entries.length === 0"
      emptyIcon="schedule" emptyTitle="No time entries"
      [emptyText]="'No time entries match the current filters.'" (retry)="load()">
    <div class="table-container">
    <table mat-table [dataSource]="entries" class="full-width mat-elevation-z2 stack-cards">
      <ng-container matColumnDef="operator">
        <th mat-header-cell *matHeaderCellDef>Operator</th>
        <td mat-cell *matCellDef="let e" [attr.data-label]="'Operator'">{{ e.user?.firstName }} {{ e.user?.lastName }}</td>
      </ng-container>
      <ng-container matColumnDef="workOrder">
        <th mat-header-cell *matHeaderCellDef>Work Order</th>
        <td mat-cell *matCellDef="let e" [attr.data-label]="'Work Order'">{{ e.workOrderStage?.workOrder?.orderNumber || '—' }}</td>
      </ng-container>
      <ng-container matColumnDef="stage">
        <th mat-header-cell *matHeaderCellDef>Stage</th>
        <td mat-cell *matCellDef="let e" [attr.data-label]="'Stage'">{{ e.workOrderStage?.stage?.name || '—' }}</td>
      </ng-container>
      <ng-container matColumnDef="start">
        <th mat-header-cell *matHeaderCellDef>Start</th>
        <td mat-cell *matCellDef="let e" [attr.data-label]="'Start'">{{ e.startTime | date:'short' }}</td>
      </ng-container>
      <ng-container matColumnDef="end">
        <th mat-header-cell *matHeaderCellDef>End</th>
        <td mat-cell *matCellDef="let e" [attr.data-label]="'End'">{{ e.endTime ? (e.endTime | date:'short') : 'Active' }}</td>
      </ng-container>
      <ng-container matColumnDef="duration">
        <th mat-header-cell *matHeaderCellDef>Duration</th>
        <td mat-cell *matCellDef="let e" [attr.data-label]="'Duration'">{{ e.durationSeconds | duration }}</td>
      </ng-container>
      <ng-container matColumnDef="type">
        <th mat-header-cell *matHeaderCellDef>Type</th>
        <td mat-cell *matCellDef="let e" [attr.data-label]="'Type'">
          @if (e.isRework) { <span class="tag rework">Rework</span> } @else if (e.isSetup) { <span class="tag setup">Setup</span> } @else { <span class="tag run">Run</span> }
        </td>
      </ng-container>
      <ng-container matColumnDef="target">
        <th mat-header-cell *matHeaderCellDef>Target</th>
        <td mat-cell *matCellDef="let e" [attr.data-label]="'Target'">{{ e.workOrderStage?.stage?.targetTimeSeconds | duration }}</td>
      </ng-container>
      <ng-container matColumnDef="variance">
        <th mat-header-cell *matHeaderCellDef>Variance</th>
        <td mat-cell *matCellDef="let e" [attr.data-label]="'Variance'" [class.over-target]="getVariance(e) > 0" [class.under-target]="getVariance(e) <= 0">
          {{ getVariance(e) > 0 ? '+' : '' }}{{ getVariance(e) | number:'1.0-0' }}%
        </td>
      </ng-container>
      <ng-container matColumnDef="actions">
        <th mat-header-cell *matHeaderCellDef></th>
        <td mat-cell *matCellDef="let e" [attr.data-label]="'Actions'">
          <button class="ic" matTooltip="Edit" (click)="editEntry(e)"><mat-icon>edit</mat-icon></button>
          <button class="ic danger" matTooltip="Delete" (click)="deleteEntry(e)"><mat-icon>delete</mat-icon></button>
        </td>
      </ng-container>
      <tr mat-header-row *matHeaderRowDef="columns; sticky: true"></tr>
      <tr mat-row *matRowDef="let row; columns: columns;"></tr>
    </table>
    </div>
    </app-list-state>

    <mat-paginator [length]="totalEntries" [pageSize]="20" [pageSizeOptions]="[10, 20, 50]"
      (page)="onPage($event)"></mat-paginator>
  `,
  styles: [`
    .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    h2 { margin: 0; color: var(--clay-text); }
    .filters { display: flex; gap: 16px; margin-bottom: 16px; flex-wrap: wrap; }
    .full-width { width: 100%; }
    .table-container { max-height: 70vh; overflow: auto; }
    .over-target { color: var(--danger-text); font-weight: 500; }
    .under-target { color: var(--success-text); font-weight: 500; }
    .tag { padding: 1px 8px; border-radius: var(--clay-radius-xs); font-size: 11px; font-weight: 700; }
    .tag.run { background: var(--info-bg); color: var(--clay-primary); }
    .tag.setup { background: var(--warning-bg); color: var(--warning-text); }
    .tag.rework { background: var(--danger-bg); color: var(--danger-text); }
    .ic { background: none; border: none; cursor: pointer; color: var(--clay-text-muted); padding: 2px; border-radius: var(--clay-radius-xs); }
    .ic:hover { color: var(--clay-primary); } .ic.danger:hover { color: var(--danger-text); }
    .ic mat-icon { font-size: 18px; width: 18px; height: 18px; }
    ::ng-deep .mat-mdc-header-row { background: var(--clay-surface, #f5f0e8) !important; }
    @media (max-width: 760px) {
      .table-container { max-height: none; overflow: visible; }
    }
  `]
})
export class TimeTrackingHistoryComponent implements OnInit {
  private api = inject(ApiService);
  private tt = inject(TimeTrackingService);
  private perms = inject(PermissionsService);
  private dialog = inject(MatDialog);
  private snack = inject(MatSnackBar);

  entries: any[] = [];
  users: any[] = [];
  loading = true;
  error: string | null = null;
  totalEntries = 0;
  page = 1;
  filterUser = '';
  filterFrom: Date | null = null;
  filterTo: Date | null = null;

  get canManage(): boolean { return this.perms.can('time-tracking.manage'); }
  get columns(): string[] {
    const base = ['operator', 'workOrder', 'stage', 'start', 'end', 'duration', 'type', 'target', 'variance'];
    return this.canManage ? [...base, 'actions'] : base;
  }

  ngOnInit(): void {
    this.load();
    this.api.getList<any>('/users').subscribe(list => { this.users = list; });
  }

  load(): void {
    this.loading = true;
    this.error = null;
    const params: any = { page: this.page, limit: 20 };
    if (this.filterUser) params.userId = this.filterUser;
    if (this.filterFrom) params.startDate = this.filterFrom.toISOString();
    if (this.filterTo) params.endDate = this.filterTo.toISOString();
    this.tt.history(params).subscribe({
      next: (data: any) => {
        if (Array.isArray(data)) { this.entries = data; this.totalEntries = data.length; }
        else { this.entries = data.data || []; this.totalEntries = data.total || data.meta?.itemCount || this.entries.length; }
        this.loading = false;
      },
      error: () => { this.loading = false; this.error = 'Could not load time entries — try again.'; },
    });
  }

  onPage(event: PageEvent): void { this.page = event.pageIndex + 1; this.load(); }

  getVariance(entry: any): number {
    const target = entry.workOrderStage?.stage?.targetTimeSeconds;
    const actual = entry.durationSeconds;
    if (!target || !actual) return 0;
    return ((actual - target) / target) * 100;
  }

  /** Edit a history row: load the WO's stages + the full entry row, then reuse the shared dialog. */
  editEntry(e: any): void {
    const woId = e.workOrderStage?.workOrder?.id;
    if (!woId) { this.snack.open('This entry is not linked to a work order.', 'Dismiss', { duration: 4000 }); return; }
    forkJoin({
      summary: this.tt.workOrderSummary(woId),
      users: this.tt.listUsers(),
      stations: this.tt.listStations(),
    }).subscribe({
      next: ({ summary, users, stations }) => {
        const row = summary.entries.find((r) => r.id === e.id);
        if (!row) { this.snack.open('Could not load this entry.', 'Dismiss', { duration: 4000 }); return; }
        const data: TimeEntryDialogData = {
          mode: 'edit',
          workOrderId: woId,
          workOrderLabel: `${summary.mark} · ${summary.orderNumber}`,
          stages: summary.stages.map((s) => ({ workOrderStageId: s.workOrderStageId, name: s.name, sequence: s.sequence })),
          users, stations, entry: row,
        };
        this.dialog.open(TimeEntryDialogComponent, { data, width: '640px', maxWidth: '95vw' })
          .afterClosed().subscribe((r) => { if (r === 'saved') { this.snack.open('Entry updated', 'OK', { duration: 2500 }); this.load(); } });
      },
      error: (err) => { this.snack.open(err?.error?.message || 'Could not open the editor.', 'Dismiss', { duration: 4000 }); },
    });
  }

  deleteEntry(e: any): void {
    if (!confirm(`Delete this time entry for ${e.user?.firstName || ''} ${e.user?.lastName || ''}?`.trim())) return;
    this.tt.remove(e.id).subscribe({
      next: () => { this.snack.open('Entry deleted', 'OK', { duration: 2500 }); this.load(); },
      error: (err) => { this.snack.open(err?.error?.message || 'Could not delete entry', 'Dismiss', { duration: 4000 }); },
    });
  }
}
