import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { TimeTrackingService, TimeEntryRow, LookupUser, LookupStation } from '../core/services/time-tracking.service';

export interface TimeEntryDialogData {
  mode: 'add' | 'edit';
  workOrderId: string;
  workOrderLabel: string;
  stages: { workOrderStageId: string; name: string; sequence: number }[];
  users: LookupUser[];
  stations: LookupStation[];
  entry?: TimeEntryRow;
}

/**
 * Add or correct a single time record. The duration is always sent as a concrete
 * end time (entered directly, or derived from start + a duration in minutes) so
 * the server can recompute it uniformly and re-freeze the labor/machine rate.
 */
@Component({
  selector: 'app-time-entry-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatIconModule],
  template: `
    <h2 mat-dialog-title>{{ data.mode === 'add' ? 'Log time' : 'Edit time entry' }} · {{ data.workOrderLabel }}</h2>
    <mat-dialog-content>
      @if (error) { <p class="err"><mat-icon>error</mat-icon>{{ error }}</p> }

      <div class="grid">
        <label class="fld">
          <span>Worker *</span>
          <select [(ngModel)]="f.userId">
            <option value="" disabled>Select worker</option>
            @for (u of data.users; track u.id) { <option [value]="u.id">{{ u.name }}</option> }
          </select>
        </label>

        <label class="fld">
          <span>Stage *</span>
          <select [(ngModel)]="f.workOrderStageId">
            <option value="" disabled>Select stage</option>
            @for (s of data.stages; track s.workOrderStageId) { <option [value]="s.workOrderStageId">{{ s.sequence }}. {{ s.name }}</option> }
          </select>
        </label>

        <label class="fld">
          <span>Station</span>
          <select [(ngModel)]="f.stationId">
            <option [value]="''">None</option>
            @for (st of data.stations; track st.id) { <option [value]="st.id">{{ st.name }}{{ st.lineName ? ' · ' + st.lineName : '' }}</option> }
          </select>
        </label>

        <label class="fld">
          <span>Start *</span>
          <input type="datetime-local" [(ngModel)]="f.startLocal">
        </label>

        <label class="fld">
          <span>End time</span>
          <input type="datetime-local" [(ngModel)]="f.endLocal" (ngModelChange)="onEndChange()">
        </label>

        <label class="fld">
          <span>or Duration (min)</span>
          <input type="number" min="0" step="1" [(ngModel)]="f.durationMin" (ngModelChange)="onDurationChange()" placeholder="e.g. 90">
        </label>

        <label class="fld">
          <span>Break (min)</span>
          <input type="number" min="0" step="1" [(ngModel)]="f.breakMin">
        </label>

        <label class="fld">
          <span>Idle (min)</span>
          <input type="number" min="0" step="1" [(ngModel)]="f.idleMin">
        </label>
      </div>

      <div class="toggles">
        <label class="chk"><input type="checkbox" [(ngModel)]="f.isSetup"> Setup time</label>
        <label class="chk"><input type="checkbox" [(ngModel)]="f.isRework"> Rework</label>
      </div>

      <label class="fld full">
        <span>Notes</span>
        <textarea rows="2" [(ngModel)]="f.notes" placeholder="Optional"></textarea>
      </label>

      <p class="hint"><mat-icon>schedule</mat-icon>Worked time = {{ computedSeconds() === null ? '—' : (computedSeconds()! / 60 | number:'1.0-0') }} min{{ f.breakMin > 0 ? ' (less ' + f.breakMin + ' min break)' : '' }}. The labor/machine rate is frozen from the worker, stage and station.</p>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button class="btn ghost" (click)="close()">Cancel</button>
      <button class="btn primary" [disabled]="busy || !valid()" (click)="save()">{{ busy ? 'Saving…' : (data.mode === 'add' ? 'Log time' : 'Save changes') }}</button>
    </mat-dialog-actions>
  `,
  styles: [`
    h2 { font-size: 17px; font-weight: 700; color: var(--clay-text); }
    .err { display: flex; align-items: center; gap: 6px; background: var(--danger-bg); color: var(--danger-text); border-radius: var(--clay-radius-sm); padding: 8px 12px; font-size: 13px; margin: 0 0 12px; }
    .err mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .fld { display: flex; flex-direction: column; gap: 4px; font-size: 12px; font-weight: 600; color: var(--clay-text-secondary); }
    .fld.full { margin-top: 12px; }
    .fld span { letter-spacing: .02em; }
    .fld select, .fld input, .fld textarea { padding: 8px 10px; border: 1px solid var(--clay-border); border-radius: var(--clay-radius-xs); font-size: 13px; background: var(--clay-surface); color: var(--clay-text); font-family: inherit; }
    .fld textarea { resize: vertical; }
    .toggles { display: flex; gap: 18px; margin-top: 12px; }
    .chk { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; color: var(--clay-text); cursor: pointer; }
    .hint { display: flex; align-items: center; gap: 6px; color: var(--clay-text-muted); font-size: 12px; margin: 14px 0 0; }
    .hint mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .btn { display: inline-flex; align-items: center; gap: 4px; border-radius: var(--clay-radius-sm); padding: 8px 16px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; border: 1px solid var(--clay-border); }
    .btn.ghost { background: transparent; color: var(--clay-text-secondary); }
    .btn.primary { background: var(--clay-primary); color: #fff; border-color: var(--clay-primary); }
    .btn:disabled { opacity: .5; cursor: default; }
    @media (max-width: 560px) { .grid { grid-template-columns: 1fr; } }
  `],
})
export class TimeEntryDialogComponent {
  f = {
    userId: '', workOrderStageId: '', stationId: '' as string,
    startLocal: '', endLocal: '', durationMin: null as number | null,
    breakMin: 0, idleMin: 0, isSetup: false, isRework: false, notes: '',
  };
  busy = false;
  error: string | null = null;

