import { Component, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTableModule } from '@angular/material/table';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatBadgeModule } from '@angular/material/badge';
import { NgChartsModule } from 'ng2-charts';
import { ChartConfiguration } from 'chart.js';
import { ThreeViewerComponent } from '../shared/components/three-viewer/three-viewer.component';
import { ApiService } from '../core/services/api.service';
import { AuthService } from '../core/services/auth.service';
import { QualityService, QualityDataEntry, QualitySummary } from './quality.service';
import { environment } from '../../environments/environment';

interface Model3D {
  id: string;
  name: string;
  description: string;
  fileName: string;
  originalName: string;
  fileSize: number;
  modelType: string;
  productId: string;
  product?: { id: string; name: string; sku: string };
  createdAt: string;
}

@Component({
  selector: 'app-quality-analysis',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatCardModule, MatButtonModule, MatIconModule, MatSelectModule,
    MatFormFieldModule, MatInputModule, MatTableModule, MatChipsModule,
    MatDialogModule, MatSnackBarModule, MatProgressBarModule,
    MatTooltipModule, MatBadgeModule,
    NgChartsModule,
    ThreeViewerComponent,
  ],
  template: `
    <div class="quality-page">
      <div class="page-header">
        <h1>3D Quality Analysis</h1>
        <div class="header-actions">
          <button mat-raised-button color="primary" (click)="fileInput.click()">
            <mat-icon>upload_file</mat-icon> Upload 3D Model
          </button>
          <button mat-raised-button color="accent" (click)="cadFileInput.click()">
            <mat-icon>engineering</mat-icon> Import CAD File
          </button>
          <input #fileInput type="file" hidden accept=".glb,.gltf,.obj,.fbx,.stl"
                 (change)="onFileSelected($event)">
          <input #cadFileInput type="file" hidden accept=".step,.stp,.iges,.igs"
                 (change)="onCadFileSelected($event)">
        </div>
      </div>

      @if (uploading) {
        <mat-progress-bar mode="indeterminate" class="upload-bar"></mat-progress-bar>
      }

      <div class="content-grid">
        <!-- Left Panel: Model Selector -->
        <div class="left-panel">
          <mat-card class="model-selector-card">
            <mat-card-header>
              <mat-card-title>3D Models</mat-card-title>
            </mat-card-header>
            <mat-card-content>
              <mat-form-field appearance="outline" class="full-width">
                <mat-label>Filter by type</mat-label>
                <mat-select [(ngModel)]="filterType" (selectionChange)="loadModels()">
                  <mat-option value="">All</mat-option>
                  <mat-option value="quality">Quality</mat-option>
                  <mat-option value="assembly">Assembly</mat-option>
                </mat-select>
              </mat-form-field>

              <div class="model-list">
                @for (model of models; track model.id) {
                  <div class="model-item" [class.selected]="selectedModel?.id === model.id"
                       (click)="selectModel(model)">
                    <mat-icon class="model-icon">view_in_ar</mat-icon>
                    <div class="model-info">
                      <span class="model-name">{{ model.name }}</span>
                      <span class="model-meta">
                        {{ model.product?.name || 'No product' }} &middot;
                        {{ (model.fileSize / 1024 / 1024).toFixed(1) }}MB
                      </span>
                    </div>
                    <mat-icon class="type-chip" [class]="model.modelType">
                      {{ model.modelType === 'quality' ? 'verified' : 'build' }}
                    </mat-icon>
                  </div>
                }
                @if (models.length === 0) {
                  <div class="empty-state">
                    <mat-icon>cloud_upload</mat-icon>
                    <p>No 3D models uploaded yet.</p>
                  </div>
                }
              </div>
            </mat-card-content>
          </mat-card>

          <!-- Quality Legend -->
          @if (selectedModel && summary) {
            <mat-card class="legend-card">
              <mat-card-header>
                <mat-card-title>Quality Summary</mat-card-title>
              </mat-card-header>
              <mat-card-content>
                <div class="summary-stats">
                  <div class="stat-item">
                    <span class="stat-count">{{ summary.total }}</span>
                    <span class="stat-label">Total</span>
                  </div>
                  <div class="stat-item pass">
                    <span class="stat-count">{{ summary.pass }}</span>
                    <span class="stat-label">Pass</span>
                  </div>
                  <div class="stat-item fail">
                    <span class="stat-count">{{ summary.fail }}</span>
                    <span class="stat-label">Fail</span>
                  </div>
                  <div class="stat-item warning">
                    <span class="stat-count">{{ summary.warning }}</span>
                    <span class="stat-label">Warning</span>
                  </div>
                </div>

                <div class="legend-items">
                  <div class="legend-row"><span class="legend-dot pass"></span> Pass — Within tolerance</div>
                  <div class="legend-row"><span class="legend-dot fail"></span> Fail — Out of spec</div>
                  <div class="legend-row"><span class="legend-dot warning"></span> Warning — Near limit</div>
                </div>

                <p class="legend-hint">Click on colored regions in the 3D model to view inspection details.</p>
              </mat-card-content>
            </mat-card>
          }
        </div>

        <!-- Center: 3D Viewer -->
        <div class="center-panel">
          <mat-card class="viewer-card">
            <mat-card-header>
              <mat-card-title>
                {{ selectedModel ? selectedModel.name : '3D Viewer' }}
              </mat-card-title>
              @if (selectedModel) {
                <div class="viewer-actions">
                  <button mat-icon-button (click)="viewer.resetCamera()" matTooltip="Reset camera">
                    <mat-icon>center_focus_strong</mat-icon>
                  </button>
                  <button mat-icon-button color="warn" (click)="deleteModel(selectedModel.id)" matTooltip="Delete model">
                    <mat-icon>delete</mat-icon>
                  </button>
                </div>
              }
            </mat-card-header>
            <mat-card-content class="viewer-content">
              @if (selectedModelUrl) {
                <app-three-viewer #viewer
                  [modelUrl]="selectedModelUrl"
                  [qualityData]="qualityOverlay"
                  (modelLoaded)="onModelLoaded()"
                  (meshClicked)="onMeshClicked($event)"
                ></app-three-viewer>
              } @else {
                <div class="viewer-placeholder">
                  <mat-icon>view_in_ar</mat-icon>
                  <p>Select a model from the list to view it in 3D</p>
                </div>
              }
            </mat-card-content>
          </mat-card>
        </div>

        <!-- Right Panel: Inspection Detail -->
        <div class="right-panel">
          @if (selectedEntry) {
            <mat-card class="detail-card">
              <mat-card-header>
                <mat-card-title>Inspection Detail</mat-card-title>
                <button mat-icon-button (click)="selectedEntry = null" class="close-btn">
                  <mat-icon>close</mat-icon>
                </button>
              </mat-card-header>
              <mat-card-content>
                <div class="detail-status" [class]="selectedEntry.status">
                  <mat-icon>{{ selectedEntry.status === 'pass' ? 'check_circle' : selectedEntry.status === 'fail' ? 'cancel' : 'warning' }}</mat-icon>
                  <span>{{ selectedEntry.status | uppercase }}</span>
                </div>

                <div class="detail-grid">
                  <div class="detail-row">
                    <span class="detail-label">Region</span>
                    <span class="detail-value">{{ selectedEntry.regionLabel || selectedEntry.meshName }}</span>
                  </div>
                  @if (selectedEntry.inspector) {
                    <div class="detail-row">
                      <span class="detail-label">Inspector</span>
                      <span class="detail-value">{{ selectedEntry.inspector }}</span>
                    </div>
                  }
                  @if (selectedEntry.inspectionDate) {
                    <div class="detail-row">
                      <span class="detail-label">Date</span>
                      <span class="detail-value">{{ selectedEntry.inspectionDate | date:'medium' }}</span>
                    </div>
                  }
                  @if (selectedEntry.defectType) {
                    <div class="detail-row">
                      <span class="detail-label">Defect Type</span>
                      <span class="detail-value">{{ selectedEntry.defectType }}</span>
                    </div>
                  }
                  @if (selectedEntry.severity) {
                    <div class="detail-row">
                      <span class="detail-label">Severity</span>
                      <span class="detail-value severity" [class]="selectedEntry.severity">{{ selectedEntry.severity | uppercase }}</span>
                    </div>
                  }
                  @if (selectedEntry.measurementValue !== null) {
                    <div class="detail-row">
                      <span class="detail-label">Measurement</span>
                      <span class="detail-value">{{ selectedEntry.measurementValue }} {{ selectedEntry.measurementUnit || '' }}</span>
                    </div>
                  }
                  @if (selectedEntry.toleranceMin !== null || selectedEntry.toleranceMax !== null) {
                    <div class="detail-row">
                      <span class="detail-label">Tolerance</span>
                      <span class="detail-value">{{ selectedEntry.toleranceMin ?? '—' }} – {{ selectedEntry.toleranceMax ?? '—' }} {{ selectedEntry.measurementUnit || '' }}</span>
                    </div>
                  }
                  @if (selectedEntry.notes) {
                    <div class="detail-row notes">
                      <span class="detail-label">Notes</span>
                      <span class="detail-value">{{ selectedEntry.notes }}</span>
                    </div>
                  }
                </div>
              </mat-card-content>
            </mat-card>
          }

          <!-- Quality Data Table -->
          @if (qualityEntries.length > 0) {
            <mat-card class="entries-card">
              <mat-card-header>
                <mat-card-title>All Inspections ({{ qualityEntries.length }})</mat-card-title>
              </mat-card-header>
              <mat-card-content>
                <div class="entries-list">
                  @for (entry of qualityEntries; track entry.id) {
                    <div class="entry-item" [class]="entry.status"
                         [class.active]="selectedEntry?.id === entry.id"
                         (click)="selectedEntry = entry">
                      <span class="entry-dot" [class]="entry.status"></span>
                      <div class="entry-info">
                        <span class="entry-name">{{ entry.regionLabel || entry.meshName }}</span>
                        <span class="entry-meta">
                          {{ entry.status | uppercase }}
                          @if (entry.defectType) { &middot; {{ entry.defectType }} }
                        </span>
                      </div>
                    </div>
                  }
                </div>
              </mat-card-content>
            </mat-card>
          }

          @if (selectedModel && qualityEntries.length === 0) {
            <mat-card class="no-data-card">
              <mat-card-content>
                <div class="empty-state small">
                  <mat-icon>info</mat-icon>
                  <p>No inspection data yet for this model. Add quality data via API or the inspection form.</p>
                </div>
              </mat-card-content>
            </mat-card>
          }

          <!-- Phase 6: Defect Patterns -->
          @if (defectPatterns.length > 0) {
            <mat-card class="patterns-card">
              <mat-card-header>
                <mat-card-title>Recurring Defects</mat-card-title>
              </mat-card-header>
              <mat-card-content>
                <div class="patterns-list">
                  @for (p of defectPatterns; track p.meshName + p.defectType) {
                    <div class="pattern-item">
                      <div class="pattern-info">
                        <span class="pattern-region">{{ p.regionLabel || p.meshName }}</span>
                        <span class="pattern-defect">{{ p.defectType || 'Unknown' }}</span>
                      </div>
                      <div class="pattern-stats">
                        <span class="pattern-count">{{ p.occurrences }}x</span>
                        <span class="pattern-rate" [class.high-rate]="+(p.failRate) > 50">{{ (+p.failRate).toFixed(0) }}% fail</span>
                      </div>
                    </div>
                  }
                </div>
              </mat-card-content>
            </mat-card>
          }

          <!-- Phase 6: Sign-off Pending -->
          @if (pendingSignoffs.length > 0) {
            <mat-card class="signoff-card">
              <mat-card-header>
                <mat-card-title>Pending Sign-offs ({{ pendingSignoffs.length }})</mat-card-title>
              </mat-card-header>
              <mat-card-content>
                <div class="entries-list">
                  @for (entry of pendingSignoffs; track entry.id) {
                    <div class="entry-item fail">
                      <span class="entry-dot fail"></span>
                      <div class="entry-info">
                        <span class="entry-name">{{ entry.regionLabel || entry.meshName }}</span>
                        <span class="entry-meta">{{ entry.defectType || 'Defect' }}</span>
                      </div>
                      <div class="signoff-actions">
                        <button mat-icon-button color="primary" (click)="approveSignoff(entry.id)" matTooltip="Approve">
                          <mat-icon>check</mat-icon>
                        </button>
                        <button mat-icon-button color="warn" (click)="rejectSignoff(entry.id)" matTooltip="Reject">
                          <mat-icon>close</mat-icon>
                        </button>
                      </div>
                    </div>
                  }
                </div>
              </mat-card-content>
            </mat-card>
          }
        </div>
      </div>

      <!-- Phase 6: Quality Trends Chart (below main grid) -->
      @if (trendData.length > 0) {
        <mat-card class="trends-card">
          <mat-card-header>
            <mat-card-title>Quality Trends Over Time</mat-card-title>
          </mat-card-header>
          <mat-card-content>
            <canvas baseChart
              [datasets]="trendChartData.datasets"
              [labels]="trendChartData.labels"
              [options]="trendChartOptions"
              type="line">
            </canvas>
          </mat-card-content>
        </mat-card>
      }
    </div>
  `,
  styles: [`
    .quality-page { display: flex; flex-direction: column; gap: 20px; }
    .page-header { display: flex; justify-content: space-between; align-items: center; }
    .page-header h1 { font-size: 24px; font-weight: 700; color: var(--clay-text, #3d3229); margin: 0; }
    .upload-bar { margin-bottom: 8px; border-radius: 4px; }

    .content-grid {
      display: grid;
      grid-template-columns: 280px 1fr 300px;
      gap: 20px;
      min-height: 600px;
    }

    .left-panel { display: flex; flex-direction: column; gap: 16px; }
    .center-panel { display: flex; flex-direction: column; }
    .right-panel { display: flex; flex-direction: column; gap: 16px; }

    .model-selector-card { max-height: 400px; overflow-y: auto; }
    .full-width { width: 100%; }
    .model-list { display: flex; flex-direction: column; gap: 6px; }
    .model-item {
      display: flex; align-items: center; gap: 10px;
      padding: 10px; border-radius: 8px; cursor: pointer;
      background: var(--clay-bg, #faf7f2);
      border: 1px solid var(--clay-border, #e5ddd0);
      transition: all 0.2s;
    }
    .model-item:hover { background: var(--clay-surface, #f5f0e8); }
    .model-item.selected {
      background: var(--clay-surface, #f5f0e8);
      border-color: var(--clay-primary, #6b5ce7);
      box-shadow: var(--clay-shadow-raised, 0 4px 12px rgba(0,0,0,0.1));
    }
    .model-icon { color: var(--clay-primary, #6b5ce7); font-size: 20px; width: 20px; height: 20px; }
    .model-info { flex: 1; display: flex; flex-direction: column; }
    .model-name { font-weight: 600; font-size: 13px; }
    .model-meta { font-size: 11px; color: var(--clay-text-muted, #9e8e7e); }
    .type-chip.quality { color: #27ae60; }
    .type-chip.assembly { color: #3498db; }

    /* Legend Card */
    .legend-card mat-card-content { padding-top: 8px; }
    .summary-stats {
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 16px;
    }
    .stat-item {
      display: flex; flex-direction: column; align-items: center;
      padding: 8px 4px; border-radius: 8px;
      background: var(--clay-bg, #faf7f2);
    }
    .stat-count { font-size: 20px; font-weight: 700; }
    .stat-label { font-size: 11px; color: var(--clay-text-muted, #9e8e7e); }
    .stat-item.pass .stat-count { color: #27ae60; }
    .stat-item.fail .stat-count { color: #e74c3c; }
    .stat-item.warning .stat-count { color: #f39c12; }
    .legend-items { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
    .legend-row { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--clay-text-secondary, #6b5e50); }
    .legend-dot {
      width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0;
    }
    .legend-dot.pass { background: #27ae60; }
    .legend-dot.fail { background: #e74c3c; }
    .legend-dot.warning { background: #f39c12; }
    .legend-hint { font-size: 11px; color: var(--clay-text-muted, #9e8e7e); font-style: italic; margin: 0; }

    /* Viewer */
    .viewer-card { display: flex; flex-direction: column; height: 100%; }
    .viewer-card mat-card-header { display: flex; justify-content: space-between; align-items: center; }
    .viewer-actions { display: flex; gap: 4px; }
    .viewer-content { flex: 1; min-height: 500px; }
    .viewer-placeholder {
      display: flex; flex-direction: column; align-items: center;
      justify-content: center; height: 500px; color: var(--clay-text-muted, #9e8e7e);
    }
    .viewer-placeholder mat-icon { font-size: 64px; width: 64px; height: 64px; opacity: 0.4; }

    /* Detail Panel */
    .detail-card mat-card-header { display: flex; justify-content: space-between; align-items: center; }
    .close-btn { margin-left: auto; }
    .detail-status {
      display: flex; align-items: center; gap: 8px;
      padding: 12px; border-radius: 8px; margin-bottom: 16px;
      font-weight: 700; font-size: 16px;
    }
    .detail-status.pass { background: #e8f5e9; color: #27ae60; }
    .detail-status.fail { background: #fce4ec; color: #e74c3c; }
    .detail-status.warning { background: #fff8e1; color: #f39c12; }
    .detail-status mat-icon { font-size: 28px; width: 28px; height: 28px; }
    .detail-grid { display: flex; flex-direction: column; gap: 10px; }
    .detail-row { display: flex; flex-direction: column; gap: 2px; }
    .detail-row.notes { padding-top: 8px; border-top: 1px solid var(--clay-border, #e5ddd0); }
    .detail-label { font-size: 11px; color: var(--clay-text-muted, #9e8e7e); text-transform: uppercase; letter-spacing: 0.5px; }
    .detail-value { font-size: 14px; font-weight: 500; }
    .detail-value.severity.low { color: #27ae60; }
    .detail-value.severity.medium { color: #f39c12; }
    .detail-value.severity.high { color: #e67e22; }
    .detail-value.severity.critical { color: #e74c3c; }

    /* Entries List */
    .entries-card { max-height: 350px; overflow-y: auto; }
    .entries-list { display: flex; flex-direction: column; gap: 4px; }
    .entry-item {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 10px; border-radius: 6px; cursor: pointer;
      border: 1px solid transparent; transition: all 0.15s;
    }
    .entry-item:hover { background: var(--clay-bg, #faf7f2); }
    .entry-item.active { background: var(--clay-bg, #faf7f2); border-color: var(--clay-border, #e5ddd0); }
    .entry-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .entry-dot.pass { background: #27ae60; }
    .entry-dot.fail { background: #e74c3c; }
    .entry-dot.warning { background: #f39c12; }
    .entry-info { flex: 1; display: flex; flex-direction: column; }
    .entry-name { font-size: 13px; font-weight: 500; }
    .entry-meta { font-size: 11px; color: var(--clay-text-muted, #9e8e7e); }

    .empty-state, .empty-state.small {
      display: flex; flex-direction: column; align-items: center;
      padding: 24px 16px; color: var(--clay-text-muted, #9e8e7e); text-align: center;
    }
    .empty-state mat-icon { font-size: 40px; width: 40px; height: 40px; opacity: 0.3; }
    .no-data-card mat-card-content { padding: 8px; }

    /* Phase 6: Trends */
    .trends-card { margin-top: 20px; padding: 16px; }
    .trends-card canvas { max-height: 300px; }

    /* Phase 6: Defect Patterns */
    .patterns-card { max-height: 250px; overflow-y: auto; }
    .patterns-list { display: flex; flex-direction: column; gap: 6px; }
    .pattern-item {
      display: flex; justify-content: space-between; align-items: center;
      padding: 8px 10px; border-radius: 6px;
      background: var(--clay-bg, #faf7f2);
      border: 1px solid var(--clay-border, #e5ddd0);
    }
    .pattern-region { font-size: 13px; font-weight: 600; }
    .pattern-defect { font-size: 11px; color: var(--clay-text-muted, #9e8e7e); display: block; }
    .pattern-stats { text-align: right; }
    .pattern-count { font-weight: 700; font-size: 14px; margin-right: 8px; }
    .pattern-rate { font-size: 12px; color: var(--clay-text-secondary); }
    .pattern-rate.high-rate { color: #e74c3c; font-weight: 600; }

    /* Phase 6: Sign-off */
    .signoff-card { max-height: 250px; overflow-y: auto; }
    .signoff-actions { display: flex; gap: 2px; }

    .header-actions { display: flex; gap: 8px; }

    @media (max-width: 1100px) {
      .content-grid { grid-template-columns: 260px 1fr; }
      .right-panel { display: none; }
    }
    @media (max-width: 768px) {
      .content-grid { grid-template-columns: 1fr; }
    }
  `]
})
export class QualityAnalysisComponent implements OnInit {
  @ViewChild('viewer') viewer!: ThreeViewerComponent;

