import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { NgChartsModule } from 'ng2-charts';
import { Chart, registerables, ChartConfiguration } from 'chart.js';
import { ApiService } from '../core/services/api.service';

Chart.register(...registerables);

@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [CommonModule, FormsModule, MatCardModule, MatFormFieldModule, MatDatepickerModule, MatNativeDateModule, MatInputModule, MatButtonModule, NgChartsModule],
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
      <button mat-raised-button color="primary" (click)="loadAll()">Apply</button>
    </div>

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
  `,
  styles: [`
    h2 { margin: 0 0 24px; color: #1a237e; }
    .filters { display: flex; gap: 16px; margin-bottom: 24px; align-items: flex-start; }
    .charts-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
    .chart-card { padding: 16px; }
    .no-data { text-align: center; color: #999; padding: 40px; }
    @media (max-width: 960px) { .charts-grid { grid-template-columns: 1fr; } }
  `]
})
export class ReportsComponent implements OnInit {
  dateFrom: Date | null = null;
  dateTo: Date | null = null;
  operatorChartData: ChartConfiguration<'bar'>['data'] | null = null;
  stageChartData: ChartConfiguration<'bar'>['data'] | null = null;
  barOptions: ChartConfiguration<'bar'>['options'] = {
    responsive: true,
    plugins: { legend: { position: 'top' } },
    scales: { y: { beginAtZero: true, title: { display: true, text: '%' } } }
  };

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    const now = new Date();
    this.dateTo = now;
    this.dateFrom = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    this.loadAll();
  }

  loadAll(): void {
    this.loadOperatorPerformance();
    this.loadStageAnalytics();
  }

  private getParams(): Record<string, string> {
    const params: Record<string, string> = {};
    if (this.dateFrom) params['startDate'] = this.dateFrom.toISOString();
    if (this.dateTo) params['endDate'] = this.dateTo.toISOString();
    return params;
  }

  loadOperatorPerformance(): void {
    this.api.get<any[]>('/dashboard/operator-performance', this.getParams()).subscribe({
      next: (data) => {
        if (!data || !Array.isArray(data) || data.length === 0) {
          this.operatorChartData = null;
          return;
        }
        this.operatorChartData = {
          labels: data.map(d => d.name || d.operatorName || `${d.firstName} ${d.lastName}`),
          datasets: [{
            label: 'Avg Efficiency %',
            data: data.map(d => d.avgEfficiency || d.efficiency || 0),
            backgroundColor: '#3f51b5'
          }]
        };
      },
      error: () => { this.operatorChartData = null; }
    });
  }

  loadStageAnalytics(): void {
    this.api.get<any[]>('/dashboard/stage-analytics', this.getParams()).subscribe({
      next: (data) => {
        if (!data || !Array.isArray(data) || data.length === 0) {
          this.stageChartData = null;
          return;
        }
        this.stageChartData = {
          labels: data.map(d => d.name || d.stageName),
          datasets: [
            {
              label: 'Avg Time (s)',
              data: data.map(d => d.avgTime || d.avgTimeSeconds || 0),
              backgroundColor: '#ff9800'
            },
            {
              label: 'Target (s)',
              data: data.map(d => d.targetTime || d.targetTimeSeconds || 0),
              backgroundColor: 'rgba(76,175,80,0.4)',
              borderColor: '#4caf50',
              borderWidth: 2
            }
          ]
        };
      },
      error: () => { this.stageChartData = null; }
    });
  }
}
