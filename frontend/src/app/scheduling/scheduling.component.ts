import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { ApiService } from '../core/services/api.service';
import { ListStateComponent } from '../shared/components/list-state/list-state.component';

@Component({
  selector: 'app-scheduling',
  standalone: true,
  imports: [CommonModule, MatTableModule, ListStateComponent],
  template: `
    <div class="page-shell">
      <div class="page-header"><div>
        <h1 class="page-title">Capacity &amp; Load</h1>
        <p class="page-subtitle">Estimated production load vs. capacity by line</p>
      </div></div>

      <app-list-state [loading]="loading" [error]="error" [empty]="false" (retry)="load()">
        <table mat-table [dataSource]="lines" class="mat-elevation-z1 full stack-cards">
          <ng-container matColumnDef="line"><th mat-header-cell *matHeaderCellDef>Line</th><td mat-cell *matCellDef="let l" [attr.data-label]="'Line'">{{ l.lineName }}</td></ng-container>
          <ng-container matColumnDef="scheduled"><th mat-header-cell *matHeaderCellDef>Scheduled (h)</th><td mat-cell *matCellDef="let l" [attr.data-label]="'Scheduled (h)'">{{ l.scheduledHours }}</td></ng-container>
          <ng-container matColumnDef="capacity"><th mat-header-cell *matHeaderCellDef>Capacity (h)</th><td mat-cell *matCellDef="let l" [attr.data-label]="'Capacity (h)'">{{ l.capacityHours }}</td></ng-container>
          <ng-container matColumnDef="util"><th mat-header-cell *matHeaderCellDef>Utilization</th>
            <td mat-cell *matCellDef="let l" [attr.data-label]="'Utilization'">
              @if (l.utilizationPct !== null) {
                <div class="bar"><div class="fill" [class.over]="l.overloaded" [style.width.%]="cap(l.utilizationPct)"></div></div>
                <span [class.over]="l.overloaded">{{ l.utilizationPct }}%</span>
              } @else { — }
            </td></ng-container>
          <tr mat-header-row *matHeaderRowDef="columns"></tr>
          <tr mat-row *matRowDef="let row; columns: columns"></tr>
        </table>
        @if (lines.length === 0) { <p class="empty">No active work orders to schedule.</p> }
      </app-list-state>
    </div>
  `,
  styles: [`
    .page-shell { padding:24px; } .page-header { margin-bottom:16px; } .page-title { margin:0; font-size:22px; }
    .page-subtitle { margin:2px 0 0; color: var(--clay-text-muted,#64748b); font-size:13px; }
    table.full { width:100%; }
    .bar { display:inline-block; width:140px; height:8px; background:#e2e8f0; border-radius:4px; overflow:hidden; vertical-align:middle; margin-right:8px; }
    .fill { height:100%; background:#3b82f6; } .fill.over { background:#dc2626; } .over { color:#dc2626; font-weight:600; }
    .empty { text-align:center; color: var(--clay-text-muted,#64748b); padding:24px; }
  `],
})
export class SchedulingComponent implements OnInit {
  columns = ['line', 'scheduled', 'capacity', 'util'];
  loading = true;
  error: string | null = null;
  lines: any[] = [];

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error = null;
    this.api.get<any>('/scheduling/load').subscribe({
      next: (d) => { const data = d?.data ?? d; this.lines = data?.lines || []; this.loading = false; },
      error: () => { this.loading = false; this.error = 'Could not load capacity data — try again.'; },
    });
  }

  cap(pct: number): number { return Math.min(100, pct); }
}
