import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { ApiService } from '../../core/services/api.service';
import { DurationPipe } from '../../shared/pipes/duration.pipe';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog/confirm-dialog.component';
import { StageDialogComponent } from './stage-dialog.component';

@Component({
  selector: 'app-process-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, MatButtonModule, MatIconModule, MatTooltipModule, DragDropModule, DurationPipe],
  template: `
    <div class="designer-shell">
      <!-- Top Bar -->
      <div class="designer-topbar">
        <div class="topbar-left">
          <a routerLink="/processes" class="back-btn" matTooltip="Back to Processes">
            <mat-icon>arrow_back</mat-icon>
          </a>
          <div class="topbar-breadcrumb">
            <span class="breadcrumb-muted">Processes</span>
            <mat-icon class="breadcrumb-sep">chevron_right</mat-icon>
            <span class="breadcrumb-active">{{ process?.name || 'Loading...' }}</span>
          </div>
        </div>
        <div class="topbar-meta" *ngIf="process">
          <div class="meta-chip">
            <mat-icon>inventory_2</mat-icon>
            <span>{{ process.product?.name }}</span>
          </div>
          <div class="meta-chip mono">
            <span>v{{ process.version }}</span>
          </div>
          <div class="meta-chip mono">
            <span>{{ stages.length }} stages</span>
          </div>
        </div>
      </div>

      <!-- Main Workspace -->
      <div class="workspace">
        <!-- Workflow Canvas -->
        <div class="canvas-area">
          <div class="canvas-grid">
            <!-- Pipeline flow -->
            <div class="pipeline" cdkDropList (cdkDropListDropped)="drop($event)">
              @for (stage of stages; track stage.id; let i = $index; let last = $last) {
                <!-- Connector line (between cards, outside drag items) -->
                @if (i > 0) {
                  <div class="connector">
                    <div class="connector-line"></div>
                    <div class="connector-dot"></div>
                  </div>
                }
                <!-- Draggable Stage Card -->
                <div class="stage-card" cdkDrag
                     [class.stage-selected]="selectedStage?.id === stage.id"
                     (click)="selectStage(stage)">
                  <div class="stage-card-head">
                    <span class="stage-code">S-{{ (i + 1).toString().padStart(2, '0') }}</span>
                    <button class="stage-grip" cdkDragHandle matTooltip="Drag to reorder">
                      <mat-icon>drag_indicator</mat-icon>
                    </button>
                  </div>
                  <div class="stage-card-body">
                    <div class="stage-icon-wrap">
                      <mat-icon>{{ getStageIcon(stage.name) }}</mat-icon>
                    </div>
                    <div class="stage-title">{{ stage.name }}</div>
                  </div>
                  <div class="stage-card-foot">
                    <div class="stage-target">{{ stage.targetTimeSeconds | duration }}</div>
                    <div class="stage-bar">
                      <div class="stage-bar-fill" [class.active]="selectedStage?.id === stage.id"></div>
                    </div>
                  </div>
                  <!-- Drag preview -->
                  <div *cdkDragPreview class="stage-card stage-drag-preview">
                    <div class="stage-card-head">
                      <span class="stage-code">S-{{ (i + 1).toString().padStart(2, '0') }}</span>
                    </div>
                    <div class="stage-card-body">
                      <div class="stage-icon-wrap"><mat-icon>{{ getStageIcon(stage.name) }}</mat-icon></div>
                      <div class="stage-title">{{ stage.name }}</div>
                    </div>
                  </div>
                </div>
              }
            </div>

            <!-- Add stage button (outside the drop list) -->
            <div class="pipeline-add">
              @if (stages.length > 0) {
                <div class="connector">
                  <div class="connector-line connector-line-dashed"></div>
                </div>
              }
              <button class="add-node" (click)="addStage()" matTooltip="Add new stage">
                <mat-icon>add</mat-icon>
              </button>
            </div>

            <!-- Empty state -->
            @if (stages.length === 0) {
              <div class="empty-canvas">
                <div class="empty-icon"><mat-icon>account_tree</mat-icon></div>
                <h3>No stages defined</h3>
                <p>Start building your process by adding the first stage</p>
                <button class="btn-primary" (click)="addStage()">
                  <mat-icon>add</mat-icon> Add First Stage
                </button>
              </div>
            }
          </div>
        </div>

        <!-- Right Detail Panel -->
        <div class="detail-panel" [class.panel-open]="selectedStage">
          @if (selectedStage) {
            <div class="panel-header">
              <h3>Stage Details</h3>
              <button class="icon-btn" (click)="selectedStage = null"><mat-icon>close</mat-icon></button>
            </div>

            <!-- Stage info card -->
            <div class="panel-info-card">
              <div class="info-icon">
                <mat-icon>{{ getStageIcon(selectedStage.name) }}</mat-icon>
              </div>
              <div class="info-content">
                <div class="info-name">{{ selectedStage.name }}</div>
                <div class="info-id">Stage {{ getStageIndex(selectedStage) + 1 }} of {{ stages.length }}</div>
              </div>
            </div>

            <!-- Properties -->
            <div class="panel-section">
              <div class="section-label">Properties</div>
              <div class="prop-list">
                <div class="prop-row">
                  <span class="prop-key">Target Time</span>
                  <span class="prop-val mono">{{ selectedStage.targetTimeSeconds | duration }}</span>
                </div>
                <div class="prop-row">
                  <span class="prop-key">Sequence</span>
                  <span class="prop-val mono">#{{ getStageIndex(selectedStage) + 1 }}</span>
                </div>
                @if (selectedStage.description) {
                  <div class="prop-row prop-row-col">
                    <span class="prop-key">Description</span>
                    <span class="prop-val">{{ selectedStage.description }}</span>
                  </div>
                }
              </div>
            </div>

            <!-- Actions -->
            <div class="panel-actions">
              <button class="btn-outline-full" (click)="editStage(selectedStage)">
                <mat-icon>edit</mat-icon> Edit Stage
              </button>
              <button class="btn-danger-full" (click)="deleteStage(selectedStage)">
                <mat-icon>delete_outline</mat-icon> Delete Stage
              </button>
            </div>
          } @else {
            <div class="panel-empty">
              <mat-icon>touch_app</mat-icon>
              <p>Select a stage to view details</p>
            </div>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    /* ===== Shell ===== */
    .designer-shell {
      display: flex; flex-direction: column;
      height: calc(100vh - 120px); min-height: 500px;
      margin: -24px; /* bleed into page-content padding */
    }

    /* ===== Top Bar ===== */
    .designer-topbar {
      display: flex; justify-content: space-between; align-items: center;
      padding: 16px 24px;
      background: var(--clay-surface);
      border-bottom: 1px solid var(--clay-border);
      flex-shrink: 0;
    }
    .topbar-left { display: flex; align-items: center; gap: 12px; }
    .back-btn {
      width: 36px; height: 36px; border-radius: var(--clay-radius-xs);
      display: flex; align-items: center; justify-content: center;
      color: var(--clay-text-muted); text-decoration: none;
      transition: all 0.15s;
    }
    .back-btn:hover { background: var(--clay-surface-hover); color: var(--clay-text); }
    .back-btn mat-icon { font-size: 20px; width: 20px; height: 20px; }
    .topbar-breadcrumb { display: flex; align-items: center; gap: 4px; }
    .breadcrumb-muted { font-size: 13px; color: var(--clay-text-muted); }
    .breadcrumb-sep { font-size: 16px; width: 16px; height: 16px; color: var(--clay-text-muted); }
    .breadcrumb-active { font-size: 13px; font-weight: 600; color: var(--clay-text); }
    .topbar-meta { display: flex; gap: 8px; }
    .meta-chip {
      display: flex; align-items: center; gap: 4px;
      padding: 4px 10px; border-radius: 4px;
      background: var(--clay-bg-warm); font-size: 11px;
      color: var(--clay-text-secondary);
    }
    .meta-chip.mono { font-family: 'Space Grotesk', monospace; font-weight: 600; }
    .meta-chip mat-icon { font-size: 14px; width: 14px; height: 14px; }

    /* ===== Workspace ===== */
    .workspace {
      display: flex; flex: 1; overflow: hidden;
    }

    /* ===== Canvas ===== */
    .canvas-area {
      flex: 1; overflow: auto;
      background: var(--clay-bg);
    }
    .canvas-grid {
      min-height: 100%; padding: 32px 40px 64px;
      background-image: radial-gradient(var(--clay-border) 0.5px, transparent 0.5px);
      background-size: 24px 24px;
    }

    /* ===== Pipeline (vertical) ===== */
    .pipeline {
      display: flex; flex-direction: column; align-items: center;
      gap: 0;
    }
    .pipeline-node {
      display: flex; flex-direction: column; align-items: center;
    }
    .pipeline-add {
      display: flex; flex-direction: column; align-items: center;
    }

    /* Connectors (vertical) */
    .connector {
      display: flex; flex-direction: column; align-items: center;
      height: 40px; width: 192px;
    }
    .connector-line {
      flex: 1; width: 2px;
      background: var(--clay-primary);
      opacity: 0.3;
    }
    .connector-line-dashed {
      background: none;
      border-left: 2px dashed var(--clay-text-muted);
      opacity: 0.2; width: 0;
    }
    .connector-dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: var(--clay-primary); flex-shrink: 0;
      opacity: 0.5;
    }

    /* ===== Stage Card ===== */
    .stage-card {
      width: 192px; padding: 16px;
      background: var(--clay-surface);
      border: 1px solid var(--clay-border);
      border-radius: var(--clay-radius-sm);
      cursor: pointer;
      transition: all 0.2s;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
      flex-shrink: 0;
    }
    .stage-card:hover {
      border-color: var(--clay-primary);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
    }
    .stage-selected {
      border: 2px solid var(--clay-primary) !important;
      background: var(--clay-surface-hover) !important;
      box-shadow: 0 0 20px rgba(173, 198, 255, 0.1), 0 4px 20px rgba(0, 0, 0, 0.15) !important;
    }

    .stage-card-head {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 12px;
    }
    .stage-code {
      font-family: 'Space Grotesk', monospace;
      font-size: 10px; font-weight: 600;
      color: var(--clay-primary); text-transform: uppercase;
      letter-spacing: 0.12em;
    }
    .stage-selected .stage-code { color: var(--clay-primary); }
    .stage-grip {
      width: 24px; height: 24px;
      background: transparent; border: none; border-radius: 4px;
      display: flex; align-items: center; justify-content: center;
      color: var(--clay-text-muted); cursor: grab;
      transition: all 0.15s;
    }
    .stage-grip:hover { background: var(--clay-bg-warm); color: var(--clay-text); }
    .stage-grip mat-icon { font-size: 16px; width: 16px; height: 16px; }

    .stage-card-body { margin-bottom: 12px; }
    .stage-icon-wrap {
      width: 36px; height: 36px; border-radius: 6px;
      background: var(--clay-bg-warm);
      border: 1px solid var(--clay-border);
      display: flex; align-items: center; justify-content: center;
      margin-bottom: 8px;
    }
    .stage-icon-wrap mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--clay-text-muted); }
    .stage-selected .stage-icon-wrap {
      background: var(--info-bg); border-color: var(--clay-primary);
    }
    .stage-selected .stage-icon-wrap mat-icon { color: var(--clay-primary); }
    .stage-title {
      font-family: 'Space Grotesk', sans-serif;
      font-size: 14px; font-weight: 700; color: var(--clay-text);
      letter-spacing: -0.01em;
    }
    .stage-selected .stage-title { color: var(--clay-primary); }

    .stage-card-foot {}
    .stage-target {
      font-family: 'Space Grotesk', monospace;
      font-size: 10px; color: var(--clay-text-muted);
      margin-bottom: 6px;
    }
    .stage-bar {
      height: 3px; width: 100%; border-radius: 2px;
      background: var(--clay-border);
    }
    .stage-bar-fill {
      height: 100%; width: 30%; border-radius: 2px;
      background: var(--clay-text-muted); opacity: 0.3;
      transition: all 0.3s;
    }
    .stage-bar-fill.active {
      width: 100%; background: var(--clay-primary); opacity: 1;
    }

    /* Drag states */
    .stage-drag-preview {
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3) !important;
      border: 2px solid var(--clay-primary) !important;
    }
    .cdk-drag-placeholder { opacity: 0.2; }
    .cdk-drag-animating { transition: transform 250ms cubic-bezier(0, 0, 0.2, 1); }

    /* Add node */
    .add-node {
      width: 48px; height: 48px; border-radius: 50%;
      border: 2px dashed var(--clay-border);
      background: transparent;
      display: flex; align-items: center; justify-content: center;
      color: var(--clay-text-muted); cursor: pointer;
      transition: all 0.2s;
    }
    .add-node:hover {
      border-color: var(--clay-primary); color: var(--clay-primary);
      background: var(--info-bg);
    }
    .add-node mat-icon { font-size: 22px; width: 22px; height: 22px; }

    /* Empty state */
    .empty-canvas {
      display: flex; flex-direction: column; align-items: center;
      justify-content: center; min-height: 300px;
      text-align: center; gap: 8px;
    }
    .empty-icon {
      width: 64px; height: 64px; border-radius: var(--clay-radius);
      background: var(--clay-surface); border: 1px solid var(--clay-border);
      display: flex; align-items: center; justify-content: center;
      margin-bottom: 8px;
    }
    .empty-icon mat-icon { font-size: 28px; width: 28px; height: 28px; color: var(--clay-text-muted); }
    .empty-canvas h3 { margin: 0; font-size: 16px; color: var(--clay-text); font-weight: 600; }
    .empty-canvas p { margin: 0; font-size: 13px; color: var(--clay-text-muted); }
    .btn-primary {
      display: inline-flex; align-items: center; gap: 6px;
      background: var(--clay-primary); color: #fff;
      border: none; border-radius: var(--clay-radius-sm);
      padding: 10px 20px; font-size: 13px; font-weight: 600;
      cursor: pointer; transition: all 0.2s; font-family: inherit;
      margin-top: 8px;
    }
    .btn-primary:hover { filter: brightness(1.1); }
    .btn-primary mat-icon { font-size: 18px; width: 18px; height: 18px; }

    /* ===== Detail Panel ===== */
    .detail-panel {
      width: 320px; min-width: 320px;
      background: var(--clay-surface-hover);
      border-left: 1px solid var(--clay-border);
      overflow-y: auto; flex-shrink: 0;
      display: flex; flex-direction: column;
      transition: margin-right 0.25s ease;
    }

    .panel-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 20px 20px 16px;
      border-bottom: 1px solid var(--clay-border);
    }
    .panel-header h3 {
      margin: 0; font-size: 14px; font-weight: 700; color: var(--clay-text);
      font-family: 'Space Grotesk', sans-serif;
    }
    .icon-btn {
      width: 32px; height: 32px; border-radius: var(--clay-radius-xs);
      border: none; background: transparent; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      color: var(--clay-text-muted); transition: all 0.15s;
    }
    .icon-btn:hover { background: var(--clay-surface); color: var(--clay-text); }
    .icon-btn mat-icon { font-size: 18px; width: 18px; height: 18px; }

    /* Info card */
    .panel-info-card {
      display: flex; align-items: center; gap: 12px;
      margin: 16px 20px; padding: 16px;
      background: var(--clay-bg);
      border-radius: var(--clay-radius-sm);
      border-left: 3px solid var(--clay-primary);
    }
    .info-icon {
      width: 40px; height: 40px; border-radius: 6px;
      background: var(--info-bg);
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    .info-icon mat-icon { font-size: 20px; width: 20px; height: 20px; color: var(--clay-primary); }
    .info-name {
      font-family: 'Space Grotesk', sans-serif;
      font-size: 14px; font-weight: 700; color: var(--clay-text);
      text-transform: uppercase; letter-spacing: 0.06em;
    }
    .info-id {
      font-size: 11px; color: var(--clay-text-muted);
      font-family: 'Space Grotesk', monospace;
      margin-top: 2px;
    }

    /* Properties */
    .panel-section { padding: 0 20px; margin-bottom: 16px; }
    .section-label {
      font-family: 'Space Grotesk', sans-serif;
      font-size: 10px; font-weight: 600; color: var(--clay-text-muted);
      text-transform: uppercase; letter-spacing: 0.1em;
      margin-bottom: 10px;
    }
    .prop-list { display: flex; flex-direction: column; gap: 6px; }
    .prop-row {
      display: flex; justify-content: space-between; align-items: center;
      padding: 10px 12px;
      background: var(--clay-bg);
      border-radius: var(--clay-radius-xs);
      border: 1px solid var(--clay-border);
    }
    .prop-row-col { flex-direction: column; align-items: flex-start; gap: 4px; }
    .prop-key { font-size: 12px; color: var(--clay-text-muted); }
    .prop-val { font-size: 13px; color: var(--clay-text); font-weight: 500; }
    .prop-val.mono { font-family: 'Space Grotesk', monospace; font-weight: 600; }

    /* Panel actions */
    .panel-actions {
      padding: 16px 20px; margin-top: auto;
      display: flex; flex-direction: column; gap: 8px;
      border-top: 1px solid var(--clay-border);
    }
    .btn-outline-full {
      display: flex; align-items: center; justify-content: center; gap: 6px;
      width: 100%; padding: 10px;
      background: transparent; color: var(--clay-primary);
      border: 1px solid var(--clay-border);
      border-radius: var(--clay-radius-sm);
      font-size: 12px; font-weight: 600; cursor: pointer;
      font-family: 'Space Grotesk', sans-serif;
      text-transform: uppercase; letter-spacing: 0.06em;
      transition: all 0.15s;
    }
    .btn-outline-full:hover { border-color: var(--clay-primary); background: var(--info-bg); }
    .btn-outline-full mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .btn-danger-full {
      display: flex; align-items: center; justify-content: center; gap: 6px;
      width: 100%; padding: 10px;
      background: transparent; color: var(--danger);
      border: 1px solid var(--clay-border);
      border-radius: var(--clay-radius-sm);
      font-size: 12px; font-weight: 600; cursor: pointer;
      font-family: 'Space Grotesk', sans-serif;
      text-transform: uppercase; letter-spacing: 0.06em;
      transition: all 0.15s;
    }
    .btn-danger-full:hover { border-color: var(--danger); background: var(--danger-bg); }
    .btn-danger-full mat-icon { font-size: 16px; width: 16px; height: 16px; }

    /* Panel empty */
    .panel-empty {
      display: flex; flex-direction: column; align-items: center;
      justify-content: center; flex: 1; gap: 8px;
      color: var(--clay-text-muted); padding: 40px 20px;
      text-align: center;
    }
    .panel-empty mat-icon { font-size: 32px; width: 32px; height: 32px; opacity: 0.4; }
    .panel-empty p { margin: 0; font-size: 13px; }

    /* ===== Responsive ===== */
    @media (max-width: 960px) {
      .designer-shell { height: auto; min-height: auto; }
      .workspace { flex-direction: column; }
      .canvas-area { min-height: 300px; }
      .detail-panel { width: 100%; min-width: 100%; border-left: none; border-top: 1px solid var(--clay-border); }
      .topbar-meta { display: none; }
    }
  `]
})
export class ProcessDetailComponent implements OnInit {
  process: any = null;
  stages: any[] = [];
  selectedStage: any = null;

