import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpEventType } from '@angular/common/http';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Subscription } from 'rxjs';
import {
  ConversionApiService, ConversionJob, ConversionProgress, SupportedFormat,
} from '../core/services/conversion.service';
import { RealtimeService } from '../core/services/realtime.service';
import { PermissionsService } from '../core/services/permissions.service';
import { ThreeViewerComponent } from '../shared/components/three-viewer/three-viewer.component';

interface ActiveJob {
  id: string;
  status: string;
  progress: number;
  originalName: string;
  modelId?: string | null;
  trianglesBefore?: number | null;
  trianglesAfter?: number | null;
  outputSize?: number | null;
  dimensions?: { x: number; y: number; z: number } | null;
  error?: string | null;
}

@Component({
  selector: 'app-conversion-upload',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatCardModule, MatButtonModule, MatIconModule, MatProgressBarModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatSlideToggleModule,
    MatTooltipModule, MatSnackBarModule,
    ThreeViewerComponent,
  ],
  template: `
    <div class="page-header">
      <div>
        <h1>3D File Conversion</h1>
        <p class="subtitle">Convert CAD &amp; mesh files (IFC, STEP, IGES, OBJ, FBX, STL, DAE, PLY…) into an
          optimized GLB for the AR tablet, web portal, and app.</p>
      </div>
    </div>

    @if (canEdit) {
      <mat-card class="clay-card upload-panel">
        <mat-card-content>
          <div class="drop-zone"
               [class.drag-over]="isDragOver"
               (dragover)="onDragOver($event)"
               (dragleave)="isDragOver = false"
               (drop)="onDrop($event)"
               (click)="fileInput.click()">
            <mat-icon class="drop-icon">view_in_ar</mat-icon>
            <span>Drop 3D files or a ZIP here, or click to browse</span>
            @if (selectedFiles.length === 1) {
              <span class="file-name">{{ selectedFiles[0].name }} ({{ formatSize(selectedFiles[0].size) }})</span>
            } @else if (selectedFiles.length > 1) {
              <span class="file-name">{{ selectedFiles.length }} files selected</span>
            }
            <input #fileInput type="file" [accept]="acceptExts + ',.zip'" multiple hidden (change)="onFileSelected($event)">
          </div>

          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Model name</mat-label>
            <input matInput [(ngModel)]="name" placeholder="e.g. Area-A Steel Assembly">
          </mat-form-field>

          <div class="options-row">
            <mat-form-field appearance="outline">
              <mat-label>Detail level</mat-label>
              <mat-select [(ngModel)]="simplifyRatio">
                <mat-option [value]="1">Full detail</mat-option>
                <mat-option [value]="0.5">Balanced (recommended)</mat-option>
                <mat-option [value]="0.25">Light — fastest in AR</mat-option>
              </mat-select>
            </mat-form-field>

            <mat-form-field appearance="outline">
              <mat-label>Type</mat-label>
              <mat-select [(ngModel)]="modelType">
                <mat-option value="assembly">Assembly</mat-option>
                <mat-option value="quality">Quality</mat-option>
              </mat-select>
            </mat-form-field>
          </div>

          <div class="options-row">
            <mat-form-field appearance="outline">
              <mat-label>Source units</mat-label>
              <mat-select [(ngModel)]="sourceUnit"
                matTooltip="The model is scaled to real-world metres for AR. Steel CAD is usually millimetres.">
                <mat-option value="mm">Millimeters (CAD / Tekla)</mat-option>
                <mat-option value="cm">Centimeters</mat-option>
                <mat-option value="m">Meters</mat-option>
                <mat-option value="in">Inches</mat-option>
                <mat-option value="ft">Feet</mat-option>
              </mat-select>
            </mat-form-field>

            <mat-form-field appearance="outline">
              <mat-label>Up axis</mat-label>
              <mat-select [(ngModel)]="upAxis">
                <mat-option value="Z">Z-up (CAD / IFC)</mat-option>
                <mat-option value="Y">Y-up (glTF / mesh)</mat-option>
              </mat-select>
            </mat-form-field>
          </div>

          <div class="toggles">
            <mat-slide-toggle [(ngModel)]="optimize"
              matTooltip="Decimate geometry and compress textures for smooth AR playback">
              Optimize for AR
            </mat-slide-toggle>
            <mat-slide-toggle [(ngModel)]="draco"
              matTooltip="Extra geometry compression for the web portal (model-viewer). Leave off for Viro AR.">
              Draco compression (web)
            </mat-slide-toggle>
          </div>

          @if (uploadProgress >= 0) {
            <mat-progress-bar mode="determinate" [value]="uploadProgress"></mat-progress-bar>
            <p class="progress-text">Uploading… {{ uploadProgress }}%</p>
          }

          <div class="upload-actions">
            <button mat-raised-button color="primary"
                    [disabled]="!selectedFiles.length || uploadProgress >= 0 || isProcessing()"
                    (click)="upload()">
              <mat-icon>bolt</mat-icon>
              Convert to GLB
            </button>
          </div>
        </mat-card-content>
      </mat-card>
    } @else {
      <mat-card class="clay-card"><mat-card-content>
        <p>You don't have permission to upload conversions.</p>
      </mat-card-content></mat-card>
    }

    @if (activeJob) {
      <mat-card class="clay-card active-job"
                [class.is-error]="activeJob.status === 'failed'"
                [class.is-done]="activeJob.status === 'completed'">
        <mat-card-content>
          <div class="active-header">
            <mat-icon>{{ statusIcon(activeJob.status) }}</mat-icon>
            <div class="active-meta">
              <strong>{{ activeJob.originalName }}</strong>
              <span>{{ statusLabel(activeJob.status) }}</span>
            </div>
          </div>

          @if (activeJob.status !== 'completed' && activeJob.status !== 'failed') {
            <mat-progress-bar mode="determinate" [value]="activeJob.progress"></mat-progress-bar>
          }

          @if (activeJob.status === 'completed') {
            <div class="result-stats">
              @if (reductionPct(activeJob) !== null) {
                <div class="stat"><mat-icon>compress</mat-icon>
                  <span>{{ reductionPct(activeJob) }}% fewer triangles
                    ({{ activeJob.trianglesBefore | number }} → {{ activeJob.trianglesAfter | number }})</span>
                </div>
              }
              @if (activeJob.outputSize) {
                <div class="stat"><mat-icon>save</mat-icon><span>{{ formatSize(activeJob.outputSize) }} GLB</span></div>
              }
              @if (activeJob.dimensions) {
                <div class="stat"><mat-icon>straighten</mat-icon><span>{{ formatDims(activeJob.dimensions) }}</span></div>
              }
            </div>
            @if (activeJob.modelId) {
              <a mat-stroked-button color="primary" [href]="api.modelFileUrl(activeJob.modelId)" target="_blank">
                <mat-icon>download</mat-icon> Download GLB
              </a>
            }
            @if (previewUrl) {
              <div class="preview">
                <app-three-viewer [modelUrl]="previewUrl"></app-three-viewer>
              </div>
            }
          }

          @if (activeJob.status === 'failed') {
            <p class="error-text">{{ activeJob.error || 'Conversion failed.' }}</p>
          }
        </mat-card-content>
      </mat-card>
    }

    <h2 class="section-title">Recent conversions</h2>
    <div class="jobs-list">
      @for (job of jobs; track job.id) {
        <mat-card class="clay-card job-row">
          <mat-card-content>
            <span class="fmt-chip">{{ job.sourceFormat }}</span>
            <span class="job-name">{{ job.originalName }}</span>
            <span class="status-chip" [class]="'status-' + job.status">{{ statusLabel(job.status) }}</span>
            @if (job.modelId && qaByModel[job.modelId] && qaByModel[job.modelId].total) {
              <span class="qa-chip" matTooltip="QA inspections — pass / warning / fail">
                <span class="qa-seg pass">{{ qaByModel[job.modelId].pass }}</span>
                <span class="qa-seg warning">{{ qaByModel[job.modelId].warning }}</span>
                <span class="qa-seg fail">{{ qaByModel[job.modelId].fail }}</span>
              </span>
            }
            <span class="job-date">{{ job.createdAt | date:'short' }}</span>
            @if (job.modelId && job.status === 'completed') {
              <a mat-icon-button [href]="api.modelFileUrl(job.modelId)" target="_blank" matTooltip="Download GLB">
                <mat-icon>download</mat-icon>
              </a>
            }
            @if (job.status === 'failed' && canEdit) {
              <button mat-icon-button color="warn" (click)="retry(job)" matTooltip="Retry conversion">
                <mat-icon>refresh</mat-icon>
              </button>
            }
          </mat-card-content>
        </mat-card>
      }
      @if (jobs.length === 0) {
        <div class="empty-state">
          <mat-icon>view_in_ar</mat-icon>
          <p>No conversions yet. Upload a file above to get started.</p>
        </div>
      }
    </div>
  `,
  styles: [`
    .page-header { margin-bottom: 24px; }
    .page-header h1 { margin: 0; color: var(--clay-text); }
    .subtitle { color: var(--clay-text-muted); margin: 4px 0 0; font-size: 14px; max-width: 760px; }
    .clay-card {
      background: var(--clay-surface); border-radius: var(--clay-radius);
      box-shadow: var(--clay-shadow-raised); border: 1px solid var(--clay-border);
    }
    .upload-panel { margin-bottom: 20px; }
    .full-width { width: 100%; }
    .drop-zone {
      border: 2px dashed var(--clay-border); border-radius: var(--clay-radius-sm);
      padding: 36px; text-align: center; cursor: pointer;
      display: flex; flex-direction: column; align-items: center; gap: 8px;
      transition: all 0.2s; color: var(--clay-text-muted); margin-bottom: 16px;
    }
    .drop-zone:hover, .drag-over { border-color: var(--clay-primary); background: var(--clay-bg); }
    .drop-icon { font-size: 44px; width: 44px; height: 44px; color: var(--clay-primary); }
    .file-name { font-weight: 600; color: var(--clay-text); }
    .options-row { display: flex; gap: 16px; flex-wrap: wrap; }
    .options-row mat-form-field { flex: 1; min-width: 200px; }
    .toggles { display: flex; gap: 24px; flex-wrap: wrap; margin: 4px 0 12px; }
    .progress-text { font-size: 13px; color: var(--clay-text-muted); }
    .upload-actions { display: flex; justify-content: flex-end; margin-top: 8px; }
    .active-job { margin-bottom: 24px; }
    .active-job.is-done { border-color: var(--success-text, #2e7d32); }
    .active-job.is-error { border-color: var(--danger, #c62828); }
    .active-header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
    .active-header mat-icon { color: var(--clay-primary); }
    .active-meta { display: flex; flex-direction: column; }
    .active-meta span { font-size: 13px; color: var(--clay-text-muted); }
    .result-stats { display: flex; gap: 20px; flex-wrap: wrap; margin: 8px 0 12px; }
    .preview { height: 440px; margin-top: 12px; }
    .stat { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--clay-text-secondary); }
    .stat mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .error-text { color: var(--danger, #c62828); font-size: 13px; }
    .section-title { color: var(--clay-text); font-size: 16px; margin: 8px 0 12px; }
    .jobs-list { display: flex; flex-direction: column; gap: 8px; }
    .job-row mat-card-content { display: flex; align-items: center; gap: 12px; padding: 10px 14px; }
    .fmt-chip {
      text-transform: uppercase; font-size: 11px; font-weight: 700; letter-spacing: .5px;
      background: var(--clay-bg); border: 1px solid var(--clay-border);
      border-radius: 6px; padding: 2px 8px; color: var(--clay-text-secondary);
    }
    .job-name { flex: 1; color: var(--clay-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .status-chip { padding: 3px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; text-transform: uppercase; }
    .status-completed { background: var(--success-bg); color: var(--success-text); }
    .status-failed { background: var(--danger-bg); color: var(--danger-text); }
    .status-pending, .status-converting, .status-optimizing, .status-uploading {
      background: var(--warning-bg); color: var(--warning-text);
    }
    .job-date { font-size: 12px; color: var(--clay-text-muted); }
    .empty-state { text-align: center; padding: 40px 20px; color: var(--clay-text-muted); }
    .empty-state mat-icon { font-size: 56px; width: 56px; height: 56px; }
    .qa-chip { display: inline-flex; gap: 3px; }
    .qa-seg { font-size: 11px; font-weight: 700; padding: 1px 6px; border-radius: 8px; }
    .qa-seg.pass { background: var(--success-bg); color: var(--success-text); }
    .qa-seg.warning { background: var(--warning-bg); color: var(--warning-text); }
    .qa-seg.fail { background: var(--danger-bg); color: var(--danger-text); }
  `]
})
export class ConversionUploadComponent implements OnInit, OnDestroy {
  acceptExts = '.ifc,.step,.stp,.iges,.igs,.obj,.fbx,.dae,.stl,.ply,.3ds,.gltf,.glb';
  formats: SupportedFormat[] = [];

