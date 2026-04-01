import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatListModule } from '@angular/material/list';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ThreeViewerComponent } from '../shared/components/three-viewer/three-viewer.component';
import { CoordinationApiService, CoordinationPackage, Drawing } from '../core/services/coordination.service';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../environments/environment';

@Component({
  selector: 'app-coordination-view',
  standalone: true,
  imports: [
    CommonModule, RouterModule,
    MatCardModule, MatButtonModule, MatIconModule, MatTabsModule,
    MatListModule, MatChipsModule, MatProgressBarModule, MatTooltipModule,
    ThreeViewerComponent,
  ],
  template: `
    <div class="view-header">
      <button mat-icon-button routerLink="/coordination">
        <mat-icon>arrow_back</mat-icon>
      </button>
      <div>
        <h1>{{ pkg?.name || 'Loading...' }}</h1>
        @if (pkg?.projectName) {
          <span class="project-name">{{ pkg!.projectName }}</span>
        }
      </div>
      <span class="status-chip" [class]="'status-' + (pkg?.status || 'processing')">
        {{ pkg?.status }}
      </span>
    </div>

    @if (pkg?.status === 'processing') {
      <mat-card class="clay-card processing-card">
        <mat-progress-bar mode="indeterminate"></mat-progress-bar>
        <p>{{ processingMessage || 'Processing coordination package...' }}</p>
      </mat-card>
    }

    @if (pkg?.status === 'error') {
      <mat-card class="clay-card error-card">
        <mat-icon>error</mat-icon>
        <p>{{ pkg!.errorMessage }}</p>
      </mat-card>
    }

    @if (pkg?.status === 'ready') {
      <div class="coordination-layout">
        <!-- 3D Viewer -->
        <div class="viewer-panel">
          <app-three-viewer
            [modelUrl]="modelUrl"
            (meshClicked)="onMeshClicked($event)">
          </app-three-viewer>
        </div>

        <!-- Side Panel: Drawings + KSS Data -->
        <div class="side-panel">
          <mat-tab-group>
            <!-- Drawings Tab -->
            <mat-tab>
              <ng-template mat-tab-label>
                <mat-icon>description</mat-icon>
                Drawings ({{ drawings.length }})
              </ng-template>

              <div class="tab-scroll-content">
                <div class="drawings-filter">
                  <mat-chip-listbox [value]="drawingFilter" (change)="onFilterChange($event)">
                    <mat-chip-option value="all">All</mat-chip-option>
                    <mat-chip-option value="detail">Detail ({{ detailDrawings.length }})</mat-chip-option>
                    <mat-chip-option value="erection">Erection ({{ erectionDrawings.length }})</mat-chip-option>
                  </mat-chip-listbox>
                </div>

                <div class="drawings-list">
                  @for (drawing of filteredDrawings; track drawing.id) {
                    <div class="drawing-item" (click)="openDrawing(drawing)"
                         [class.active]="selectedDrawing?.id === drawing.id">
                      <mat-icon class="drawing-icon">picture_as_pdf</mat-icon>
                      <div class="drawing-info">
                        <span class="drawing-name">{{ drawing.drawingNumber || drawing.name }}</span>
                        <span class="drawing-meta">
                          {{ drawing.drawingType | titlecase }}
                          @if (drawing.revision) { &middot; Rev {{ drawing.revision }} }
                        </span>
                      </div>
                    </div>
                  }
                </div>
              </div>
            </mat-tab>

            <!-- KSS Data Tab -->
            @if (pkg!.kssData) {
              <mat-tab>
                <ng-template mat-tab-label>
                  <mat-icon>data_object</mat-icon>
                  KSS Data
                </ng-template>

                <div class="tab-scroll-content">
                  <div class="kss-info">
                    <p><strong>Members:</strong> {{ pkg!.kssData.memberCount }}</p>
                    <p><strong>Source:</strong> {{ pkg!.kssFileName }}</p>
                  </div>

                  @if (pkg!.kssData.members) {
                    <div class="kss-table-wrap">
                      <table class="kss-table">
                        <thead>
                          <tr>
                            @for (h of pkg!.kssData.headers; track h) {
                              <th>{{ h }}</th>
                            }
                          </tr>
                        </thead>
                        <tbody>
                          @for (member of kssMembers; track $index) {
                            <tr>
                              @for (h of pkg!.kssData.headers; track h) {
                                <td>{{ member[h] || '' }}</td>
                              }
                            </tr>
                          }
                        </tbody>
                      </table>
                    </div>
                  }
                </div>
              </mat-tab>
            }

            <!-- Info Tab -->
            <mat-tab>
              <ng-template mat-tab-label>
                <mat-icon>info</mat-icon>
                Info
              </ng-template>

              <div class="tab-scroll-content">
                <div class="info-panel">
                  <div class="info-row"><strong>Package:</strong> {{ pkg!.name }}</div>
                  <div class="info-row"><strong>Source File:</strong> {{ pkg!.sourceFile }}</div>
                  <div class="info-row"><strong>Detail Drawings:</strong> {{ pkg!.detailDrawingCount }}</div>
                  <div class="info-row"><strong>Erection Drawings:</strong> {{ pkg!.erectionDrawingCount }}</div>
                  <div class="info-row"><strong>Created:</strong> {{ pkg!.createdAt | date:'medium' }}</div>
                </div>
              </div>
            </mat-tab>
          </mat-tab-group>
        </div>
      </div>

      <!-- PDF Viewer Overlay -->
      @if (selectedDrawing && safePdfUrl) {
        <div class="pdf-overlay" (click)="closeDrawing()">
          <div class="pdf-container" (click)="$event.stopPropagation()">
            <div class="pdf-header">
              <div class="pdf-title-info">
                <h3>{{ selectedDrawing.drawingNumber || selectedDrawing.name }}</h3>
                <span class="pdf-subtitle">
                  {{ selectedDrawing.drawingType | titlecase }}
                  @if (selectedDrawing.revision) { &middot; Rev {{ selectedDrawing.revision }} }
                </span>
              </div>
              <button mat-icon-button (click)="closeDrawing()">
                <mat-icon>close</mat-icon>
              </button>
            </div>
            <iframe [src]="safePdfUrl" class="pdf-frame"></iframe>
          </div>
        </div>
      }
    }
  `,
  styles: [`
    .view-header {
      display: flex; align-items: center; gap: 12px; margin-bottom: 24px;
    }
    .view-header h1 { margin: 0; color: var(--clay-text); }
    .project-name { font-size: 13px; color: var(--clay-text-muted); }
    .status-chip {
      margin-left: auto; padding: 4px 12px; border-radius: 12px;
      font-size: 12px; font-weight: 600; text-transform: uppercase;
    }
    .status-ready { background: #e8f5e9; color: #2e7d32; }
    .status-processing { background: #fff3e0; color: #e65100; }
    .status-error { background: #fbe9e7; color: #c62828; }
    .clay-card {
      background: var(--clay-surface); border-radius: var(--clay-radius);
      box-shadow: var(--clay-shadow-raised); border: 1px solid var(--clay-border);
    }
    .processing-card, .error-card { padding: 24px; text-align: center; }
    .error-card { color: #c62828; }

    /* Main layout */
    .coordination-layout {
      display: grid;
      grid-template-columns: 1fr 400px;
      gap: 16px;
      height: calc(100vh - 180px);
    }
    .viewer-panel { min-height: 500px; }

    /* Side panel */
    .side-panel {
      background: var(--clay-surface);
      border-radius: var(--clay-radius);
      box-shadow: var(--clay-shadow-raised);
      border: 1px solid var(--clay-border);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .side-panel ::ng-deep .mat-mdc-tab-group {
      display: flex; flex-direction: column; height: 100%;
    }
    .side-panel ::ng-deep .mat-mdc-tab-body-wrapper {
      flex: 1; overflow: hidden;
    }
    .side-panel ::ng-deep .mat-mdc-tab-body-content {
      height: 100%; overflow: hidden;
    }

    /* Scrollable tab content */
    .tab-scroll-content {
      height: 100%;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
    }

    /* Drawings */
    .drawings-filter {
      padding: 12px 16px 8px;
      position: sticky; top: 0; z-index: 1;
      background: var(--clay-surface);
    }
    .drawings-list {
      flex: 1;
      padding: 0 8px 8px;
    }
    .drawing-item {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 12px; cursor: pointer;
      border-radius: 8px; transition: background 0.15s;
    }
    .drawing-item:hover { background: var(--clay-bg, #faf7f2); }
    .drawing-item.active {
      background: rgba(107, 92, 231, 0.08);
      border-left: 3px solid var(--clay-primary, #6b5ce7);
    }
    .drawing-icon {
      font-size: 20px; width: 20px; height: 20px;
      color: var(--clay-text-muted);
    }
    .drawing-info { display: flex; flex-direction: column; }
    .drawing-name { font-size: 13px; font-weight: 500; color: var(--clay-text); }
    .drawing-meta { font-size: 11px; color: var(--clay-text-muted); }

    /* KSS */
    .kss-info { padding: 16px; }
    .kss-table-wrap { overflow: auto; padding: 0 8px 8px; }
    .kss-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .kss-table th, .kss-table td {
      padding: 6px 8px; border: 1px solid var(--clay-border); white-space: nowrap;
    }
    .kss-table th {
      background: var(--clay-bg); font-weight: 600;
      position: sticky; top: 0; z-index: 1;
    }

    /* Info */
    .info-panel { padding: 16px; }
    .info-row { padding: 8px 0; border-bottom: 1px solid var(--clay-border); font-size: 13px; }

    /* PDF overlay */
    .pdf-overlay {
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.6); z-index: 1000;
      display: flex; align-items: center; justify-content: center;
    }
    .pdf-container {
      width: 80vw; height: 85vh;
      background: var(--clay-surface);
      border-radius: var(--clay-radius);
      overflow: hidden;
      display: flex; flex-direction: column;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    }
    .pdf-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 16px; border-bottom: 1px solid var(--clay-border);
    }
    .pdf-header h3 { margin: 0; }
    .pdf-title-info { display: flex; flex-direction: column; }
    .pdf-subtitle { font-size: 12px; color: var(--clay-text-muted); }
    .pdf-frame { flex: 1; border: none; width: 100%; }
  `]
})
export class CoordinationViewComponent implements OnInit, OnDestroy {
  pkg: CoordinationPackage | null = null;
  drawings: Drawing[] = [];
  filteredDrawings: Drawing[] = [];
  detailDrawings: Drawing[] = [];
  erectionDrawings: Drawing[] = [];
  drawingFilter = 'all';

