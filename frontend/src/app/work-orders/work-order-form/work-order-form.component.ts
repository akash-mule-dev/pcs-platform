import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { ApiService } from '../../core/services/api.service';
import { MatSnackBar } from '@angular/material/snack-bar';

@Component({
  selector: 'app-work-order-form',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule, MatDatepickerModule, MatNativeDateModule],
  template: `
    <h2 mat-dialog-title>New Work Order</h2>
    <mat-dialog-content>
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Product</mat-label>
        <mat-select [(ngModel)]="form.productId" (selectionChange)="onProductChange()">
          @for (p of products; track p.id) {
            <mat-option [value]="p.id">{{ p.name }} ({{ p.sku }})</mat-option>
          }
        </mat-select>
      </mat-form-field>
      @if (processes.length > 0) {
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Process</mat-label>
          <mat-select [(ngModel)]="form.processId">
            @for (p of processes; track p.id) {
              <mat-option [value]="p.id">{{ p.name }} (v{{ p.version }})</mat-option>
            }
          </mat-select>
        </mat-form-field>
      }
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Quantity</mat-label>
        <input matInput type="number" [(ngModel)]="form.quantity" min="1">
      </mat-form-field>
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Priority</mat-label>
        <mat-select [(ngModel)]="form.priority">
          <mat-option value="low">Low</mat-option>
          <mat-option value="medium">Medium</mat-option>
          <mat-option value="high">High</mat-option>
          <mat-option value="urgent">Urgent</mat-option>
        </mat-select>
      </mat-form-field>
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Due Date</mat-label>
        <input matInput [matDatepicker]="picker" [(ngModel)]="form.dueDate">
        <mat-datepicker-toggle matSuffix [for]="picker"></mat-datepicker-toggle>
        <mat-datepicker #picker></mat-datepicker>
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="dialogRef.close()">Cancel</button>
      <button mat-raised-button color="primary" (click)="save()" [disabled]="!form.productId || !form.processId || !form.quantity">Create</button>
    </mat-dialog-actions>
  `,
  styles: [`.full-width { width: 100%; margin-bottom: 8px; }`]
})
export class WorkOrderFormComponent implements OnInit {
  products: any[] = [];
  processes: any[] = [];
  form: any = { productId: '', processId: '', quantity: 1, priority: 'medium', dueDate: null };

  constructor(
    public dialogRef: MatDialogRef<WorkOrderFormComponent>,
    private api: ApiService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.api.get<any>('/products').subscribe(data => {
      this.products = Array.isArray(data) ? data : data.data || [];
    });
  }

  onProductChange(): void {
    this.api.get<any>('/processes', { productId: this.form.productId }).subscribe(data => {
      this.processes = Array.isArray(data) ? data : data.data || [];
      if (this.processes.length > 0) {
        this.form.processId = this.processes[0].id;
      }
    });
  }

  save(): void {
    const body = { ...this.form };
    if (body.dueDate) body.dueDate = new Date(body.dueDate).toISOString();
    this.api.post('/work-orders', body).subscribe({
      next: () => {
        this.snackBar.open('Work order created', 'Close', { duration: 3000 });
        this.dialogRef.close(true);
      },
      error: () => {}
    });
  }
}
