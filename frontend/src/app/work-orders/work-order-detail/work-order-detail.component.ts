import { Component, OnInit, OnDestroy, ViewChild } from '@angular/core';
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
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NgChartsModule } from 'ng2-charts';
import { ChartConfiguration } from 'chart.js';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';
import { DurationPipe } from '../../shared/pipes/duration.pipe';
import { ThreeViewerComponent } from '../../shared/components/three-viewer/three-viewer.component';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-work-order-detail',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterModule, MatCardModule, MatButtonModule,
    MatIconModule, MatChipsModule, MatSelectModule, MatFormFieldModule,
    MatProgressBarModule, MatTooltipModule, NgChartsModule, DurationPipe,
    ThreeViewerComponent,
  ],
  template: `
    <a routerLink="/work-orders" class="back-link">← Back to Work Orders</a>

    @if (wo) {
      <div class="wo-header">
        <div>
          <h2>{{ wo.orderNumber }}</h2>
          <p class="subtitle">
            {{ wo.product?.name }} · Qty: {{ wo.quantity }} · Due: {{ wo.dueDate ? (wo.dueDate | date:'mediumDate') : 'N/A' }}
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

      <!-- 3D Model Quality Analysis Section -->
      @if (productModels.length > 0) {
        <div class="model-section">
          <h3>
            <mat-icon class="section-icon">view_in_ar</mat-icon>
            3D Model — Quality Analysis
          </h3>

          @if (productModels.length > 1) {
            <div class="model-select-row">
              <mat-form-field appearance="outline" class="model-select-field">
                <mat-label>Select Model</mat-label>
                <mat-select [(ngModel)]="selectedModelId" (selectionChange)="onModelSelected()">
                  @for (m of productModels; track m.id) {
                    <mat-option [value]="m.id">{{ m.originalName }} ({{ (m.fileSize / 1024 / 1024).toFixed(1) }}MB)</mat-option>
                  }
                </mat-select>
              </mat-form-field>
            </div>
          }

          <mat-card class="viewer-card">
            <mat-card-header>
              <mat-card-title class="viewer-title">
                {{ selectedModelName }}
                @if (qualitySummary) {
                  <span class="quality-summary-inline">
                    <span class="qs-pass">{{ qualitySummary.pass }} pass</span>
                    <span class="qs-fail">{{ qualitySummary.fail }} fail</span>
                    <span class="qs-warn">{{ qualitySummary.warning }} warn</span>
                  </span>
                }
              </mat-card-title>
              <div class="viewer-actions">
                <button mat-icon-button (click)="viewer.resetCamera()" matTooltip="Reset camera">
                  <mat-icon>center_focus_strong</mat-icon>
                </button>
                <a mat-icon-button routerLink="/quality-analysis" matTooltip="Open full quality analysis">
                  <mat-icon>open_in_new</mat-icon>
                </a>
              </div>
            </mat-card-header>
            <mat-card-content class="viewer-content">
              @if (selectedModelUrl) {
                <app-three-viewer #viewer
                  [modelUrl]="selectedModelUrl"
                  [qualityData]="qualityOverlay"
                  (meshClicked)="onMeshClicked($event)"
                ></app-three-viewer>
              }
            </mat-card-content>
          </mat-card>

          <!-- Clicked mesh detail -->
          @if (clickedMeshEntry) {
            <mat-card class="mesh-detail-card">
              <mat-card-content>
                <div class="mesh-detail-status" [class]="clickedMeshEntry.status">
                  <mat-icon>{{ clickedMeshEntry.status === 'pass' ? 'check_circle' : clickedMeshEntry.status === 'fail' ? 'cancel' : 'warning' }}</mat-icon>
                  {{ clickedMeshEntry.regionLabel || clickedMeshEntry.meshName }} — {{ clickedMeshEntry.status | uppercase }}
                </div>
                @if (clickedMeshEntry.defectType) {
                  <div class="mesh-detail-row">Defect: {{ clickedMeshEntry.defectType }} ({{ clickedMeshEntry.severity }})</div>
                }
                @if (clickedMeshEntry.measurementValue !== null && clickedMeshEntry.measurementValue !== undefined) {
                  <div class="mesh-detail-row">
                    Measurement: {{ clickedMeshEntry.measurementValue }}{{ clickedMeshEntry.measurementUnit || '' }}
                    @if (clickedMeshEntry.toleranceMin !== null || clickedMeshEntry.toleranceMax !== null) {
                      (tolerance: {{ clickedMeshEntry.toleranceMin ?? '—' }} – {{ clickedMeshEntry.toleranceMax ?? '—' }})
                    }
                  </div>
                }
                @if (clickedMeshEntry.notes) {
                  <div class="mesh-detail-row notes">{{ clickedMeshEntry.notes }}</div>
                }
              </mat-card-content>
            </mat-card>
          }
        </div>
      }

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
    .status-draft { background: #e8e2d6; color: #7a7062; box-shadow: var(--clay-shadow-soft); } .status-pending { background: #f5e6d0; color: #c06820; box-shadow: var(--clay-shadow-soft); }
    .status-in_progress { background: #dce8f3; color: var(--clay-primary); box-shadow: var(--clay-shadow-soft); } .status-completed { background: #d8edda; color: #3a7d3e; box-shadow: var(--clay-shadow-soft); }
    .status-cancelled { background: #f2dbd8; color: #a03528; box-shadow: var(--clay-shadow-soft); }
    .priority-low { background: #d8edda; color: #3a7d3e; box-shadow: var(--clay-shadow-soft); } .priority-medium { background: #f5e6d0; color: #c06820; box-shadow: var(--clay-shadow-soft); }
    .priority-high { background: #f2dbd8; color: #a03528; box-shadow: var(--clay-shadow-soft); } .priority-urgent { background: #f44336; color: white; }
    .status-actions { display: flex; gap: 8px; align-items: center; margin-bottom: 24px; padding: 12px; background: var(--clay-surface); border-radius: var(--clay-radius-xs); }
    h3 { color: var(--clay-text); margin: 24px 0 12px; display: flex; align-items: center; gap: 8px; }
    .section-icon { font-size: 20px; width: 20px; height: 20px; color: var(--clay-primary, #6b5ce7); }
    .stages-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
    .stage-progress-card { padding: 16px; }
    .stage-completed { border-left: 4px solid #4caf50; }
    .stage-active { border-left: 4px solid #2196f3; }
    .stage-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .stage-name { font-weight: 500; }
    .stage-status-field { width: 140px; font-size: 11px; }
    ::ng-deep .stage-status-field .mat-mdc-form-field-subscript-wrapper { display: none; }
    ::ng-deep .stage-status-field .mat-mdc-select-value-text { font-size: 11px; text-transform: uppercase; font-weight: 600; }
    .ss-pending { color: #ff9800; } .ss-in_progress { color: #2196f3; }
    .ss-completed { color: #4caf50; } .ss-skipped { color: #9e9e9e; }
    .stage-times { display: flex; justify-content: space-between; font-size: 12px; color: var(--clay-text-secondary); margin-bottom: 8px; }
    .assign-row { margin-top: 12px; }
    .assign-field { width: 100%; }
    ::ng-deep .assign-field .mat-mdc-form-field-subscript-wrapper { display: none; }
    .time-chart-card { margin-top: 24px; padding: 20px; }
    .time-chart-card canvas { max-height: 300px; }

    /* 3D Model Section */
    .model-section { margin-bottom: 8px; }
    .model-select-row { margin-bottom: 12px; }
    .model-select-field { width: 320px; }
    .viewer-card { margin-bottom: 16px; }
    .viewer-card mat-card-header { display: flex; justify-content: space-between; align-items: center; }
    .viewer-title { display: flex; align-items: center; gap: 12px; font-size: 14px; }
    .viewer-actions { display: flex; gap: 4px; }
    .viewer-content { min-height: 400px; }
    .quality-summary-inline { display: inline-flex; gap: 10px; font-size: 12px; font-weight: 600; }
    .qs-pass { color: #27ae60; }
    .qs-fail { color: #e74c3c; }
    .qs-warn { color: #f39c12; }

    /* Mesh detail card */
    .mesh-detail-card { margin-bottom: 16px; }
    .mesh-detail-status {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 14px; border-radius: 8px; margin-bottom: 8px;
      font-weight: 600; font-size: 14px;
    }
    .mesh-detail-status.pass { background: #e8f5e9; color: #27ae60; }
    .mesh-detail-status.fail { background: #fce4ec; color: #e74c3c; }
    .mesh-detail-status.warning { background: #fff8e1; color: #f39c12; }
    .mesh-detail-status mat-icon { font-size: 20px; width: 20px; height: 20px; }
    .mesh-detail-row { font-size: 13px; color: var(--clay-text-secondary, #6b5e50); padding: 4px 0; }
    .mesh-detail-row.notes { font-style: italic; border-top: 1px solid var(--clay-border, #e5ddd0); padding-top: 8px; margin-top: 4px; }
  `]
})
export class WorkOrderDetailComponent implements OnInit, OnDestroy {
  @ViewChild('viewer') viewer!: ThreeViewerComponent;