  modelUrl: string | null = null;
  selectedDrawing: Drawing | null = null;
  safePdfUrl: SafeResourceUrl | null = null;
  processingMessage = '';

  kssMembers: any[] = [];

  private socket: Socket | null = null;

  constructor(
    private route: ActivatedRoute,
    private api: CoordinationApiService,
    private sanitizer: DomSanitizer,
  ) {}

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id')!;
    this.loadPackage(id);
    this.connectWebSocket(id);
  }

  ngOnDestroy(): void {
    this.socket?.disconnect();
  }

  loadPackage(id: string): void {
    this.api.getOne(id).subscribe((pkg) => {
      this.pkg = pkg;

      if (pkg.modelId) {
        this.modelUrl = `/api/models/${pkg.modelId}/file`;
      }

      if (pkg.kssData?.members) {
        this.kssMembers = pkg.kssData.members.slice(0, 100);
      }

      if (pkg.status === 'ready') {
        this.loadDrawings(id);
      }
    });
  }

  loadDrawings(packageId: string): void {
    this.api.getDrawings(packageId).subscribe((drawings) => {
      this.drawings = drawings;
      this.detailDrawings = drawings.filter(d => d.drawingType === 'detail');
      this.erectionDrawings = drawings.filter(d => d.drawingType === 'erection');
      this.filterDrawings();
    });
  }

  onFilterChange(event: any): void {
    this.drawingFilter = event.value || 'all';
    this.filterDrawings();
  }

  filterDrawings(): void {
    if (this.drawingFilter === 'detail') {
      this.filteredDrawings = this.detailDrawings;
    } else if (this.drawingFilter === 'erection') {
      this.filteredDrawings = this.erectionDrawings;
    } else {
      this.filteredDrawings = this.drawings;
    }
  }

  openDrawing(drawing: Drawing): void {
    this.selectedDrawing = drawing;
    const url = this.api.getDrawingUrl(drawing.id);
    this.safePdfUrl = this.sanitizer.bypassSecurityTrustResourceUrl(url);
  }

  closeDrawing(): void {
    this.selectedDrawing = null;
    this.safePdfUrl = null;
  }

  onMeshClicked(meshName: string): void {
    console.log('Mesh clicked:', meshName);
  }

  private connectWebSocket(packageId: string): void {
    const wsUrl = environment.apiUrl.replace('/api', '');
    this.socket = io(wsUrl, { transports: ['websocket', 'polling'] });
    this.socket.on('coordination:progress', (data: { packageId: string; status: string; message: string }) => {
      if (data.packageId === packageId) {
        this.processingMessage = data.message;
        if (data.status === 'ready' || data.status === 'error') {
          this.loadPackage(packageId);
        }
      }
    });
  }
}
