import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NgChartsModule } from 'ng2-charts';
import { ChartConfiguration } from 'chart.js';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';
import { DurationPipe } from '../../shared/pipes/duration.pipe';

@Component({
  selector: 'app-work-order-detail',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterModule, MatCardModule, MatButtonModule,
    MatChipsModule, MatSelectModule, MatFormFieldModule,
    MatProgressBarModule, NgChartsModule, DurationPipe,
  ],
  template: `
    <a routerLink="/work-orders/legacy" class="back-link">← Back to Work Orders</a>

    @if (wo) {
      <div class="wo-header">
        <div>
          <h2>{{ wo.orderNumber }}</h2>
          <p class="subtitle">
            Qty: {{ wo.quantity }} · Due: {{ wo.dueDate ? (wo.dueDate | date:'mediumDate') : 'N/A' }}
          </p>
        </div>
        <div class="header-actions">
          <span class="status-chip" [class]="'status-' + wo.status">{{ wo.status | uppercase }}</span>
          <span class="priority-chip" [class]="'priority-' + wo.priority">{{ wo.priority | uppercase }}</span>
        </div>
      </div>

      <div class="status-actions" *ngIf="wo.status !== 'completed' && wo.status !== 'cancelled'">
        <span>Change status:</span>
        @if (wo.status === 'draft') {
          <button mat-raised-button color="primary" (click)="changeStatus('pending')">→ Pending</button>
        }
        @if (wo.status === 'pending') {
          <button mat-raised-button color="primary" (click)="changeStatus('in_progress')">→ In Progress</button>
        }
        @if (wo.status === 'in_progress') {
          <button mat-raised-button color="accent" (click)="changeStatus('completed')">→ Complete</button>
        }
        <button mat-button color="warn" (click)="changeStatus('cancelled')">Cancel</button>
      </div>

      <h3>Stage Progress</h3>
      <div class="stages-grid">
        @for (wos of stages; track wos.id) {
          <mat-card class="stage-progress-card" [class.stage-completed]="wos.status === 'completed'" [class.stage-active]="wos.status === 'in_progress'">
            <div class="stage-top">
              <div class="stage-name">{{ wos.stage?.name }}</div>
              <mat-form-field appearance="outline" class="stage-status-field">
                <mat-select [ngModel]="wos.status" (selectionChange)="changeStageStatus(wos, $event.value)"
                            [class]="'ss-' + wos.status">
                  <mat-option value="pending">Pending</mat-option>
                  <mat-option value="in_progress">In Progress</mat-option>
                  <mat-option value="completed">Completed</mat-option>
                  <mat-option value="skipped">Skipped</mat-option>
                </mat-select>
              </mat-form-field>
            </div>
            <div class="stage-times">
              <span>Actual: {{ wos.actualTimeSeconds | duration }}</span>
              <span>Target: {{ wos.stage?.targetTimeSeconds | duration }}</span>
            </div>
            <mat-progress-bar [value]="getProgress(wos)" [color]="getProgressColor(wos)"></mat-progress-bar>
            <div class="assign-row">
              <mat-form-field appearance="outline" class="assign-field">
                <mat-label>Assign</mat-label>
                <mat-select [ngModel]="wos.assignedUserId || wos.assignedUser?.id" (selectionChange)="assignUser(wos, $event.value)">
                  <mat-option [value]="null">Unassigned</mat-option>
                  @for (u of users; track u.id) {
                    <mat-option [value]="u.id">{{ u.firstName }} {{ u.lastName }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
            </div>
          </mat-card>
        }
      </div>

      <!-- Phase 7: Estimated vs Actual Time Chart -->
      @if (timeChartData) {
        <mat-card class="time-chart-card">
          <mat-card-header><mat-card-title>Estimated vs Actual Time</mat-card-title></mat-card-header>
          <mat-card-content>
            <canvas baseChart
              [datasets]="timeChartData.datasets"
              [labels]="timeChartData.labels"
              [options]="timeChartOptions"
              type="bar">
            </canvas>
          </mat-card-content>
        </mat-card>
      }
    }
  `,
  styles: [`
    .back-link { color: var(--clay-primary); text-decoration: none; font-size: 13px; }
    .wo-header { display: flex; justify-content: space-between; align-items: flex-start; margin: 16px 0; }
    h2 { margin: 0; color: var(--clay-text); }
    .subtitle { margin: 4px 0 0; color: var(--clay-text-muted); }
    .header-actions { display: flex; gap: 8px; align-items: center; }
    .status-chip, .priority-chip { padding: 4px 12px; border-radius: 16px; font-size: 11px; font-weight: 600; }
    .status-draft { background: var(--badge-draft-bg); color: var(--badge-draft-text); box-shadow: var(--clay-shadow-soft); } .status-pending { background: var(--badge-pending-bg); color: var(--badge-pending-text); box-shadow: var(--clay-shadow-soft); }
    .status-in_progress { background: var(--badge-progress-bg); color: var(--badge-progress-text); box-shadow: var(--clay-shadow-soft); } .status-completed { background: var(--badge-completed-bg); color: var(--badge-completed-text); box-shadow: var(--clay-shadow-soft); }
    .status-cancelled { background: var(--badge-cancelled-bg); color: var(--badge-cancelled-text); box-shadow: var(--clay-shadow-soft); }
    .priority-low { background: var(--success-bg); color: var(--success-text); box-shadow: var(--clay-shadow-soft); } .priority-medium { background: var(--warning-bg); color: var(--warning-text); box-shadow: var(--clay-shadow-soft); }
    .priority-high { background: var(--danger-bg); color: var(--danger-text); box-shadow: var(--clay-shadow-soft); } .priority-urgent { background: var(--danger); color: white; }
    .status-actions { display: flex; gap: 8px; align-items: center; margin-bottom: 24px; padding: 12px; background: var(--clay-surface); border-radius: var(--clay-radius-xs); }
    h3 { color: var(--clay-text); margin: 24px 0 12px; display: flex; align-items: center; gap: 8px; }
    .stages-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
    .stage-progress-card { padding: 16px; }
    .stage-completed { border-left: 4px solid var(--status-completed); }
    .stage-active { border-left: 4px solid var(--status-in-progress); }
    .stage-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .stage-name { font-weight: 500; }
    .stage-status-field { width: 140px; font-size: 11px; }
    ::ng-deep .stage-status-field .mat-mdc-form-field-subscript-wrapper { display: none; }
    ::ng-deep .stage-status-field .mat-mdc-select-value-text { font-size: 11px; text-transform: uppercase; font-weight: 600; }
    .ss-pending { color: var(--status-pending); } .ss-in_progress { color: var(--status-in-progress); }
    .ss-completed { color: var(--status-completed); } .ss-skipped { color: var(--clay-text-muted); }
    .stage-times { display: flex; justify-content: space-between; font-size: 12px; color: var(--clay-text-secondary); margin-bottom: 8px; }
    .assign-row { margin-top: 12px; }
    .assign-field { width: 100%; }
    ::ng-deep .assign-field .mat-mdc-form-field-subscript-wrapper { display: none; }
    .time-chart-card { margin-top: 24px; padding: 20px; }
    .time-chart-card canvas { max-height: 300px; }
  `]
})
export class WorkOrderDetailComponent implements OnInit, OnDestroy {
  wo: any = null;
  stages: any[] = [];
  users: any[] = [];

