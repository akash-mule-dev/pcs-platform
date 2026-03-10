import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatChipsModule } from '@angular/material/chips';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { ApiService } from '../../core/services/api.service';
import { DurationPipe } from '../../shared/pipes/duration.pipe';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog/confirm-dialog.component';
import { StageDialogComponent } from './stage-dialog.component';

@Component({
  selector: 'app-process-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, MatCardModule, MatButtonModule, MatIconModule, MatChipsModule, DragDropModule, DurationPipe],
  template: `
    <div class="page-header">
      <div>
        <a routerLink="/processes" class="back-link">← Back to Processes</a>
        <h2>{{ process?.name || 'Process Detail' }}</h2>
        <p class="subtitle" *ngIf="process">
          Product: <strong>{{ process.product?.name }}</strong> | Version: <strong>v{{ process.version }}</strong>
        </p>
      </div>
      <button mat-raised-button color="primary" (click)="addStage()">
        <mat-icon>add</mat-icon> Add Stage
      </button>
    </div>

    <div class="stages-list" cdkDropList (cdkDropListDropped)="drop($event)">
      @for (stage of stages; track stage.id; let i = $index) {
        <mat-card class="stage-card" cdkDrag>
          <div class="stage-handle" cdkDragHandle>
            <mat-icon>drag_indicator</mat-icon>
          </div>
          <div class="stage-sequence">{{ i + 1 }}</div>
          <div class="stage-info">
            <div class="stage-name">{{ stage.name }}</div>
            <div class="stage-meta">
              Target: {{ stage.targetTimeSeconds | duration }}
              @if (stage.description) {
                <span> · {{ stage.description }}</span>
              }
            </div>
          </div>
          <div class="stage-actions">
            <button mat-icon-button color="primary" (click)="editStage(stage)"><mat-icon>edit</mat-icon></button>
            <button mat-icon-button color="warn" (click)="deleteStage(stage)"><mat-icon>delete</mat-icon></button>
          </div>
        </mat-card>
      }
    </div>

    @if (stages.length === 0) {
      <mat-card class="empty-card">
        <p>No stages defined. Click "Add Stage" to create the first one.</p>
      </mat-card>
    }
  `,
  styles: [`
    .page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
    h2 { margin: 8px 0 4px; color: var(--clay-text); }
    .subtitle { margin: 0; color: var(--clay-text-secondary); font-size: 14px; }
    .back-link { color: var(--clay-primary); text-decoration: none; font-size: 13px; }
    .stages-list { display: flex; flex-direction: column; gap: 8px; }
    .stage-card {
      display: flex; align-items: center; padding: 16px; gap: 16px;
      cursor: move; transition: box-shadow 0.2s;
    }
    .stage-card:hover { box-shadow: 0 4px 8px rgba(0,0,0,0.15); }
    .stage-handle { color: var(--clay-text-muted); cursor: grab; }
    .stage-sequence {
      width: 36px; height: 36px; border-radius: 50%;
      background: #1a237e; color: white; display: flex;
      align-items: center; justify-content: center; font-weight: 600; flex-shrink: 0;
    }
    .stage-info { flex: 1; }
    .stage-name { font-weight: 500; font-size: 16px; }
    .stage-meta { font-size: 13px; color: var(--clay-text-secondary); margin-top: 4px; }
    .stage-actions { display: flex; gap: 4px; }
    .empty-card { text-align: center; padding: 40px; color: var(--clay-text-muted); }
    .cdk-drag-preview { box-shadow: 0 8px 24px rgba(0,0,0,0.2); }
    .cdk-drag-placeholder { opacity: 0.3; }
  `]
})
export class ProcessDetailComponent implements OnInit {
  process: any = null;
  stages: any[] = [];

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
    });
  }

  drop(event: CdkDragDrop<any[]>): void {
    moveItemInArray(this.stages, event.previousIndex, event.currentIndex);
    const stageIds = this.stages.map(s => s.id);
    this.api.patch(`/processes/${this.process.id}/stages/reorder`, { stageIds }).subscribe();
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
        this.api.delete(`/stages/${stage.id}`).subscribe(() => {
          this.snackBar.open('Stage deleted', 'Close', { duration: 3000 });
          this.load();
        });
      }
    });
  }
}