  models: Model3D[] = [];
  selectedModel: Model3D | null = null;
  selectedModelUrl: string | null = null;
  filterType = '';
  uploading = false;
  converting = false;
  qualityOverlay: { meshName: string; status: 'pass' | 'fail' | 'warning' }[] = [];
  qualityEntries: QualityDataEntry[] = [];
  selectedEntry: QualityDataEntry | null = null;
  summary: QualitySummary | null = null;

  // Phase 6: Trends, patterns, sign-offs
  trendData: any[] = [];
  trendChartData: ChartConfiguration<'line'>['data'] = { labels: [], datasets: [] };
  trendChartOptions: ChartConfiguration<'line'>['options'] = {
    responsive: true,
    plugins: { legend: { position: 'bottom' } },
    scales: { y: { beginAtZero: true, title: { display: true, text: 'Count' } } }
  };
  defectPatterns: any[] = [];
  pendingSignoffs: QualityDataEntry[] = [];

  constructor(
    private api: ApiService,
    private qualityService: QualityService,
    private authService: AuthService,
    private snackBar: MatSnackBar,
  ) {}

  ngOnInit(): void {
    this.loadModels();
  }

  loadModels(): void {
    const params: Record<string, string> = {};
    if (this.filterType) params['modelType'] = this.filterType;
    this.api.get<any>('/models', params).subscribe({
      next: (res) => this.models = res.data || res,
      error: () => this.snackBar.open('Failed to load models', 'Close', { duration: 3000 }),
    });
  }

