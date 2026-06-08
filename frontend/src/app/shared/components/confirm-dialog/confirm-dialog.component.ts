import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';

export interface ConfirmDialogData {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
}

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [MatDialogModule, MatIconModule],
  template: `
    <div class="dialog-shell confirm-shell">
      <div class="dialog-header has-icon">
        <div class="header-icon tone-danger">
          <mat-icon>warning_amber</mat-icon>
        </div>
        <div class="header-text">
          <h2>{{ data.title }}</h2>
        </div>
      </div>

      <div class="dialog-body">
        <p class="confirm-message">{{ data.message }}</p>
      </div>

      <div class="dialog-footer">
        <button type="button" class="btn-ghost" (click)="dialogRef.close(false)">{{ data.cancelText || 'Cancel' }}</button>
        <button type="button" class="btn-danger" (click)="dialogRef.close(true)">{{ data.confirmText || 'Delete' }}</button>
      </div>
    </div>
  `,
  styles: [`
    .confirm-shell { min-width: min(380px, 86vw); }
    .confirm-message {
      margin: 0; font-size: 14px; line-height: 1.5;
      color: var(--clay-text-secondary);
    }
  `]
})
export class ConfirmDialogComponent {
  constructor(
    public dialogRef: MatDialogRef<ConfirmDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: ConfirmDialogData
  ) {}
}