  constructor(
    private svc: TimeTrackingService,
    private ref: MatDialogRef<TimeEntryDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: TimeEntryDialogData,
  ) {
    const e = data.entry;
    if (e) {
      this.f.userId = e.userId;
      this.f.workOrderStageId = e.workOrderStageId;
      this.f.stationId = e.stationId ?? '';
      this.f.startLocal = this.toLocalInput(e.startTime);
      this.f.endLocal = e.endTime ? this.toLocalInput(e.endTime) : '';
      if (!e.endTime && e.durationSeconds != null) this.f.durationMin = Math.round(e.durationSeconds / 60);
      this.f.breakMin = Math.round((e.breakSeconds ?? 0) / 60);
      this.f.idleMin = Math.round((e.idleSeconds ?? 0) / 60);
      this.f.isSetup = e.isSetup;
      this.f.isRework = e.isRework;
      this.f.notes = e.notes ?? '';
    } else {
      this.f.startLocal = this.toLocalInput(new Date().toISOString());
      if (data.stages.length === 1) this.f.workOrderStageId = data.stages[0].workOrderStageId;
    }
  }

  onEndChange(): void { if (this.f.endLocal) this.f.durationMin = null; }
  onDurationChange(): void { if (this.f.durationMin != null && this.f.durationMin > 0) this.f.endLocal = ''; }

  /** Effective worked seconds (gross, before break) from end−start or the duration field. */
  computedSeconds(): number | null {
    if (!this.f.startLocal) return null;
    const start = new Date(this.f.startLocal).getTime();
    if (this.f.endLocal) {
      const end = new Date(this.f.endLocal).getTime();
      if (isNaN(end) || end < start) return null;
      return Math.round((end - start) / 1000);
    }
    if (this.f.durationMin != null && this.f.durationMin > 0) return Math.round(this.f.durationMin * 60);
    return null;
  }

  valid(): boolean {
    return !!this.f.userId && !!this.f.workOrderStageId && !!this.f.startLocal && this.computedSeconds() !== null;
  }

  save(): void {
    if (!this.valid() || this.busy) return;
    const start = new Date(this.f.startLocal);
    const seconds = this.computedSeconds()!;
    const end = this.f.endLocal ? new Date(this.f.endLocal) : new Date(start.getTime() + seconds * 1000);
    const breakSeconds = Math.max(0, Math.round((this.f.breakMin || 0) * 60));
    if (breakSeconds > seconds) { this.error = 'Break cannot exceed the worked time.'; return; }

    const payload = {
      userId: this.f.userId,
      workOrderStageId: this.f.workOrderStageId,
      stationId: this.f.stationId || null,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      breakSeconds,
      idleSeconds: Math.max(0, Math.round((this.f.idleMin || 0) * 60)),
      isSetup: this.f.isSetup,
      isRework: this.f.isRework,
      notes: this.f.notes || undefined,
    };
    this.busy = true;
    this.error = null;
    const req = this.data.mode === 'add'
      ? this.svc.create(payload)
      : this.svc.update(this.data.entry!.id, payload);
    req.subscribe({
      next: () => { this.busy = false; this.ref.close('saved'); },
      error: (e) => { this.busy = false; this.error = e?.error?.message || 'Could not save the time entry.'; },
    });
  }

  close(): void { this.ref.close(); }

  /** ISO → 'YYYY-MM-DDTHH:mm' in the browser's local time (for datetime-local inputs). */
  private toLocalInput(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }
}
