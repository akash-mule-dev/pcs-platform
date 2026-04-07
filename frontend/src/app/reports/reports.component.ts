import { Component, OnInit, AfterViewInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatPaginatorModule, MatPaginator } from '@angular/material/paginator';
import { NgChartsModule } from 'ng2-charts';
import { Chart, registerables, ChartConfiguration } from 'chart.js';
import { ApiService } from '../core/services/api.service';
import { DurationPipe } from '../shared/pipes/duration.pipe';

Chart.register(...registerables);

@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatCardModule, MatFormFieldModule,
    MatDatepickerModule, MatNativeDateModule, MatInputModule,
    MatButtonModule, MatIconModule, MatProgressBarModule,
    MatTableModule, MatPaginatorModule, NgChartsModule, DurationPipe,
  ],
  template: `
    <h2>Reports & Analytics</h2>

    <div class="filters">
      <mat-form-field appearance="outline">
        <mat-label>From</mat-label>
        <input matInput [matDatepicker]="fromPicker" [(ngModel)]="dateFrom" (dateChange)="loadAll()">
        <mat-datepicker-toggle matSuffix [for]="fromPicker"></mat-datepicker-toggle>
        <mat-datepicker #fromPicker></mat-datepicker>
      </mat-form-field>
      <mat-form-field appearance="outline">
        <mat-label>To</mat-label>
        <input matInput [matDatepicker]="toPicker" [(ngModel)]="dateTo" (dateChange)="loadAll()">
        <mat-datepicker-toggle matSuffix [for]="toPicker"></mat-datepicker-toggle>
        <mat-datepicker #toPicker></mat-datepicker>
      </mat-form-field>
      <button mat-raised-button color="primary" (click)="loadAll()">
        <mat-icon>refresh</mat-icon> Apply
      </button>
      <button mat-raised-button (click)="exportCSV()">
        <mat-icon>download</mat-icon> Export CSV
      </button>
    </div>

    <!-- OEE Widget -->
    @if (oee) {
      <mat-card class="oee-card">
        <mat-card-header><mat-card-title>OEE — Overall Equipment Effectiveness</mat-card-title></mat-card-header>
        <mat-card-content>
          @if (oee.oee === 0 && oee.availability === 0 && oee.performance === 0) {
            <p class="no-data">No OEE data available for the selected period. OEE requires completed work order stages with time entries.</p>
          } @else {
          <div class="oee-grid">
            <div class="oee-main">
              <div class="oee-score" [class.good]="oee.oee >= 80" [class.warning]="oee.oee >= 60 && oee.oee < 80" [class.poor]="oee.oee < 60">
                {{ oee.oee }}%
              </div>
              <div class="oee-label">OEE Score</div>
            </div>
            <div class="oee-factor">
              <div class="factor-label">Availability</div>
              <mat-progress-bar [value]="oee.availability" color="primary"></mat-progress-bar>
              <span class="factor-value">{{ oee.availability }}%</span>
            </div>
            <div class="oee-factor">
              <div class="factor-label">Performance</div>
              <mat-progress-bar [value]="oee.performance" color="accent"></mat-progress-bar>
              <span class="factor-value">{{ oee.performance }}%</span>
            </div>
            <div class="oee-factor">
              <div class="factor-label">Quality</div>
              <mat-progress-bar [value]="oee.quality" color="primary"></mat-progress-bar>
              <span class="factor-value">{{ oee.quality }}%</span>
            </div>
          </div>
          }
        </mat-card-content>
      </mat-card>
    }

    <div class="charts-grid">
      <mat-card class="chart-card">
        <mat-card-header><mat-card-title>Operator Performance</mat-card-title></mat-card-header>
        <mat-card-content>
          @if (operatorChartData) {
            <canvas baseChart
              [datasets]="operatorChartData.datasets"
              [labels]="operatorChartData.labels"
              [options]="barOptions"
              type="bar">
            </canvas>
          } @else {
            <p class="no-data">No data available</p>
          }
        </mat-card-content>
      </mat-card>

      <mat-card class="chart-card">
        <mat-card-header><mat-card-title>Stage Analytics</mat-card-title></mat-card-header>
        <mat-card-content>
          @if (stageChartData) {
            <canvas baseChart
              [datasets]="stageChartData.datasets"
              [labels]="stageChartData.labels"
              [options]="barOptions"
              type="bar">
            </canvas>
          } @else {
            <p class="no-data">No data available</p>
          }
        </mat-card-content>
      </mat-card>
    </div>

    <!-- Operator Performance Table -->
    @if (operatorData.length > 0) {
      <mat-card class="table-card">
        <mat-card-header><mat-card-title>Operator Metrics</mat-card-title></mat-card-header>
        <mat-card-content>
          <table mat-table [dataSource]="operatorTableSource" class="full-width">
            <ng-container matColumnDef="name">
              <th mat-header-cell *matHeaderCellDef>Operator</th>
              <td mat-cell *matCellDef="let r">{{ r.operatorName }}</td>
            </ng-container>
            <ng-container matColumnDef="stages">
              <th mat-header-cell *matHeaderCellDef>Stages</th>
              <td mat-cell *matCellDef="let r">{{ r.stagesCompleted }}</td>
            </ng-container>
            <ng-container matColumnDef="totalTime">
              <th mat-header-cell *matHeaderCellDef>Total Time</th>
              <td mat-cell *matCellDef="let r">{{ r.totalTime | duration }}</td>
            </ng-container>
            <ng-container matColumnDef="efficiency">
              <th mat-header-cell *matHeaderCellDef>Efficiency</th>
              <td mat-cell *matCellDef="let r" [class.over-target]="r.avgEfficiency < 80" [class.on-target]="r.avgEfficiency >= 80">
                {{ r.avgEfficiency ? (r.avgEfficiency + '%') : '—' }}
              </td>
            </ng-container>
            <tr mat-header-row *matHeaderRowDef="['name','stages','totalTime','efficiency']"></tr>
            <tr mat-row *matRowDef="let row; columns: ['name','stages','totalTime','efficiency']"></tr>
          </table>
          <mat-paginator [pageSize]="10" [pageSizeOptions]="[5, 10, 25]" showFirstLastButtons></mat-paginator>
        </mat-card-content>
      </mat-card>
    }
  `,
  styles: [`
    h2 { margin: 0 0 24px; color: var(--clay-text); }
    .filters { display: flex; gap: 16px; margin-bottom: 24px; align-items: flex-start; flex-wrap: wrap; }

    /* OEE Card */
    .oee-card { margin-bottom: 24px; padding: 20px; }
    .oee-grid { display: grid; grid-template-columns: 160px 1fr 1fr 1fr; gap: 24px; align-items: center; }
    .oee-main { text-align: center; }
    .oee-score { font-size: 48px; font-weight: 800; }
    .oee-score.good { color: var(--success); }
    .oee-score.warning { color: var(--warning); }
    .oee-score.poor { color: var(--danger); }
    .oee-label { font-size: 13px; color: var(--clay-text-muted); font-weight: 500; }
    .oee-factor { display: flex; flex-direction: column; gap: 4px; }
    .factor-label { font-size: 12px; color: var(--clay-text-secondary); font-weight: 500; }
    .factor-value { font-size: 14px; font-weight: 700; color: var(--clay-text); }

    .charts-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 24px; }
    .chart-card { padding: 16px; }
    .table-card { padding: 16px; }
    .full-width { width: 100%; }
    .no-data { text-align: center; color: var(--clay-text-muted); padding: 40px; }
    .over-target { color: var(--danger); font-weight: 600; }
    .on-target { color: var(--success); font-weight: 600; }

    @media (max-width: 960px) {
      .charts-grid { grid-template-columns: 1fr; }
      .oee-grid { grid-template-columns: 1fr; }
    }
  `]
})
export class ReportsComponent implements OnInit, AfterViewInit {
  dateFrom: Date | null = null;
  dateTo: Date | null = null;
  oee: any = null;
  operatorChartData: ChartConfiguration<'bar'>['data'] | null = null;
  stageChartData: ChartConfiguration<'bar'>['data'] | null = null;
  operatorData: any[] = [];
  operatorTableSource = new MatTableDataSource<any>([]);
  @ViewChild(MatPaginator) paginator!: MatPaginator;
  barOptions: ChartConfiguration<'bar'>['options'] = {
    responsive: true,
    plugins: { legend: { position: 'top' } },
    scales: { y: { beginAtZero: true, title: { display: true, text: '%' } } }
  };