  selectModel(model: Model3D): void {
    this.selectedModel = model;
    this.selectedModelUrl = `${environment.apiUrl}/models/${model.id}/file`;
    this.qualityOverlay = [];
    this.qualityEntries = [];
    this.selectedEntry = null;
    this.summary = null;
    this.loadQualityData(model.id);
  }

  private loadQualityData(modelId: string): void {
    this.qualityService.getByModel(modelId).subscribe({
      next: (entries) => {
        this.qualityEntries = entries;
        this.qualityOverlay = entries.map(e => ({
          meshName: e.meshName,
          status: e.status,
        }));
      },
    });
    this.qualityService.getSummary(modelId).subscribe({
      next: (s) => this.summary = s,
    });

    // Phase 6: Load trends
    this.qualityService.getTrends(modelId).subscribe({
      next: (data) => {
        this.trendData = data || [];
        this.buildTrendChart(data || []);
      },
    });

    // Phase 6: Load defect patterns
    this.qualityService.getDefectPatterns(modelId).subscribe({
      next: (data) => this.defectPatterns = data || [],
    });

    // Phase 6: Load pending sign-offs
    this.qualityService.getPendingSignoffs(modelId).subscribe({
      next: (data) => this.pendingSignoffs = data || [],
    });
  }

  private buildTrendChart(data: { date: string; status: string; count: string }[]): void {
    const dateMap = new Map<string, { pass: number; fail: number; warning: number }>();
    for (const d of data) {
      if (!dateMap.has(d.date)) dateMap.set(d.date, { pass: 0, fail: 0, warning: 0 });
      const entry = dateMap.get(d.date)!;
      entry[d.status as 'pass' | 'fail' | 'warning'] = parseInt(d.count, 10);
    }
    const dates = Array.from(dateMap.keys()).sort();
    this.trendChartData = {
      labels: dates,
      datasets: [
        { label: 'Pass', data: dates.map(d => dateMap.get(d)!.pass), borderColor: '#27ae60', backgroundColor: 'rgba(39,174,96,0.1)', fill: true },
        { label: 'Fail', data: dates.map(d => dateMap.get(d)!.fail), borderColor: '#e74c3c', backgroundColor: 'rgba(231,76,60,0.1)', fill: true },
        { label: 'Warning', data: dates.map(d => dateMap.get(d)!.warning), borderColor: '#f39c12', backgroundColor: 'rgba(243,156,18,0.1)', fill: true },
      ],
    };
  }

