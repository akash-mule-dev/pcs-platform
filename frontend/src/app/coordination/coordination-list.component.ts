import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { HttpEventType } from '@angular/common/http';
import { CoordinationApiService, CoordinationPackage } from '../core/services/coordination.service';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../environments/environment';

@Component({
  selector: 'app-coordination-list',
  standalone: true,
  imports: [
    CommonModule, RouterModule, FormsModule,
    MatCardModule, MatButtonModule, MatIconModule, MatProgressBarModule,
    MatChipsModule, MatFormFieldModule, MatInputModule, MatDialogModule, MatSnackBarModule,
  ],
  template: `
    <div class="page-header">
      <div>
        <h1>Coordination Packages</h1>
        <p class="subtitle">Upload and manage IFC coordination views with linked drawings</p>
      </div>
      <button mat-raised-button color="primary" (click)="showUploadPanel = !showUploadPanel">
        <mat-icon>cloud_upload</mat-icon>
        Upload Package
      </button>
    </div>

    @if (showUploadPanel) {
      <mat-card class="upload-panel clay-card">
        <mat-card-content>
          <h3>Upload Coordination Package</h3>
          <p class="hint">Upload a ZIP file containing an IFC model, PDF drawings, and KSS file.</p>

          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Package Name</mat-label>
            <input matInput [(ngModel)]="uploadName" placeholder="e.g. TWHS Area-A QC Test">
          </mat-form-field>

          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Description (optional)</mat-label>
            <textarea matInput [(ngModel)]="uploadDescription" rows="2"></textarea>
          </mat-form-field>

          <div class="drop-zone"
               [class.drag-over]="isDragOver"
               (dragover)="onDragOver($event)"
               (dragleave)="isDragOver = false"
               (drop)="onDrop($event)"
               (click)="fileInput.click()">
            <mat-icon class="drop-icon">archive</mat-icon>
            <span>Drop ZIP file here or click to browse</span>
            @if (selectedFile) {
              <span class="file-name">{{ selectedFile.name }} ({{ formatSize(selectedFile.size) }})</span>
            }
            <input #fileInput type="file" accept=".zip" hidden (change)="onFileSelected($event)">
          </div>

          @if (uploadProgress >= 0) {
            <mat-progress-bar mode="determinate" [value]="uploadProgress"></mat-progress-bar>
            <p class="progress-text">{{ uploadStatus }}</p>
          }

          <div class="upload-actions">
            <button mat-button (click)="showUploadPanel = false">Cancel</button>
            <button mat-raised-button color="primary"
                    [disabled]="!selectedFile || !uploadName || uploadProgress >= 0"
                    (click)="upload()">
              <mat-icon>upload</mat-icon>
              Upload
            </button>
          </div>
        </mat-card-content>
      </mat-card>
    }

    <div class="packages-grid">
      @for (pkg of packages; track pkg.id) {
        <mat-card class="package-card clay-card" [routerLink]="['/coordination', pkg.id]">
          <mat-card-content>
            <div class="package-header">
              <mat-icon class="package-icon">view_in_ar</mat-icon>
              <div>
                <h3>{{ pkg.name }}</h3>
                @if (pkg.projectName) {
                  <span class="project-name">{{ pkg.projectName }}</span>
                }
              </div>
              <span class="status-chip" [class]="'status-' + pkg.status">
                {{ pkg.status }}
              </span>
            </div>

            @if (pkg.status === 'processing') {
              <mat-progress-bar mode="indeterminate"></mat-progress-bar>
              <p class="processing-text">{{ processingMessages[pkg.id] || 'Processing...' }}</p>
            }

            @if (pkg.status === 'ready') {
              <div class="package-stats">
                <div class="stat">
                  <mat-icon>description</mat-icon>
                  <span>{{ pkg.detailDrawingCount }} detail drawings</span>
                </div>
                <div class="stat">
                  <mat-icon>construction</mat-icon>
                  <span>{{ pkg.erectionDrawingCount }} erection drawings</span>
                </div>
                @if (pkg.kssFileName) {
                  <div class="stat">
                    <mat-icon>data_object</mat-icon>
                    <span>KSS data included</span>
                  </div>
                }
              </div>
            }

            @if (pkg.status === 'error') {
              <p class="error-text">{{ pkg.errorMessage }}</p>
            }

            <div class="package-footer">
              <span class="date">{{ pkg.createdAt | date:'medium' }}</span>
              @if (pkg.sourceFile) {
                <span class="source">{{ pkg.sourceFile }}</span>
              }
            </div>
          </mat-card-content>
        </mat-card>
      }

      @if (packages.length === 0 && !loading) {
        <div class="empty-state">
          <mat-icon>folder_open</mat-icon>
          <h3>No coordination packages yet</h3>
          <p>Upload a ZIP file containing IFC models and drawings to get started.</p>
        </div>
      }
    </div>
  `,
  styles: [`
    .page-header {
      display: flex; justify-content: space-between; align-items: flex-start;
      margin-bottom: 24px;
    }
    .page-header h1 { margin: 0; color: var(--clay-text); }
    .subtitle { color: var(--clay-text-muted); margin: 4px 0 0; font-size: 14px; }
    .clay-card {
      background: var(--clay-surface); border-radius: var(--clay-radius);
      box-shadow: var(--clay-shadow-raised); border: 1px solid var(--clay-border);
    }
    .upload-panel { margin-bottom: 24px; }
    .upload-panel h3 { margin: 0 0 4px; }
    .hint { color: var(--clay-text-muted); font-size: 13px; margin-bottom: 16px; }
    .full-width { width: 100%; }
    .drop-zone {
      border: 2px dashed var(--clay-border); border-radius: var(--clay-radius-sm);
      padding: 40px; text-align: center; cursor: pointer;
      display: flex; flex-direction: column; align-items: center; gap: 8px;
      transition: all 0.2s; color: var(--clay-text-muted);
      margin-bottom: 16px;
    }
    .drop-zone:hover, .drag-over { border-color: var(--clay-primary); background: var(--clay-bg); }
    .drop-icon { font-size: 48px; width: 48px; height: 48px; color: var(--clay-primary); }
    .file-name { font-weight: 600; color: var(--clay-text); }
    .progress-text { font-size: 13px; color: var(--clay-text-muted); text-align: center; }
    .upload-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
    .packages-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(400px, 1fr)); gap: 16px; }
    .package-card { cursor: pointer; transition: transform 0.2s, box-shadow 0.2s; }
    .package-card:hover { transform: translateY(-2px); box-shadow: var(--clay-shadow-hover); }
    .package-header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
    .package-header h3 { margin: 0; }
    .package-icon { font-size: 32px; width: 32px; height: 32px; color: var(--clay-primary); }
    .project-name { font-size: 12px; color: var(--clay-text-muted); }
    .status-chip {
      margin-left: auto; padding: 4px 12px; border-radius: 12px;
      font-size: 12px; font-weight: 600; text-transform: uppercase;
    }
    .status-ready { background: #e8f5e9; color: #2e7d32; }
    .status-processing { background: #fff3e0; color: #e65100; }
    .status-error { background: #fbe9e7; color: #c62828; }
    .package-stats { display: flex; flex-wrap: wrap; gap: 12px; margin: 12px 0; }
    .stat { display: flex; align-items: center; gap: 4px; font-size: 13px; color: var(--clay-text-secondary); }
    .stat mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .processing-text { font-size: 13px; color: var(--clay-text-muted); text-align: center; margin-top: 8px; }
    .error-text { color: #c62828; font-size: 13px; }
    .package-footer {
      display: flex; justify-content: space-between; margin-top: 12px;
      padding-top: 8px; border-top: 1px solid var(--clay-border);
      font-size: 12px; color: var(--clay-text-muted);
    }
    .empty-state {
      grid-column: 1 / -1; text-align: center; padding: 60px 20px;
      color: var(--clay-text-muted);
    }
    .empty-state mat-icon { font-size: 64px; width: 64px; height: 64px; }
    .empty-state h3 { margin: 16px 0 8px; color: var(--clay-text); }
  `]
})
export class CoordinationListComponent implements OnInit {
  packages: CoordinationPackage[] = [];
  loading = true;
  showUploadPanel = false;