  constructor(private api: ApiService) {}

  ngAfterViewInit(): void { this.operatorTableSource.paginator = this.paginator; }

  private cssVar(name: string, fallback: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  }

  ngOnInit(): void {
    const now = new Date();
    this.dateTo = now;
    this.dateFrom = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    this.loadAll();
  }

  loadAll(): void {
    this.loadOEE();
    this.loadOperatorPerformance();
    this.loadStageAnalytics();
  }

  private getParams(): Record<string, string> {
    const params: Record<string, string> = {};
    if (this.dateFrom) params['startDate'] = this.dateFrom.toISOString();
    if (this.dateTo) params['endDate'] = this.dateTo.toISOString();
    return params;
  }

  loadOEE(): void {
    this.api.get<any>('/dashboard/oee', this.getParams()).subscribe({
      next: (data) => this.oee = data,
      error: () => this.oee = null,
    });
  }

  loadOperatorPerformance(): void {
    this.api.get<any[]>('/dashboard/operator-performance', this.getParams()).subscribe({
      next: (data) => {
        if (!data || !Array.isArray(data) || data.length === 0) {
          this.operatorChartData = null;
          this.operatorData = [];
          return;
        }
        this.operatorData = data;
        this.operatorTableSource.data = data;
        const successBg = this.cssVar('--success-bg', 'rgba(76,175,80,0.6)');
        const warningBg = this.cssVar('--warning-bg', 'rgba(255,152,0,0.6)');
        const successColor = this.cssVar('--success', '#4caf50');
        const warningColor = this.cssVar('--warning', '#ff9800');
        this.operatorChartData = {
          labels: data.map(d => d.operatorName || `${d.firstName} ${d.lastName}`),
          datasets: [{
            label: 'Avg Efficiency %',
            data: data.map(d => d.avgEfficiency || 0),
            backgroundColor: data.map(d => (d.avgEfficiency || 0) >= 80 ? successBg : warningBg),
            borderColor: data.map(d => (d.avgEfficiency || 0) >= 80 ? successColor : warningColor),
            borderWidth: 2,
          }]
        };
      },
      error: () => { this.operatorChartData = null; this.operatorData = []; this.operatorTableSource.data = []; }
    });
  }

