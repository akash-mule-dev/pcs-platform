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
  selector: 'app-product-form',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>{{ data ? 'Edit' : 'Add' }} Product</h2>
    <mat-dialog-content>
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Name</mat-label>
        <input matInput [(ngModel)]="form.name" required>
      </mat-form-field>
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>SKU</mat-label>
        <input matInput [(ngModel)]="form.sku" required>
      </mat-form-field>
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Description</mat-label>
        <textarea matInput [(ngModel)]="form.description" rows="3"></textarea>
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="dialogRef.close()">Cancel</button>
      <button mat-raised-button color="primary" (click)="save()" [disabled]="!form.name || !form.sku">Save</button>
    </mat-dialog-actions>
  `,
  styles: [`.full-width { width: 100%; margin-bottom: 8px; }`]
})
export class ProductFormComponent {
  form = { name: '', sku: '', description: '' };

  constructor(
    public dialogRef: MatDialogRef<ProductFormComponent>,
    @Inject(MAT_DIALOG_DATA) public data: any,
    private api: ApiService,
    private snackBar: MatSnackBar
  ) {
    if (data) {
      this.form = { name: data.name, sku: data.sku, description: data.description || '' };
    }
  }

  save(): void {
    const obs = this.data
      ? this.api.patch(`/products/${this.data.id}`, this.form)
      : this.api.post('/products', this.form);
    obs.subscribe({
      next: () => {
        this.snackBar.open(`Product ${this.data ? 'updated' : 'created'}`, 'Close', { duration: 3000 });
        this.dialogRef.close(true);
      },
      error: () => {}
    });
  }
}
