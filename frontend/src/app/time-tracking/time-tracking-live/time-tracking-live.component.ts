import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ApiService } from '../../core/services/api.service';
import { DurationPipe } from '../../shared/pipes/duration.pipe';
import { interval, Subscription } from 'rxjs';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-time-tracking-live',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, MatCardModule, MatTableModule, MatButtonModule, MatIconModule, MatSelectModule, MatFormFieldModule, DurationPipe],
  template: `
    <div class="page-header">
      <h2>Time Tracking — Live</h2>
      <div class="header-actions">
        <a mat-button routerLink="/time-tracking/history">View History</a>
        <button mat-raised-button color="primary" (click)="showClockIn = !showClockIn">
          <mat-icon>play_circle</mat-icon> Clock In
        </button>
      </div>
    </div>

    @if (showClockIn) {
      <mat-card class="clock-in-card">
        <h3>Clock In</h3>
        <div class="clock-in-form">
          <mat-form-field appearance="outline">
            <mat-label>Work Order</mat-label>
            <mat-select [(ngModel)]="clockInWO" (selectionChange)="onWOSelect()">
              @for (wo of workOrders; track wo.id) {
                <mat-option [value]="wo.id">{{ wo.orderNumber }} — {{ wo.product?.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Stage</mat-label>
            <mat-select [(ngModel)]="clockInStage">
              @for (s of availableStages; track s.id) {
                <mat-option [value]="s.id">{{ s.stage?.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Station (optional)</mat-label>
            <mat-select [(ngModel)]="clockInStation">
              <mat-option [value]="null">None</mat-option>
              @for (s of stations; track s.id) {
                <mat-option [value]="s.id">{{ s.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <button mat-raised-button color="accent" (click)="clockIn()" [disabled]="!clockInStage">Start</button>
        </div>
      </mat-card>
    }

    <table mat-table [dataSource]="activeEntries" class="full-width mat-elevation-z2">
      <ng-container matColumnDef="operator">
        <th mat-header-cell *matHeaderCellDef>Operator</th>
        <td mat-cell *matCellDef="let e">{{ e.user?.firstName }} {{ e.user?.lastName }}</td>
      </ng-container>
      <ng-container matColumnDef="workOrder">
        <th mat-header-cell *matHeaderCellDef>Work Order</th>
        <td mat-cell *matCellDef="let e">{{ e.workOrderStage?.workOrder?.orderNumber || '—' }}</td>
      </ng-container>
      <ng-container matColumnDef="stage">
        <th mat-header-cell *matHeaderCellDef>Stage</th>
        <td mat-cell *matCellDef="let e">{{ e.workOrderStage?.stage?.name || '—' }}</td>
      </ng-container>
      <ng-container matColumnDef="elapsed">
        <th mat-header-cell *matHeaderCellDef>Elapsed</th>
        <td mat-cell *matCellDef="let e" class="elapsed-cell">
          <mat-icon class="pulse">fiber_manual_record</mat-icon>
          {{ getElapsed(e.startTime) | duration }}
        </td>
      </ng-container>
      <ng-container matColumnDef="station">
        <th mat-header-cell *matHeaderCellDef>Station</th>
        <td mat-cell *matCellDef="let e">{{ e.station?.name || '—' }}</td>
      </ng-container>
      <ng-container matColumnDef="actions">
        <th mat-header-cell *matHeaderCellDef>Actions</th>
        <td mat-cell *matCellDef="let e">
          <button mat-raised-button color="warn" (click)="clockOut(e)">
            <mat-icon>stop</mat-icon> Clock Out
          </button>
        </td>
      </ng-container>
      <tr mat-header-row *matHeaderRowDef="columns"></tr>
      <tr mat-row *matRowDef="let row; columns: columns;"></tr>
    </table>

    @if (activeEntries.length === 0) {
      <mat-card class="empty-card">
        <mat-icon>hourglass_empty</mat-icon>
        <p>No active time entries</p>
      </mat-card>
    }
  `,
  styles: [`
    .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    h2 { margin: 0; color: var(--clay-text); }
    .header-actions { display: flex; gap: 8px; align-items: center; }
    .clock-in-card { padding: 20px; margin-bottom: 16px; }
    .clock-in-card h3 { margin: 0 0 16px; color: var(--clay-text); }
    .clock-in-form { display: flex; gap: 12px; align-items: flex-start; flex-wrap: wrap; }
    .full-width { width: 100%; }
    .elapsed-cell { display: flex; align-items: center; gap: 4px; font-weight: 500; color: #2e7d32; }
    .pulse { font-size: 12px; width: 12px; height: 12px; color: #4caf50; animation: pulse 1.5s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
    .empty-card { text-align: center; padding: 40px; color: var(--clay-text-muted); }
    .empty-card mat-icon { font-size: 48px; width: 48px; height: 48px; opacity: 0.3; }
  `]
})
export class TimeTrackingLiveComponent implements OnInit, OnDestroy {
  activeEntries: any[] = [];
  columns = ['operator', 'workOrder', 'stage', 'elapsed', 'station', 'actions'];
  showClockIn = false;
  workOrders: any[] = [];
  availableStages: any[] = [];
  stations: any[] = [];
  clockInWO = '';
  clockInStage = '';
  clockInStation: string | null = null;

