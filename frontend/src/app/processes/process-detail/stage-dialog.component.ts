import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ApiService } from '../../core/services/api.service';
import { MatSnackBar } from '@angular/material/snack-bar';

@Component({
  selector: 'app-stage-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule],
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
          <mat-label>Description</mat-label>
          <textarea matInput [(ngModel)]="form.description" rows="3" placeholder="Optional notes about this stage"></textarea>
        </mat-form-field>
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
    .dialog-shell { padding: 4px; }
    .dialog-header { margin-bottom: 20px; }
    .dialog-header h2 {
      margin: 0; font-size: 18px; font-weight: 700;
      color: var(--clay-text); letter-spacing: -0.01em;
    }
    .dialog-subtitle { margin: 4px 0 0; font-size: 12px; color: var(--clay-text-muted); }
    .dialog-body { display: flex; flex-direction: column; gap: 4px; }
    .full-width { width: 100%; }
    .dialog-footer {
      display: flex; justify-content: flex-end; gap: 8px;
      margin-top: 20px; padding-top: 16px;
      border-top: 1px solid var(--clay-border);
    }
    .btn-primary {
      display: inline-flex; align-items: center; gap: 6px;
      background: var(--clay-primary); color: #fff;
      border: none; border-radius: var(--clay-radius-sm);
      padding: 10px 24px; font-size: 13px; font-weight: 600;
      cursor: pointer; transition: all 0.2s; font-family: inherit;
    }
    .btn-primary:hover { filter: brightness(1.1); }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; filter: none; }
    .btn-ghost {
      background: transparent; color: var(--clay-text-secondary);
      border: none; border-radius: var(--clay-radius-sm);
      padding: 10px 20px; font-size: 13px; font-weight: 500;
      cursor: pointer; transition: all 0.2s; font-family: inherit;
    }
    .btn-ghost:hover { background: var(--clay-surface-hover); }
  `]
})
export class StageDialogComponent {
  isEdit = false;
  form = { name: '', targetTimeSeconds: 600, description: '' };

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
        description: data.stage.description || ''
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
