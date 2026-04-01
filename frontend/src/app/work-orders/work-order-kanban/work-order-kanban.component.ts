import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { DurationPipe } from '../../shared/pipes/duration.pipe';

interface WorkOrder {
  id: string;
  orderNumber: string;
  product: { name: string };
  status: string;
  priority: string;
  quantity: number;
  completedQuantity: number;
  dueDate: string | null;
  stages: WorkOrderStage[];
}

interface WorkOrderStage {
  id: string;
  stage: { name: string; targetTimeSeconds: number };
  status: string;
  assignedUser: { firstName: string; lastName: string } | null;
  station: { name: string } | null;
  actualTimeSeconds: number | null;
  startedAt: string | null;
  completedAt: string | null;
}

const COLUMNS = [
  { key: 'pending', label: 'Pending', icon: 'hourglass_empty', color: '#b0a798' },
  { key: 'in_progress', label: 'In Progress', icon: 'play_circle', color: '#5b7fa6' },
  { key: 'completed', label: 'Completed', icon: 'check_circle', color: '#5a8a5a' },
  { key: 'skipped', label: 'Skipped', icon: 'skip_next', color: '#9e8e7e' },
];

@Component({
  selector: 'app-work-order-kanban',
  standalone: true,
  imports: [
    CommonModule, RouterModule, FormsModule,
    MatCardModule, MatIconModule, MatButtonModule, MatChipsModule,
    MatTooltipModule, MatSelectModule, MatFormFieldModule,
    DurationPipe,
  ],
  template: `
    <div class="kanban-header">
      <h2>Work Order Pipeline</h2>
      <div class="kanban-filters">
        <mat-form-field appearance="outline" class="wo-select">
          <mat-label>Work Order</mat-label>
          <mat-select [(ngModel)]="selectedWoId" (selectionChange)="loadStages()">
            @for (wo of workOrders; track wo.id) {
              <mat-option [value]="wo.id">{{ wo.orderNumber }} — {{ wo.product?.name }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
      </div>
    </div>

    @if (workOrders.length === 0) {
      <div class="empty-state">
        <mat-icon class="empty-icon">assignment</mat-icon>
        <p>No work orders yet. Create products, processes, and work orders from the web portal to see them here.</p>
      </div>
    }

    @if (selectedWo) {
      <div class="wo-info-bar">
        <span class="wo-badge priority-{{ selectedWo.priority }}">{{ selectedWo.priority | uppercase }}</span>
        <span class="wo-badge status-{{ selectedWo.status }}">{{ selectedWo.status.replace('_',' ') | uppercase }}</span>
        <span class="wo-qty">{{ selectedWo.completedQuantity }}/{{ selectedWo.quantity }} units</span>
        @if (selectedWo.dueDate) {
          <span class="wo-due" [class.overdue]="isOverdue(selectedWo.dueDate)">
            Due: {{ selectedWo.dueDate | date:'mediumDate' }}
          </span>
        }
      </div>
    }

    <div class="kanban-board">
      @for (col of columns; track col.key) {
        <div class="kanban-column">
          <div class="column-header" [style.border-bottom-color]="col.color">
            <mat-icon [style.color]="col.color">{{ col.icon }}</mat-icon>
            <span class="column-title">{{ col.label }}</span>
            <span class="column-count">{{ getStagesForColumn(col.key).length }}</span>
          </div>
          <div class="column-body">
            @for (stage of getStagesForColumn(col.key); track stage.id) {
              <mat-card class="stage-card">
                <div class="stage-name">{{ stage.stage?.name }}</div>
                @if (stage.assignedUser) {
                  <div class="stage-assignee">
                    <mat-icon class="small-icon">person</mat-icon>
                    {{ stage.assignedUser.firstName }} {{ stage.assignedUser.lastName }}
                  </div>
                }
                @if (stage.station) {
                  <div class="stage-station">
                    <mat-icon class="small-icon">location_on</mat-icon>
                    {{ stage.station.name }}
                  </div>
                }
                <div class="stage-time">
                  @if (stage.stage?.targetTimeSeconds) {
                    <span class="target-time" matTooltip="Target time">
                      <mat-icon class="small-icon">flag</mat-icon>
                      {{ stage.stage.targetTimeSeconds | duration }}
                    </span>
                  }
                  @if (stage.actualTimeSeconds) {
                    <span class="actual-time"
                          [class.over-target]="stage.stage?.targetTimeSeconds && stage.actualTimeSeconds > stage.stage.targetTimeSeconds"
                          [class.under-target]="stage.stage?.targetTimeSeconds && stage.actualTimeSeconds <= stage.stage.targetTimeSeconds"
                          matTooltip="Actual time">
                      <mat-icon class="small-icon">timer</mat-icon>
                      {{ stage.actualTimeSeconds | duration }}
                    </span>
                  }
                </div>
              </mat-card>
            }
            @if (getStagesForColumn(col.key).length === 0) {
              <div class="empty-column">No {{ col.label.toLowerCase() }} stages</div>
            }
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .kanban-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .kanban-header h2 { margin: 0; color: var(--clay-text); font-weight: 700; }
    .wo-select { min-width: 320px; }

    .wo-info-bar {
      display: flex; align-items: center; gap: 12px; margin-bottom: 20px;
      padding: 12px 16px; border-radius: var(--clay-radius-sm);
      background: var(--clay-surface); box-shadow: var(--clay-shadow-soft);
    }
    .wo-badge {
      padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.5px;
    }
    .priority-low { background: #e8f5e9; color: #388e3c; }
    .priority-medium { background: #fff3e0; color: #f57c00; }
    .priority-high { background: #fce4ec; color: #d32f2f; }
    .priority-urgent { background: #e74c3c; color: white; }
    .status-draft { background: #f5f5f5; color: #757575; }
    .status-pending { background: #fff3e0; color: #f57c00; }
    .status-in_progress { background: #e3f2fd; color: #1976d2; }
    .status-completed { background: #e8f5e9; color: #388e3c; }
    .status-cancelled { background: #fce4ec; color: #d32f2f; }
    .wo-qty { font-size: 14px; font-weight: 500; color: var(--clay-text); }
    .wo-due { font-size: 13px; color: var(--clay-text-secondary); }
    .wo-due.overdue { color: #e74c3c; font-weight: 600; }

    .kanban-board {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 16px;
      min-height: 400px;
    }

    .kanban-column {
      background: var(--clay-bg-warm, #ece6da);
      border-radius: var(--clay-radius);
      padding: 0;
      box-shadow: var(--clay-shadow-inset);
      display: flex; flex-direction: column;
    }

    .column-header {
      display: flex; align-items: center; gap: 8px;
      padding: 14px 16px; border-bottom: 3px solid;
      font-weight: 600; font-size: 14px; color: var(--clay-text);
    }
    .column-count {
      margin-left: auto; background: var(--clay-surface);
      padding: 2px 8px; border-radius: 10px; font-size: 12px;
      box-shadow: var(--clay-shadow-soft);
    }

    .column-body { padding: 12px; flex: 1; display: flex; flex-direction: column; gap: 10px; }

    .stage-card {
      padding: 12px !important; border-radius: var(--clay-radius-sm) !important;
      background: var(--clay-surface) !important;
      box-shadow: var(--clay-shadow-raised) !important;
      border: 1px solid var(--clay-border) !important;
      transition: all var(--clay-transition);
    }
    .stage-card:hover {
      box-shadow: var(--clay-shadow-hover) !important;
      transform: translateY(-1px);
    }

    .stage-name { font-weight: 600; font-size: 14px; margin-bottom: 6px; color: var(--clay-text); }
    .stage-assignee, .stage-station {
      display: flex; align-items: center; gap: 4px;
      font-size: 12px; color: var(--clay-text-secondary); margin-bottom: 4px;
    }
    .small-icon { font-size: 14px; width: 14px; height: 14px; }

    .stage-time {
      display: flex; gap: 12px; margin-top: 6px;
      padding-top: 6px; border-top: 1px solid var(--clay-border);
      font-size: 12px;
    }
    .target-time { color: var(--clay-text-muted); display: flex; align-items: center; gap: 3px; }
    .actual-time { display: flex; align-items: center; gap: 3px; }
    .over-target { color: #e74c3c; font-weight: 600; }
    .under-target { color: #27ae60; font-weight: 600; }

    .empty-column {
      text-align: center; padding: 24px; color: var(--clay-text-muted);
      font-size: 13px; font-style: italic;
    }

    .empty-state {
      text-align: center; padding: 60px 20px; color: var(--clay-text-muted);
      background: var(--clay-surface); border-radius: var(--clay-radius);
      box-shadow: var(--clay-shadow-soft); margin-bottom: 20px;
    }
    .empty-icon { font-size: 48px; width: 48px; height: 48px; color: var(--clay-text-muted); margin-bottom: 12px; }
    .empty-state p { font-size: 14px; max-width: 400px; margin: 0 auto; }

    @media (max-width: 960px) {
      .kanban-board { grid-template-columns: repeat(2, 1fr); }
    }
    @media (max-width: 600px) {
      .kanban-board { grid-template-columns: 1fr; }
    }
  `]
})
export class WorkOrderKanbanComponent implements OnInit {
  workOrders: WorkOrder[] = [];
  selectedWoId: string | null = null;
  selectedWo: WorkOrder | null = null;
  stages: WorkOrderStage[] = [];
  columns = COLUMNS;

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.api.get<any>('/work-orders', { limit: 100 }).subscribe({
      next: (res) => {
        this.workOrders = (res.data || res) as WorkOrder[];
        if (this.workOrders.length > 0) {
          // Default to first in-progress order
          const inProgress = this.workOrders.find(wo => wo.status === 'in_progress');
          this.selectedWoId = (inProgress || this.workOrders[0]).id;
          this.loadStages();
        }
      },
    });
  }

  loadStages(): void {
    if (!this.selectedWoId) return;
    this.api.get<WorkOrder>(`/work-orders/${this.selectedWoId}`).subscribe({
      next: (wo) => {
        this.selectedWo = wo;
        this.stages = wo.stages || [];
      },
    });
  }

  getStagesForColumn(status: string): WorkOrderStage[] {
    return this.stages.filter(s => s.status === status);
  }

  isOverdue(dueDate: string): boolean {
    return new Date(dueDate) < new Date();
  }
}
