import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule } from '@angular/material/table';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { NgChartsModule } from 'ng2-charts';
import { Chart, registerables, ChartConfiguration } from 'chart.js';
import { ApiService } from '../core/services/api.service';
import { DurationPipe } from '../shared/pipes/duration.pipe';
import { interval, Subscription } from 'rxjs';

Chart.register(...registerables);

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, MatCardModule, MatTableModule, MatIconModule, MatProgressSpinnerModule, NgChartsModule, DurationPipe],
  template: `
    <h2>Dashboard</h2>

    <div class="kpi-row">
      <mat-card class="kpi-card">
        <div class="kpi-icon-wrap blue">
          <mat-icon class="kpi-icon">assignment</mat-icon>
        </div>
        <div class="kpi-info">
          <div class="kpi-value">{{ summary?.totalWorkOrders ?? '—' }}</div>
          <div class="kpi-label">Total Work Orders</div>
        </div>
      </mat-card>
      <mat-card class="kpi-card">
        <div class="kpi-icon-wrap green">
          <mat-icon class="kpi-icon">people</mat-icon>
        </div>
        <div class="kpi-info">
          <div class="kpi-value">{{ summary?.activeOperators ?? '—' }}</div>
          <div class="kpi-label">Active Operators</div>
        </div>
      </mat-card>
      <mat-card class="kpi-card">
        <div class="kpi-icon-wrap orange">
          <mat-icon class="kpi-icon">check_circle</mat-icon>
        </div>
        <div class="kpi-info">
          <div class="kpi-value">{{ summary?.todayCompletedStages ?? '—' }}</div>
          <div class="kpi-label">Completed Today</div>
        </div>
      </mat-card>
      <mat-card class="kpi-card">
        <div class="kpi-icon-wrap purple">
          <mat-icon class="kpi-icon">speed</mat-icon>
        </div>
        <div class="kpi-info">
          <div class="kpi-value">{{ summary?.avgEfficiency ? (min(summary.avgEfficiency, 100) | number:'1.0-0') + '%' : '—' }}</div>
          <div class="kpi-label">Avg Efficiency</div>
        </div>
      </mat-card>
    </div>

    <div class="charts-row">
      <mat-card class="chart-card">
        <mat-card-header><mat-card-title>Work Orders by Status</mat-card-title></mat-card-header>
        <mat-card-content>
          @if (doughnutData) {
            <canvas baseChart
              [datasets]="doughnutData.datasets"
              [labels]="doughnutData.labels"
              [options]="doughnutOptions"
              type="doughnut">
            </canvas>
          }
        </mat-card-content>
      </mat-card>

      <mat-card class="chart-card live-table-card">
        <mat-card-header><mat-card-title>Live Stage Status</mat-card-title></mat-card-header>
        <mat-card-content>
          <table mat-table [dataSource]="liveEntries" class="full-width">
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
            <ng-container matColumnDef="elapsed">
              <th mat-header-cell *matHeaderCellDef>Elapsed</th>
              <td mat-cell *matCellDef="let e">{{ getElapsed(e.startTime) | duration }}</td>
            </ng-container>
            <ng-container matColumnDef="station">
              <th mat-header-cell *matHeaderCellDef>Station</th>
              <td mat-cell *matCellDef="let e">{{ e.station?.name || '—' }}</td>
            </ng-container>
            <tr mat-header-row *matHeaderRowDef="liveColumns"></tr>
            <tr mat-row *matRowDef="let row; columns: liveColumns;"></tr>
          </table>
          @if (liveEntries.length === 0) {
            <p class="no-data">No active entries</p>
          }
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: [`
    h2 { margin: 0 0 24px; color: var(--clay-text); font-weight: 700; }
    .kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; margin-bottom: 28px; }
    .kpi-card {
      display: flex; align-items: center; padding: 22px; gap: 16px;
      background: var(--clay-surface) !important;
      border-radius: var(--clay-radius) !important;
      box-shadow: var(--clay-shadow-raised) !important;
      border: 1px solid var(--clay-border) !important;
      transition: all var(--clay-transition);
    }
    .kpi-card:hover {
      box-shadow: var(--clay-shadow-hover) !important;
      transform: translateY(-2px);
    }
    .kpi-icon-wrap {
      width: 52px; height: 52px;
      border-radius: var(--clay-radius-sm);
      display: flex; align-items: center; justify-content: center;
      box-shadow: var(--clay-shadow-inset);
    }
    .kpi-icon-wrap.blue { background: #e0e8f0; }
    .kpi-icon-wrap.green { background: #dde9dd; }
    .kpi-icon-wrap.orange { background: #f3e4d4; }
    .kpi-icon-wrap.purple { background: #e6dded; }
    .kpi-icon-wrap.blue .kpi-icon { color: var(--clay-primary); }
    .kpi-icon-wrap.green .kpi-icon { color: #5a8a5a; }
    .kpi-icon-wrap.orange .kpi-icon { color: var(--clay-accent); }
    .kpi-icon-wrap.purple .kpi-icon { color: #8a6a9e; }
    .kpi-icon {
      font-size: 28px; width: 28px; height: 28px;
    }
    .kpi-value { font-size: 28px; font-weight: 700; color: var(--clay-text); }
    .kpi-label { font-size: 13px; color: var(--clay-text-muted); font-weight: 500; }
    .charts-row { display: grid; grid-template-columns: 1fr 2fr; gap: 20px; }
    .chart-card {
      padding: 20px;
      background: var(--clay-surface) !important;
      border-radius: var(--clay-radius) !important;
      box-shadow: var(--clay-shadow-raised) !important;
    }
    .live-table-card { overflow: auto; }
    .full-width { width: 100%; }
    .no-data { text-align: center; color: var(--clay-text-muted); padding: 24px; }
    @media (max-width: 960px) {
      .kpi-row { grid-template-columns: repeat(2, 1fr); }
      .charts-row { grid-template-columns: 1fr; }
    }
  `]
})
export class DashboardComponent implements OnInit, OnDestroy {
  summary: any = null;
  liveEntries: any[] = [];
  liveColumns = ['operator', 'workOrder', 'stage', 'elapsed', 'station'];
  doughnutData: ChartConfiguration<'doughnut'>['data'] | null = null;
  doughnutOptions: ChartConfiguration<'doughnut'>['options'] = {
    responsive: true,
    plugins: { legend: { position: 'bottom' } }
  };

  private refreshSub?: Subscription;
  private timerSub?: Subscription;

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.loadData();
    this.refreshSub = interval(30000).subscribe(() => this.loadData());
    this.timerSub = interval(1000).subscribe(() => {}); // triggers change detection for elapsed
  }

  ngOnDestroy(): void {
    this.refreshSub?.unsubscribe();
    this.timerSub?.unsubscribe();
  }

  loadData(): void {
    this.api.get<any>('/dashboard/summary').subscribe(data => {
      // workOrdersByStatus is an array of {status, count} where count is a string
      const statusArr: any[] = data.workOrdersByStatus || [];
      const totalWorkOrders = statusArr.reduce((sum: number, item: any) => sum + parseInt(item.count, 10), 0);
      this.summary = { ...data, totalWorkOrders };
      if (statusArr.length > 0) {
        const statusColors: Record<string, string> = {
          draft: '#b0a798', pending: '#e8945a', in_progress: '#5b7fa6',
          completed: '#5a8a5a', cancelled: '#c47a6a'
        };
        const labels = statusArr.map((item: any) => item.status);
        const values = statusArr.map((item: any) => parseInt(item.count, 10));
        this.doughnutData = {
          labels: labels.map(l => l.replace('_', ' ').toUpperCase()),
          datasets: [{
            data: values,
            backgroundColor: labels.map(l => statusColors[l] || '#607d8b')
          }]
        };
      }
    });
    this.api.get<any[]>('/dashboard/live-status').subscribe(entries => {
      this.liveEntries = entries || [];
    });
  }

  min(a: number, b: number): number {
    return Math.min(a, b);
  }

  getElapsed(startTime: string): number {
    if (!startTime) return 0;
    return Math.floor((Date.now() - new Date(startTime).getTime()) / 1000);
  }
}