  // Phase 7: Est vs Actual chart
  timeChartData: ChartConfiguration<'bar'>['data'] | null = null;
  timeChartOptions: ChartConfiguration<'bar'>['options'] = {
    responsive: true,
    plugins: { legend: { position: 'top' } },
    scales: { y: { beginAtZero: true, title: { display: true, text: 'Seconds' } } }
  };

  private socketListeners: (() => void)[] = [];

  constructor(
    private route: ActivatedRoute,
    private api: ApiService,
    private snackBar: MatSnackBar,
    private notificationService: NotificationService,
  ) {}

  ngOnInit(): void {
    this.load();
    this.api.getList<any>('/users').subscribe(list => {
      this.users = list;
    });
    this.listenForUpdates();
  }

  ngOnDestroy(): void {
    this.socketListeners.forEach(off => off());
  }

  private listenForUpdates(): void {
    const socket = this.notificationService.getSocket();
    if (!socket) return;
    const onStageUpdate = () => this.load();
    const onTimeEntryUpdate = () => this.load();
    socket.on('stage-update', onStageUpdate);
    socket.on('time-entry-update', onTimeEntryUpdate);
    this.socketListeners.push(
      () => socket.off('stage-update', onStageUpdate),
      () => socket.off('time-entry-update', onTimeEntryUpdate),
    );
  }

