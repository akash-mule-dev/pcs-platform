import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { ApiService } from '../../core/services/api.service';
import { MatSnackBar } from '@angular/material/snack-bar';

@Component({
  selector: 'app-stage-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>{{ isEdit ? 'Edit' : 'Add' }} Stage</h2>
    <mat-dialog-content>
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Name</mat-label>
        <input matInput [(ngModel)]="form.name" required>
      </mat-form-field>
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Target Time (seconds)</mat-label>
        <input matInput type="number" [(ngModel)]="form.targetTimeSeconds" min="0">
      </mat-form-field>
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Description</mat-label>
        <textarea matInput [(ngModel)]="form.description" rows="3"></textarea>
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="dialogRef.close()">Cancel</button>
      <button mat-raised-button color="primary" (click)="save()" [disabled]="!form.name">Save</button>
    </mat-dialog-actions>
  `,
  styles: [`.full-width { width: 100%; margin-bottom: 8px; }`]
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