  private stageIcons: Record<string, string> = {
    cut: 'content_cut', cutting: 'content_cut',
    weld: 'local_fire_department', welding: 'local_fire_department',
    assemble: 'construction', assembly: 'construction',
    inspect: 'search', inspection: 'search', quality: 'search',
    paint: 'format_paint', painting: 'format_paint',
    test: 'science', testing: 'science',
    pack: 'inventory_2', packaging: 'inventory_2',
    machine: 'precision_manufacturing', machining: 'precision_manufacturing',
  };

  constructor(
    private route: ActivatedRoute,
    private api: ApiService,
    private dialog: MatDialog,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void { this.load(); }

  load(): void {
    const id = this.route.snapshot.paramMap.get('id');
    this.api.get<any>(`/processes/${id}`).subscribe(data => {
      this.process = data;
      this.stages = (data.stages || []).sort((a: any, b: any) => a.sequence - b.sequence);
      if (this.selectedStage) {
        this.selectedStage = this.stages.find(s => s.id === this.selectedStage.id) || null;
      }
    });
  }

  getStageIcon(name: string): string {
    const lower = (name || '').toLowerCase();
    for (const [key, icon] of Object.entries(this.stageIcons)) {
      if (lower.includes(key)) return icon;
    }
    return 'settings';
  }

  getStageIndex(stage: any): number {
    return this.stages.findIndex(s => s.id === stage.id);
  }

  selectStage(stage: any): void {
    this.selectedStage = this.selectedStage?.id === stage.id ? null : stage;
  }

  drop(event: CdkDragDrop<any[]>): void {
    if (event.previousIndex === event.currentIndex) return;
    moveItemInArray(this.stages, event.previousIndex, event.currentIndex);
    const stageIds = this.stages.map(s => s.id);
    this.api.patch(`/processes/${this.process.id}/stages/reorder`, { stageIds }).subscribe({
      next: () => this.snackBar.open('Stage order saved', 'Close', { duration: 2000 }),
      error: () => {
        this.snackBar.open('Failed to save order', 'Close', { duration: 3000 });
        this.load();
      }
    });
  }

  addStage(): void {
    const ref = this.dialog.open(StageDialogComponent, {
      width: '500px',
      data: { processId: this.process.id, sequence: this.stages.length + 1 }
    });
    ref.afterClosed().subscribe(result => { if (result) this.load(); });
  }

  editStage(stage: any): void {
    const ref = this.dialog.open(StageDialogComponent, { width: '500px', data: { stage, processId: this.process.id } });
    ref.afterClosed().subscribe(result => { if (result) this.load(); });
  }

  deleteStage(stage: any): void {
    const ref = this.dialog.open(ConfirmDialogComponent, {
      data: { title: 'Delete Stage', message: `Delete "${stage.name}"?` }
    });
    ref.afterClosed().subscribe(confirmed => {
      if (confirmed) {
        this.selectedStage = null;
        this.api.delete(`/stages/${stage.id}`).subscribe(() => {
          this.snackBar.open('Stage deleted', 'Close', { duration: 3000 });
          this.load();
        });
      }
    });
  }
}
