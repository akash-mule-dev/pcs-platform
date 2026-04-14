import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ApiService } from '../../core/services/api.service';
import { MatSnackBar } from '@angular/material/snack-bar';

@Component({
  selector: 'app-process-form',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule, MatIconModule],
  template: `
    <div class="dialog-shell">
      <div class="dialog-header">
        <h2>{{ data ? 'Edit' : 'Add' }} Process</h2>
        <p class="dialog-subtitle">{{ data ? 'Update process details' : 'Create a new manufacturing process' }}</p>
      </div>

      <div class="dialog-body">
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Name</mat-label>
          <input matInput [(ngModel)]="form.name" required placeholder="e.g. Assembly Line A">
        </mat-form-field>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Product</mat-label>
          <mat-select [(ngModel)]="form.productId" required>
            @for (p of products; track p.id) {
              <mat-option [value]="p.id">{{ p.name }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        @if (data) {
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Version</mat-label>
            <input matInput type="number" [(ngModel)]="form.version" min="1">
          </mat-form-field>
        } @else {
          <p class="hint-text">Version will be assigned automatically.</p>
        }

        @if (!data) {
          <div class="stages-section">
            <div class="stages-header">
              <h3>Stages</h3>
              <button class="btn-outline" type="button" (click)="addStage()">
                <mat-icon>add</mat-icon> Add Stage
              </button>
            </div>
            @if (stages.length === 0) {
              <div class="stages-empty">
                <mat-icon>layers</mat-icon>
                <span>No stages added yet. You can add stages now or later.</span>
              </div>
            }
            @for (stage of stages; track $index) {
              <div class="stage-row">
                <span class="stage-num">{{ $index + 1 }}</span>
                <mat-form-field appearance="outline" class="stage-name-field">
                  <mat-label>Stage Name</mat-label>
                  <input matInput [(ngModel)]="stage.name" [ngModelOptions]="{standalone: true}" required>
                </mat-form-field>
                <mat-form-field appearance="outline" class="stage-time-field">
                  <mat-label>Target (sec)</mat-label>
                  <input matInput type="number" [(ngModel)]="stage.targetTimeSeconds" [ngModelOptions]="{standalone: true}" min="0">
                </mat-form-field>
                <button class="icon-btn icon-btn-danger" type="button" (click)="removeStage($index)">
                  <mat-icon>close</mat-icon>
                </button>
              </div>
            }
          </div>
        }
      </div>

      <div class="dialog-footer">
        <button class="btn-ghost" (click)="dialogRef.close()">Cancel</button>
        <button class="btn-primary" (click)="save()" [disabled]="!form.name || !form.productId || saving">
          {{ saving ? 'Saving...' : 'Save' }}
        </button>
      </div>
    </div>
  `,
  styles: [`
    .stages-section {
      margin-top: 8px; padding-top: 16px;
      border-top: 1px solid var(--clay-border);
    }
    .stages-header {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 12px;
    }
    .stages-header h3 {
      margin: 0; font-size: 14px; font-weight: 600; color: var(--clay-text);
    }
    .stages-empty {
      display: flex; align-items: center; gap: 8px;
      color: var(--clay-text-muted); font-size: 12px;
      padding: 16px; text-align: center;
      background: var(--clay-bg-warm); border-radius: var(--clay-radius-xs);
    }
    .stages-empty mat-icon { font-size: 18px; width: 18px; height: 18px; opacity: 0.5; }
    .stage-row {
      display: flex; align-items: center; gap: 8px; margin-bottom: 4px;
    }
    .stage-num {
      width: 24px; height: 24px; border-radius: 50%;
      background: var(--clay-primary); color: #fff;
      display: flex; align-items: center; justify-content: center;
      font-size: 11px; font-weight: 700; flex-shrink: 0;
      font-family: 'Space Grotesk', sans-serif;
    }
    .stage-name-field { flex: 1; }
    .stage-time-field { width: 120px; }
  `]
})
export class ProcessFormComponent implements OnInit {
  form: any = { name: '', productId: '', version: 1 };
  products: any[] = [];
  stages: { name: string; targetTimeSeconds: number; description: string }[] = [];
  saving = false;

  constructor(
    public dialogRef: MatDialogRef<ProcessFormComponent>,
    @Inject(MAT_DIALOG_DATA) public data: any,
    private api: ApiService,
    private snackBar: MatSnackBar
  ) {
    if (data) {
      this.form = { name: data.name, productId: data.product?.id || data.productId, version: data.version || 1 };
    }
  }

  ngOnInit(): void {
    this.api.get<any>('/products').subscribe(data => {
      this.products = Array.isArray(data) ? data : data.data || [];
    });
  }

  addStage(): void {
    this.stages.push({ name: '', targetTimeSeconds: 600, description: '' });
  }

  removeStage(index: number): void {
    this.stages.splice(index, 1);
  }

  save(): void {
    this.saving = true;
    const body: any = { name: this.form.name, productId: this.form.productId };
    if (this.data) {
      body.version = this.form.version;
    } else if (this.stages.length > 0) {
      const validStages = this.stages.filter(s => s.name.trim());
      if (validStages.length > 0) {
        body.stages = validStages;
      }
    }
    const obs = this.data
      ? this.api.patch(`/processes/${this.data.id}`, body)
      : this.api.post('/processes', body);
    obs.subscribe({
      next: () => {
        this.snackBar.open(`Process ${this.data ? 'updated' : 'created'}`, 'Close', { duration: 3000 });
        this.dialogRef.close(true);
      },
      error: (err: any) => {
        this.saving = false;
        const msg = err?.error?.message || 'Failed to save process';
        this.snackBar.open(msg, 'Close', { duration: 5000 });
      }
    });
  }
}