  loadStageAnalytics(): void {
    this.api.get<any[]>('/dashboard/stage-analytics', this.getParams()).subscribe({
      next: (data) => {
        if (!data || !Array.isArray(data) || data.length === 0) { this.stageChartData = null; return; }
        const stageWarning = this.cssVar('--warning', '#ff9800');
        const stageSuccessBg = this.cssVar('--success-bg', 'rgba(76,175,80,0.4)');
        const stageSuccess = this.cssVar('--success', '#4caf50');
        this.stageChartData = {
          labels: data.map(d => d.stageName),
          datasets: [
            { label: 'Avg Time (s)', data: data.map(d => d.avgTime || 0), backgroundColor: stageWarning },
            { label: 'Target (s)', data: data.map(d => d.targetTime || 0), backgroundColor: stageSuccessBg, borderColor: stageSuccess, borderWidth: 2 },
          ]
        };
      },
      error: () => { this.stageChartData = null; }
    });
  }

  exportCSV(): void {
    this.api.get<any[]>('/dashboard/export', this.getParams()).subscribe({
      next: (data) => {
        if (!data || data.length === 0) return;
        const headers = Object.keys(data[0]);
        const csvRows = [
          headers.join(','),
          ...data.map(row => headers.map(h => `"${row[h] ?? ''}"`).join(',')),
        ];
        const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `pcs-report-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      },
    });
  }
}