  approveSignoff(id: string): void {
    const user = this.authService.currentUser;
    const name = user ? `${user.firstName} ${user.lastName}` : 'Unknown';
    this.qualityService.signoff(id, 'approved', name).subscribe({
      next: () => {
        this.snackBar.open('Approved', 'Close', { duration: 2000 });
        if (this.selectedModel) this.loadQualityData(this.selectedModel.id);
      },
    });
  }

  rejectSignoff(id: string): void {
    const user = this.authService.currentUser;
    const name = user ? `${user.firstName} ${user.lastName}` : 'Unknown';
    this.qualityService.signoff(id, 'rejected', name).subscribe({
      next: () => {
        this.snackBar.open('Rejected', 'Close', { duration: 2000 });
        if (this.selectedModel) this.loadQualityData(this.selectedModel.id);
      },
    });
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    const file = input.files[0];
    const name = file.name.replace(/\.[^.]+$/, '');
    this.uploadModel(file, name);
    input.value = '';
  }

  onCadFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    const file = input.files[0];
    const name = file.name.replace(/\.[^.]+$/, '');
    this.uploadCadFile(file, name);
    input.value = '';
  }

  uploadCadFile(file: File, name: string): void {
    this.uploading = true;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('name', name);
    formData.append('modelType', 'quality');

    this.api.post<any>('/cad/convert-and-upload', formData).subscribe({
      next: (result) => {
        this.uploading = false;
        this.snackBar.open(
          `CAD file converted (${result.conversion.originalFormat} → GLB) and uploaded`,
          'Close', { duration: 4000 },
        );
        this.loadModels();
        this.selectModel(result);
      },
      error: (err) => {
        this.uploading = false;
        this.snackBar.open(err?.error?.message || 'CAD conversion failed', 'Close', { duration: 4000 });
      },
    });
  }

  uploadModel(file: File, name: string): void {
    this.uploading = true;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('name', name);
    formData.append('modelType', 'quality');

    this.api.post<Model3D>('/models', formData).subscribe({
      next: (model) => {
        this.uploading = false;
        this.snackBar.open('Model uploaded successfully', 'Close', { duration: 3000 });
        this.loadModels();
        this.selectModel(model);
      },
      error: (err) => {
        this.uploading = false;
        this.snackBar.open(err?.error?.message || 'Upload failed', 'Close', { duration: 3000 });
      },
    });
  }

  deleteModel(id: string): void {
    if (!confirm('Delete this 3D model?')) return;
    this.api.delete(`/models/${id}`).subscribe({
      next: () => {
        this.snackBar.open('Model deleted', 'Close', { duration: 3000 });
        if (this.selectedModel?.id === id) {
          this.selectedModel = null;
          this.selectedModelUrl = null;
          this.qualityEntries = [];
          this.selectedEntry = null;
          this.summary = null;
        }
        this.loadModels();
      },
      error: () => this.snackBar.open('Delete failed', 'Close', { duration: 3000 }),
    });
  }

  onModelLoaded(): void {
    // Quality data already loaded in selectModel
  }

  onMeshClicked(meshName: string): void {
    const entry = this.qualityEntries.find(e => e.meshName === meshName);
    if (entry) {
      this.selectedEntry = entry;
    }
  }
}
