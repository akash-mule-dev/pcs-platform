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
        <mat-checkbox class="hold-point" [(ngModel)]="form.requiresInspection">
          Inspection hold point
          <span class="hold-hint">— stage can only complete once a passing inspection (or approved concession) is recorded on the assembly</span>
        </mat-checkbox>
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
    .hold-point { display: block; margin: 4px 2px 8px; }
    .hold-hint { font-size: 11.5px; color: var(--clay-text-muted, #64748b); }
  `]
})
export class StageDialogComponent {
  isEdit = false;
  form = { name: '', targetTimeSeconds: 600, description: '', requiresInspection: false, hourlyRate: 0 };

  constructor(
    public dialogRef: MatDialogRef<StageDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: any,
    private api: ApiService,
    private snackBar: MatSnackBar
  ) {
    if (data.stage) {
      this.isEdit = true;
      this.form = {
        name: data.stage.name,
        targetTimeSeconds: data.stage.targetTimeSeconds,
        description: data.stage.description || '',
        requiresInspection: !!data.stage.requiresInspection,
        hourlyRate: Number(data.stage.hourlyRate) || 0
      };
    }
  }

  save(): void {
    if (this.isEdit) {
      this.api.patch(`/stages/${this.data.stage.id}`, this.form).subscribe({
        next: () => { this.snackBar.open('Stage updated', 'Close', { duration: 3000 }); this.dialogRef.close(true); },
        error: () => {}
      });
    } else {
      const body = { ...this.form, sequence: this.data.sequence };
      this.api.post(`/processes/${this.data.processId}/stages`, body).subscribe({
        next: () => { this.snackBar.open('Stage created', 'Close', { duration: 3000 }); this.dialogRef.close(true); },
        error: () => {}
      });
    }
  }
}