  selectedFiles: File[] = [];
  name = '';
  modelType: 'assembly' | 'quality' = 'assembly';
  optimize = true;
  draco = false;
  simplifyRatio = 0.5;
  sourceUnit = 'mm';
  upAxis: 'Y' | 'Z' = 'Z';
  isDragOver = false;

  uploadProgress = -1;
  activeJob: ActiveJob | null = null;
  previewUrl: string | null = null;
  jobs: ConversionJob[] = [];
  qaByModel: Record<string, { total: number; pass: number; fail: number; warning: number }> = {};
  canEdit = false;

  private subs: Subscription[] = [];
  private pollTimer: any = null;

  constructor(
    public api: ConversionApiService,
    private realtime: RealtimeService,
    private permissions: PermissionsService,
    private snackBar: MatSnackBar,
  ) {
    this.canEdit = this.permissions.canManage('coordination');
  }

  ngOnInit(): void {
    this.loadJobs();
    this.api.getFormats().subscribe({
      next: (f) => {
        if (f?.input?.length) this.acceptExts = f.input.map((i) => i.extension).join(',');
        this.formats = f?.input || [];
      },
      error: () => { /* keep static defaults */ },
    });

    // Live progress for the in-flight job + any row in the recent list (shared socket).
    this.subs.push(
      this.realtime.on<ConversionProgress>('conversion:progress').subscribe((p) => {
        this.applyProgress(p);
        this.updateJobInList(p);
      }),
    );
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
    this.stopPoll();
  }

