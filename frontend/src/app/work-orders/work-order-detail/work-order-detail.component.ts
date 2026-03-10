import { Component, OnInit } from '@angular/core';
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
import { MatSnackBar } from '@angular/material/snack-bar';
import { ApiService } from '../../core/services/api.service';
import { DurationPipe } from '../../shared/pipes/duration.pipe';

@Component({
  selector: 'app-work-order-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, MatCardModule, MatButtonModule, MatIconModule, MatChipsModule, MatSelectModule, MatFormFieldModule, MatProgressBarModule, DurationPipe],
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

      <h3>Stage Progress</h3>
      <div class="stages-grid">
        @for (wos of stages; track wos.id) {
          <mat-card class="stage-progress-card" [class.stage-completed]="wos.status === 'completed'" [class.stage-active]="wos.status === 'in_progress'">
            <div class="stage-top">
              <div class="stage-name">{{ wos.stage?.name }}</div>
              <span class="stage-status" [class]="'ss-' + wos.status">{{ wos.status }}</span>
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
    h3 { color: var(--clay-text); margin: 24px 0 12px; }
    .stages-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
    .stage-progress-card { padding: 16px; }
    .stage-completed { border-left: 4px solid #4caf50; }
    .stage-active { border-left: 4px solid #2196f3; }
    .stage-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .stage-name { font-weight: 500; }
    .stage-status { font-size: 11px; text-transform: uppercase; font-weight: 600; }
    .ss-pending { color: #ff9800; } .ss-in_progress { color: #2196f3; }
    .ss-completed { color: #4caf50; } .ss-skipped { color: #9e9e9e; }
    .stage-times { display: flex; justify-content: space-between; font-size: 12px; color: var(--clay-text-secondary); margin-bottom: 8px; }
    .assign-row { margin-top: 12px; }
    .assign-field { width: 100%; }
    ::ng-deep .assign-field .mat-mdc-form-field-subscript-wrapper { display: none; }
  `]
})
export class WorkOrderDetailComponent implements OnInit {
  wo: any = null;
  stages: any[] = [];
  users: any[] = [];

  constructor(
    private route: ActivatedRoute,
    private api: ApiService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.load();
    this.api.get<any>('/users').subscribe(data => {
      this.users = Array.isArray(data) ? data : data.data || [];
    });
  }

  load(): void {
    const id = this.route.snapshot.paramMap.get('id');
    this.api.get<any>(`/work-orders/${id}`).subscribe(data => {
      this.wo = data;
      this.stages = (data.workOrderStages || data.stages || []).sort(
        (a: any, b: any) => (a.stage?.sequence || 0) - (b.stage?.sequence || 0)
      );
    });
  }

  changeStatus(status: string): void {
    this.api.patch(`/work-orders/${this.wo.id}/status`, { status }).subscribe({
      next: () => {
        this.snackBar.open(`Status changed to ${status}`, 'Close', { duration: 3000 });
        this.load();
      }
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
}
