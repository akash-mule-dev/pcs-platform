import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { ApiService } from '../../core/services/api.service';
import { MatSnackBar } from '@angular/material/snack-bar';

type ItpType = '' | 'hold' | 'witness' | 'review';

@Component({
  selector: 'app-stage-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule, MatCheckboxModule],
  template: `
    <div class="dialog-shell">
      <div class="dialog-header">
        <h2>{{ isEdit ? 'Edit' : 'Add' }} Stage</h2>
        <p class="dialog-subtitle">{{ isEdit ? 'Update stage properties' : 'Define a new workflow stage' }}</p>
      </div>

      <div class="dialog-body">
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Name</mat-label>
          <input matInput [(ngModel)]="form.name" required placeholder="e.g. Welding, Assembly">
        </mat-form-field>
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Target Time (seconds)</mat-label>
          <input matInput type="number" [(ngModel)]="form.targetTimeSeconds" min="0">
        </mat-form-field>
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Hourly rate (costing)</mat-label>
          <input matInput type="number" [(ngModel)]="form.hourlyRate" min="0" placeholder="0 = org default">
          <mat-hint>Standard labor rate for this stage. Used when the clocked worker has no personal rate.</mat-hint>
        </mat-form-field>
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Description</mat-label>
          <textarea matInput [(ngModel)]="form.description" rows="3" placeholder="Optional notes about this stage"></textarea>
        </mat-form-field>

        <!-- ITP (Inspection & Test Plan) intent -->
        <div class="itp">
          <label class="itp-lbl">Inspection &amp; Test Plan point</label>
          <div class="itp-opts">
            @for (o of itpOptions; track o.key) {
              <button type="button" class="itp-chip" [class.on]="form.inspectionType === o.key" (click)="form.inspectionType = o.key">
                {{ o.label }}
              </button>
            }
          </div>
          <p class="itp-hint">{{ itpHint() }}</p>
        </div>

        @if (form.inspectionType) {
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>What to verify / acceptance criteria</mat-label>
            <textarea matInput [(ngModel)]="form.inspectionCriteria" rows="2" placeholder="e.g. AWS D1.1 visual weld; dimensional ±3 mm"></textarea>
          </mat-form-field>
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Required sign-off role (optional)</mat-label>
            <input matInput [(ngModel)]="form.requiredSignoffRole" placeholder="e.g. CWI, QA manager, customer">
          </mat-form-field>
        }
      </div>

      <div class="dialog-footer">
        <button class="btn-ghost" (click)="dialogRef.close()">Cancel</button>
        <button class="btn-primary" (click)="save()" [disabled]="!form.name">
          {{ isEdit ? 'Update' : 'Create' }} Stage
        </button>
      </div>
    </div>
  `,
  styles: [`
    .itp { margin: 2px 2px 12px; }
    .itp-lbl { display: block; font-size: 12px; font-weight: 700; color: var(--clay-text-secondary, #475569); margin-bottom: 6px; }
    .itp-opts { display: flex; gap: 6px; flex-wrap: wrap; }
    .itp-chip { border: 1px solid var(--clay-border, #d8dde6); background: var(--clay-surface, #fff); color: var(--clay-text-secondary, #475569); border-radius: 999px; padding: 6px 14px; font-size: 12.5px; font-weight: 600; cursor: pointer; font-family: inherit; }
    .itp-chip.on { background: var(--clay-primary, #2563eb); color: #fff; border-color: var(--clay-primary, #2563eb); }
    .itp-hint { font-size: 11.5px; color: var(--clay-text-muted, #64748b); margin: 7px 2px 0; }
  `]
})
export class StageDialogComponent {
  isEdit = false;
  form: {
    name: string; targetTimeSeconds: number; description: string; requiresInspection: boolean; hourlyRate: number;
    inspectionType: ItpType; inspectionCriteria: string; requiredSignoffRole: string;
  } = {
    name: '', targetTimeSeconds: 600, description: '', requiresInspection: false, hourlyRate: 0,
    inspectionType: '', inspectionCriteria: '', requiredSignoffRole: '',
  };

  readonly itpOptions: { key: ItpType; label: string }[] = [
    { key: '', label: 'None' },
    { key: 'hold', label: 'Hold' },
    { key: 'witness', label: 'Witness' },
    { key: 'review', label: 'Review' },
  ];

  itpHint(): string {
    switch (this.form.inspectionType) {
      case 'hold': return 'Work stops here — the stage cannot complete until a passing inspection (or approved concession) is recorded on the assembly.';
      case 'witness': return 'Customer / 3rd-party may attend; advisory — does not block completion.';
      case 'review': return 'Document review point; advisory — does not block completion.';
      default: return 'Not an inspection point.';
    }
  }

  constructor(
    public dialogRef: MatDialogRef<StageDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: any,
    private api: ApiService,
    private snackBar: MatSnackBar
  ) {
    if (data.stage) {
      this.isEdit = true;
      const s = data.stage;
      // Migrate the representation: a legacy requiresInspection flag reads as a hold point.
      const inspectionType: ItpType = (s.inspectionType as ItpType) || (s.requiresInspection ? 'hold' : '');
      this.form = {
        name: s.name,
        targetTimeSeconds: s.targetTimeSeconds,
        description: s.description || '',
        requiresInspection: !!s.requiresInspection,
        hourlyRate: Number(s.hourlyRate) || 0,
        inspectionType,
        inspectionCriteria: s.inspectionCharacteristics?.criteria ?? '',
        requiredSignoffRole: s.requiredSignoffRole ?? '',
      };
    }
  }

  /** Build the API body, translating the ITP form into the backend stage fields. */
  private body(): Record<string, any> {
    const criteria = this.form.inspectionCriteria.trim();
    return {
      name: this.form.name,
      targetTimeSeconds: this.form.targetTimeSeconds,
      description: this.form.description,
      hourlyRate: this.form.hourlyRate,
      // Hold points keep the legacy flag in sync; witness/review are advisory.
      requiresInspection: this.form.inspectionType === 'hold',
      inspectionType: this.form.inspectionType || null,
      inspectionCharacteristics: this.form.inspectionType && criteria ? { criteria } : null,
      requiredSignoffRole: this.form.inspectionType ? (this.form.requiredSignoffRole.trim() || null) : null,
    };
  }

  save(): void {
    if (this.isEdit) {
      this.api.patch(`/stages/${this.data.stage.id}`, this.body()).subscribe({
        next: () => { this.snackBar.open('Stage updated', 'Close', { duration: 3000 }); this.dialogRef.close(true); },
        error: () => {}
      });
    } else {
      const body = { ...this.body(), sequence: this.data.sequence };
      this.api.post(`/processes/${this.data.processId}/stages`, body).subscribe({
        next: () => { this.snackBar.open('Stage created', 'Close', { duration: 3000 }); this.dialogRef.close(true); },
        error: () => {}
      });
    }
  }
}