  load(): void {
    const id = this.route.snapshot.paramMap.get('id');
    this.api.get<any>(`/work-orders/${id}`).subscribe(data => {
      this.wo = data;
      this.stages = (data.workOrderStages || data.stages || []).sort(
        (a: any, b: any) => (a.stage?.sequence || 0) - (b.stage?.sequence || 0)
      );
      this.buildTimeChart();
    });
  }

  changeStatus(status: string): void {
    this.api.patch(`/work-orders/${this.wo.id}/status`, { status }).subscribe({
      next: () => {
        this.snackBar.open(`Status changed to ${status}`, 'Close', { duration: 3000 });
        this.load();
      }
    });
  }

  changeStageStatus(wos: any, status: string): void {
    this.api.patch(`/work-orders/${this.wo.id}/stages/${wos.id}/status`, { status }).subscribe({
      next: () => {
        this.snackBar.open(`Stage status changed to ${status}`, 'Close', { duration: 3000 });
        this.load();
      },
      error: () => this.snackBar.open('Failed to update stage status', 'Close', { duration: 3000 }),
    });
  }

  assignUser(wos: any, userId: string): void {
    this.api.post(`/work-orders/${this.wo.id}/assign`, {
      assignments: [{ stageId: wos.stageId || wos.stage?.id, userId }]
    }).subscribe({
      next: () => {
        this.snackBar.open('Operator assigned', 'Close', { duration: 3000 });
        this.load();
      },
      error: () => {}
    });
  }

  getProgress(wos: any): number {
    if (!wos.stage?.targetTimeSeconds) return 0;
    const actual = wos.actualTimeSeconds || 0;
    return Math.min(100, (actual / wos.stage.targetTimeSeconds) * 100);
  }

  getProgressColor(wos: any): string {
    if (!wos.stage?.targetTimeSeconds || !wos.actualTimeSeconds) return 'primary';
    return wos.actualTimeSeconds > wos.stage.targetTimeSeconds ? 'warn' : 'primary';
  }

  private getCssVar(name: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  private hexToRgba(hex: string, alpha: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  private buildTimeChart(): void {
    if (!this.stages.length) return;
    const labels = this.stages.map(s => s.stage?.name || 'Unknown');
    const successColor = this.getCssVar('--success') || '#4caf50';
    const dangerColor = this.getCssVar('--danger') || '#f44336';
    const infoColor = this.getCssVar('--info') || '#2196f3';
    this.timeChartData = {
      labels,
      datasets: [
        {
          label: 'Target Time (s)',
          data: this.stages.map(s => s.stage?.targetTimeSeconds || 0),
          backgroundColor: this.hexToRgba(successColor, 0.4),
          borderColor: successColor,
          borderWidth: 2,
        },
        {
          label: 'Actual Time (s)',
          data: this.stages.map(s => s.actualTimeSeconds || 0),
          backgroundColor: this.stages.map(s =>
            s.actualTimeSeconds && s.stage?.targetTimeSeconds && s.actualTimeSeconds > s.stage.targetTimeSeconds
              ? this.hexToRgba(dangerColor, 0.5) : this.hexToRgba(infoColor, 0.5)
          ),
          borderColor: this.stages.map(s =>
            s.actualTimeSeconds && s.stage?.targetTimeSeconds && s.actualTimeSeconds > s.stage.targetTimeSeconds
              ? dangerColor : infoColor
          ),
          borderWidth: 2,
        },
      ],
    };
  }
}