  private refreshSub?: Subscription;
  private timerSub?: Subscription;

  constructor(private api: ApiService, private snackBar: MatSnackBar) {}

  ngOnInit(): void {
    this.loadActive();
    this.loadWorkOrders();
    this.loadStations();
    this.refreshSub = interval(10000).subscribe(() => this.loadActive());
    this.timerSub = interval(1000).subscribe(() => {});
  }

  ngOnDestroy(): void {
    this.refreshSub?.unsubscribe();
    this.timerSub?.unsubscribe();
  }

  loadActive(): void {
    this.api.get<any[]>('/time-tracking/active').subscribe(data => {
      this.activeEntries = data || [];
    });
  }

  loadWorkOrders(): void {
    this.api.get<any>('/work-orders', { status: 'in_progress' }).subscribe(data => {
      this.workOrders = Array.isArray(data) ? data : data.data || [];
    });
  }

  loadStations(): void {
    this.api.get<any>('/lines').subscribe(lines => {
      const allLines = Array.isArray(lines) ? lines : lines.data || [];
      this.stations = [];
      allLines.forEach((line: any) => {
        if (line.stations && Array.isArray(line.stations)) {
          this.stations.push(...line.stations);
        }
      });
      // Fallback: if no nested stations, fetch per line
      if (this.stations.length === 0 && allLines.length > 0) {
        allLines.forEach((line: any) => {
          this.api.get<any>(`/lines/${line.id}/stations`).subscribe(sts => {
            const stArr = Array.isArray(sts) ? sts : sts?.data || [];
            this.stations.push(...stArr);
          });
        });
      }
    });
  }

  onWOSelect(): void {
    if (!this.clockInWO) return;
    this.api.get<any>(`/work-orders/${this.clockInWO}`).subscribe(wo => {
      this.availableStages = wo.workOrderStages || wo.stages || [];
    });
  }

  clockIn(): void {
    const body: any = { workOrderStageId: this.clockInStage, inputMethod: 'web' };
    if (this.clockInStation) body.stationId = this.clockInStation;
    this.api.post('/time-tracking/clock-in', body).subscribe({
      next: () => {
        this.snackBar.open('Clocked in', 'Close', { duration: 3000 });
        this.showClockIn = false;
        this.loadActive();
      }
    });
  }

  clockOut(entry: any): void {
    this.api.post('/time-tracking/clock-out', { timeEntryId: entry.id }).subscribe({
      next: () => {
        this.snackBar.open('Clocked out', 'Close', { duration: 3000 });
        this.loadActive();
      }
    });
  }

  getElapsed(startTime: string): number {
    if (!startTime) return 0;
    return Math.floor((Date.now() - new Date(startTime).getTime()) / 1000);
  }
}