  loadJobs(): void {
    this.api.list().subscribe({
      next: (data) => { this.jobs = data || []; this.loadQaBadges(); },
      error: () => { this.jobs = []; },
    });
  }

  private loadQaBadges(): void {
    const ids = Array.from(new Set(
      this.jobs.filter((j) => j.status === 'completed' && j.modelId).map((j) => j.modelId as string),
    ));
    if (!ids.length) return;
    this.api.qaSummaryBatch(ids).subscribe({
      next: (map) => { this.qaByModel = map || {}; },
      error: () => { /* QA chips are best-effort */ },
    });
  }

  retry(job: ConversionJob): void {
    this.api.retry(job.id).subscribe({
      next: () => {
        this.snackBar.open('Re-queued conversion.', 'OK', { duration: 2500 });
        this.updateJobInList({ jobId: job.id, status: 'pending', progress: 0 });
        this.startPoll(job.id);
      },
      error: (err) => this.snackBar.open('Retry failed: ' + (err.error?.message || err.message), 'Close', { duration: 5000 }),
    });
  }

  // ── File selection ─────────────────────────────────────────────────────
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files?.length) {
      this.selectedFiles = Array.from(input.files);
      const first = this.selectedFiles[0];
      if (!this.name && this.selectedFiles.length === 1) this.name = first.name.replace(/\.[^.]+$/, '');
      this.applyFormatDefaults(first.name);
    }
  }

  onDragOver(event: DragEvent): void { event.preventDefault(); this.isDragOver = true; }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver = false;
    if (event.dataTransfer?.files.length) {
      this.selectedFiles = Array.from(event.dataTransfer.files);
      const first = this.selectedFiles[0];
      if (!this.name && this.selectedFiles.length === 1) this.name = first.name.replace(/\.[^.]+$/, '');
      this.applyFormatDefaults(first.name);
    }
  }

  /** CAD/IFC default to millimetres + Z-up; mesh formats to metres + Y-up. */
  private applyFormatDefaults(filename: string): void {
    const ext = (filename.split('.').pop() || '').toLowerCase();
    const isCad = ['step', 'stp', 'iges', 'igs', 'ifc'].includes(ext);
    this.sourceUnit = isCad ? 'mm' : 'm';
    this.upAxis = isCad ? 'Z' : 'Y';
  }

  // ── Upload + convert ───────────────────────────────────────────────────
  upload(): void {
    if (!this.selectedFiles.length) return;
    const isBatch = this.selectedFiles.length > 1 ||
      this.selectedFiles.some((f) => f.name.toLowerCase().endsWith('.zip'));
    this.uploadProgress = 0;
    this.previewUrl = null;

    const opts = {
      name: this.name,
      modelType: this.modelType,
      optimize: this.optimize,
      simplifyRatio: this.simplifyRatio,
      draco: this.draco,
      sourceUnit: this.sourceUnit,
      upAxis: this.upAxis,
    };

    if (isBatch) {
      this.api.convertBatch(this.selectedFiles, opts).subscribe({
        next: (event) => {
          if (event.type === HttpEventType.UploadProgress && event.total) {
            this.uploadProgress = Math.round((event.loaded / event.total) * 100);
          }
          if (event.type === HttpEventType.Response) {
            const body = event.body as { count: number } | null;
            this.uploadProgress = -1;
            this.activeJob = null;
            this.selectedFiles = [];
            this.snackBar.open(`Queued ${body?.count ?? 0} conversion(s). Watch progress below.`, 'OK', { duration: 4000 });
            this.loadJobs();
          }
        },
        error: (err) => {
          this.uploadProgress = -1;
          this.snackBar.open('Upload failed: ' + (err.error?.message || err.message), 'Close', { duration: 6000 });
        },
      });
      return;
    }

    const file = this.selectedFiles[0];
    this.api.convert(file, opts).subscribe({
      next: (event) => {
        if (event.type === HttpEventType.UploadProgress && event.total) {
          this.uploadProgress = Math.round((event.loaded / event.total) * 100);
        }
        if (event.type === HttpEventType.Response) {
          const body = event.body as { jobId: string; status: string } | null;
          this.uploadProgress = -1;
          if (body?.jobId) {
            this.activeJob = {
              id: body.jobId, status: body.status || 'pending', progress: 0,
              originalName: file.name,
            };
            this.startPoll(body.jobId);
            this.snackBar.open('Conversion queued.', 'OK', { duration: 3000 });
          }
          this.selectedFiles = [];
          this.loadJobs();
        }
      },
      error: (err) => {
        this.uploadProgress = -1;
        this.snackBar.open('Upload failed: ' + (err.error?.message || err.message), 'Close', { duration: 6000 });
      },
    });
  }

  // ── Progress handling ──────────────────────────────────────────────────
  private applyProgress(p: ConversionProgress): void {
    if (!this.activeJob || p.jobId !== this.activeJob.id) return;
    this.activeJob = {
      ...this.activeJob,
      status: p.status,
      progress: p.progress ?? this.activeJob.progress,
      modelId: p.modelId ?? this.activeJob.modelId,
      trianglesBefore: p.trianglesBefore ?? this.activeJob.trianglesBefore,
      trianglesAfter: p.trianglesAfter ?? this.activeJob.trianglesAfter,
      dimensions: p.dimensions ?? this.activeJob.dimensions,
      error: p.error ?? this.activeJob.error,
    };
    if (p.status === 'completed' || p.status === 'failed') {
      this.stopPoll();
      this.loadJobs();
      if (p.status === 'completed' && this.activeJob.modelId) {
        this.previewUrl = this.api.modelFileUrl(this.activeJob.modelId);
      }
    }
  }

  private startPoll(id: string): void {
    this.stopPoll();
    // Fallback to polling in case a socket event is missed.
    this.pollTimer = setInterval(() => {
      this.api.getJob(id).subscribe({
        next: (job) => {
          const p = {
            jobId: job.id, status: job.status, progress: job.progress,
            modelId: job.modelId, trianglesBefore: job.trianglesBefore,
            trianglesAfter: job.trianglesAfter, dimensions: job.dimensions, error: job.error,
          };
          this.applyProgress(p);
          this.updateJobInList(p);
          if (job.status === 'completed' || job.status === 'failed') { this.stopPoll(); this.loadJobs(); }
        },
        error: () => { /* keep trying until terminal */ },
      });
    }, 2500);
  }

  private stopPoll(): void {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
  }

  /** Reflect live progress on the matching row in the recent-conversions list. */
  private updateJobInList(p: ConversionProgress): void {
    const idx = this.jobs.findIndex((j) => j.id === p.jobId);
    if (idx < 0) return;
    this.jobs[idx] = {
      ...this.jobs[idx],
      status: p.status as ConversionJob['status'],
      progress: p.progress ?? this.jobs[idx].progress,
      modelId: p.modelId ?? this.jobs[idx].modelId,
      trianglesBefore: p.trianglesBefore ?? this.jobs[idx].trianglesBefore,
      trianglesAfter: p.trianglesAfter ?? this.jobs[idx].trianglesAfter,
      dimensions: p.dimensions ?? this.jobs[idx].dimensions,
      error: p.error ?? this.jobs[idx].error,
    };
    this.jobs = [...this.jobs];
  }

  isProcessing(): boolean {
    return !!this.activeJob &&
      ['pending', 'converting', 'optimizing', 'uploading'].includes(this.activeJob.status);
  }

  reductionPct(j: ActiveJob): number | null {
    if (j.trianglesBefore && j.trianglesAfter && j.trianglesBefore > 0) {
      return Math.round((1 - j.trianglesAfter / j.trianglesBefore) * 100);
    }
    return null;
  }

  statusLabel(s: string): string {
    switch (s) {
      case 'pending': return 'Queued';
      case 'converting': return 'Converting to GLB…';
      case 'optimizing': return 'Optimizing for AR…';
      case 'uploading': return 'Saving model…';
      case 'completed': return 'Completed';
      case 'failed': return 'Failed';
      default: return s;
    }
  }

  statusIcon(s: string): string {
    switch (s) {
      case 'completed': return 'check_circle';
      case 'failed': return 'error';
      default: return 'autorenew';
    }
  }

  formatDims(d: { x: number; y: number; z: number } | null | undefined): string {
    if (!d) return '';
    const max = Math.max(d.x, d.y, d.z);
    const useM = max >= 1;
    const k = useM ? 1 : 1000;
    const r = (v: number) => (v * k).toFixed(useM ? 2 : 0);
    return `${r(d.x)} × ${r(d.y)} × ${r(d.z)} ${useM ? 'm' : 'mm'}`;
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }
}
