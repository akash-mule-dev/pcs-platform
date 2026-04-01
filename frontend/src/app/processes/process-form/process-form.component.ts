import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { ApiService } from '../../core/services/api.service';
import { MatSnackBar } from '@angular/material/snack-bar';

@Component({
  selector: 'app-process-form',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>{{ data ? 'Edit' : 'Add' }} Process</h2>
    <mat-dialog-content>
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Name</mat-label>
        <input matInput [(ngModel)]="form.name" required>
      </mat-form-field>
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Product</mat-label>
        <mat-select [(ngModel)]="form.productId" required>
          @for (p of products; track p.id) {
            <mat-option [value]="p.id">{{ p.name }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Version</mat-label>
        <input matInput type="number" [(ngModel)]="form.version" min="1">
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="dialogRef.close()">Cancel</button>
      <button mat-raised-button color="primary" (click)="save()" [disabled]="!form.name || !form.productId">Save</button>
    </mat-dialog-actions>
  `,
  styles: [`.full-width { width: 100%; margin-bottom: 8px; }`]
})
export class ProcessFormComponent implements OnInit {
  form: any = { name: '', productId: '', version: 1 };
  products: any[] = [];

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

  save(): void {
    const body = { name: this.form.name, productId: this.form.productId, version: this.form.version };
    const obs = this.data
      ? this.api.patch(`/processes/${this.data.id}`, body)
      : this.api.post('/processes', body);
    obs.subscribe({
      next: () => {
        this.snackBar.open(`Process ${this.data ? 'updated' : 'created'}`, 'Close', { duration: 3000 });
        this.dialogRef.close(true);
      },
      error: () => {}
    });
  }
}