  wo: any = null;
  stages: any[] = [];
  users: any[] = [];

  // 3D Model / Quality
  productModels: any[] = [];
  selectedModelId: string | null = null;
  selectedModelUrl: string | null = null;
  selectedModelName = '';
  qualityOverlay: { meshName: string; status: 'pass' | 'fail' | 'warning' }[] = [];
  qualityEntries: any[] = [];
  qualitySummary: { total: number; pass: number; fail: number; warning: number } | null = null;
  clickedMeshEntry: any = null;

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
    this.api.get<any>('/users').subscribe(data => {
      this.users = Array.isArray(data) ? data : data.data || [];
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
      this.loadProductModels();
    });
  }

  private loadProductModels(): void {
    if (!this.wo?.productId && !this.wo?.product?.id) return;
    const productId = this.wo.productId || this.wo.product?.id;
    this.api.get<any>(`/products/${productId}/models`).subscribe({
      next: (models) => {
        this.productModels = Array.isArray(models) ? models : models.data || [];
        if (this.productModels.length > 0) {
          this.selectedModelId = this.productModels[0].id;
          this.onModelSelected();
        }
      },
    });
  }

  onModelSelected(): void {
    if (!this.selectedModelId) return;
    const model = this.productModels.find(m => m.id === this.selectedModelId);
    if (!model) return;
    this.selectedModelName = model.originalName || model.name;
    this.selectedModelUrl = `${environment.apiUrl}/models/${model.id}/file`;
    this.clickedMeshEntry = null;

    // Load quality data for this model
    this.api.get<any>(`/quality-data?modelId=${model.id}`).subscribe({
      next: (res) => {
        const entries = Array.isArray(res) ? res : res.data || [];
        this.qualityEntries = entries;
        this.qualityOverlay = entries.map((e: any) => ({
          meshName: e.meshName,
          status: e.status,
        }));
      },
    });
    this.api.get<any>(`/quality-data/summary/${model.id}`).subscribe({
      next: (s) => this.qualitySummary = s,
    });
  }

  onMeshClicked(meshName: string): void {
    this.clickedMeshEntry = this.qualityEntries.find((e: any) => e.meshName === meshName) || null;
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
      workOrderStageId: wos.id,
      userId
    }).subscribe({
      next: () => this.snackBar.open('Operator assigned', 'Close', { duration: 3000 }),
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

  private buildTimeChart(): void {
    if (!this.stages.length) return;
    const labels = this.stages.map(s => s.stage?.name || 'Unknown');
    this.timeChartData = {
      labels,
      datasets: [
        {
          label: 'Target Time (s)',
          data: this.stages.map(s => s.stage?.targetTimeSeconds || 0),
          backgroundColor: 'rgba(76,175,80,0.4)',
          borderColor: '#4caf50',
          borderWidth: 2,
        },
        {
          label: 'Actual Time (s)',
          data: this.stages.map(s => s.actualTimeSeconds || 0),
          backgroundColor: this.stages.map(s =>
            s.actualTimeSeconds && s.stage?.targetTimeSeconds && s.actualTimeSeconds > s.stage.targetTimeSeconds
              ? 'rgba(244,67,54,0.5)' : 'rgba(33,150,243,0.5)'
          ),
          borderColor: this.stages.map(s =>
            s.actualTimeSeconds && s.stage?.targetTimeSeconds && s.actualTimeSeconds > s.stage.targetTimeSeconds
              ? '#f44336' : '#2196f3'
          ),
          borderWidth: 2,
        },
      ],
    };
  }
}