  // Upload state
  selectedFile: File | null = null;
  uploadName = '';
  uploadDescription = '';
  uploadProgress = -1;
  uploadStatus = '';
  isDragOver = false;

  // WebSocket progress messages per package
  processingMessages: Record<string, string> = {};
  private socket: Socket | null = null;

  constructor(
    private api: CoordinationApiService,
    private snackBar: MatSnackBar,
  ) {}

  ngOnInit(): void {
    this.loadPackages();
    this.connectWebSocket();
  }

  loadPackages(): void {
    this.loading = true;
    this.api.getAll().subscribe({
      next: (data) => { this.packages = data || []; this.loading = false; },
      error: () => { this.packages = []; this.loading = false; },
    });
  }

  // ── Upload ──────────────────────────────────────────────────────────────

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files?.length) this.selectedFile = input.files[0];
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver = true;
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver = false;
    if (event.dataTransfer?.files.length) {
      const file = event.dataTransfer.files[0];
      if (file.name.endsWith('.zip')) {
        this.selectedFile = file;
      }
    }
  }

  upload(): void {
    if (!this.selectedFile || !this.uploadName) return;

    this.uploadProgress = 0;
    this.uploadStatus = 'Uploading...';

    this.api.uploadZip(this.selectedFile, this.uploadName, this.uploadDescription).subscribe({
      next: (event) => {
        if (event.type === HttpEventType.UploadProgress && event.total) {
          this.uploadProgress = Math.round((event.loaded / event.total) * 100);
          this.uploadStatus = `Uploading... ${this.uploadProgress}%`;
        }
        if (event.type === HttpEventType.Response) {
          this.uploadProgress = -1;
          this.uploadStatus = '';
          this.showUploadPanel = false;
          this.selectedFile = null;
          this.uploadName = '';
          this.uploadDescription = '';
          this.snackBar.open('Package uploaded! Processing will continue in the background.', 'OK', { duration: 5000 });
          this.loadPackages();
        }
      },
      error: (err) => {
        this.uploadProgress = -1;
        this.uploadStatus = '';
        this.snackBar.open('Upload failed: ' + (err.error?.message || err.message), 'Close', { duration: 5000 });
      },
    });
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  // ── WebSocket for processing updates ────────────────────────────────────

  private connectWebSocket(): void {
    const wsUrl = environment.apiUrl.replace('/api', '');
    this.socket = io(wsUrl, { transports: ['websocket', 'polling'] });
    this.socket.on('coordination:progress', (data: { packageId: string; status: string; message: string }) => {
      this.processingMessages[data.packageId] = data.message;
      if (data.status === 'ready' || data.status === 'error') {
        this.loadPackages();
      }
    });
  }
}
