import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { ApiService } from '../../core/services/api.service';
import { MatSnackBar } from '@angular/material/snack-bar';

@Component({
  selector: 'app-work-order-form',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatIconModule, MatDatepickerModule, MatNativeDateModule],
  template: `
    <div class="dialog-shell">
      <div class="dialog-header has-icon">
        <div class="header-icon tone-blue"><mat-icon>assignment</mat-icon></div>
        <div class="header-text">
          <h2>New Work Order</h2>
          <p class="dialog-subtitle">Schedule production for a product and its process</p>
        </div>
      </div>

      <div class="dialog-body">
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Product</mat-label>
          <mat-select [(ngModel)]="form.productId" (selectionChange)="onProductChange()">
            @for (p of products; track p.id) {
              <mat-option [value]="p.id">{{ p.name }}</mat-option>
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
        } @else if (form.productId) {
          <p class="hint-text">
            <mat-icon class="inline-ico">info</mat-icon>
            No processes defined for this product yet.
          </p>
        }

        <div class="form-row">
          <mat-form-field appearance="outline">
            <mat-label>Quantity</mat-label>
            <input matInput type="number" [(ngModel)]="form.quantity" min="1">
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Priority</mat-label>
            <mat-select [(ngModel)]="form.priority">
              <mat-option value="low">Low</mat-option>
              <mat-option value="medium">Medium</mat-option>
              <mat-option value="high">High</mat-option>
              <mat-option value="urgent">Urgent</mat-option>
            </mat-select>
          </mat-form-field>
        </div>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Production Line</mat-label>
          <mat-select [(ngModel)]="form.lineId">
            <mat-option [value]="''">— None —</mat-option>
            @for (l of lines; track l.id) {
              <mat-option [value]="l.id">{{ l.name }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Due Date</mat-label>
          <input matInput [matDatepicker]="picker" [(ngModel)]="form.dueDate">
          <mat-datepicker-toggle matIconSuffix [for]="picker"></mat-datepicker-toggle>
          <mat-datepicker #picker></mat-datepicker>
        </mat-form-field>
      </div>

      <div class="dialog-footer">
        <button type="button" class="btn-ghost" (click)="dialogRef.close()">Cancel</button>
        <button type="button" class="btn-primary" (click)="save()" [disabled]="!form.productId || !form.processId || !form.quantity || saving">
          {{ saving ? 'Creating…' : 'Create Work Order' }}
        </button>
      </div>
    </div>
  `,
  styles: [`
    .hint-text { display: flex; align-items: center; gap: 6px; }
    .inline-ico { font-size: 15px; width: 15px; height: 15px; flex-shrink: 0; }
  `]
})
export class WorkOrderFormComponent implements OnInit {
  products: any[] = [];
  processes: any[] = [];
  lines: any[] = [];
  saving = false;
  form: any = { productId: '', processId: '', lineId: '', quantity: 1, priority: 'medium', dueDate: null };

  constructor(
    public dialogRef: MatDialogRef<WorkOrderFormComponent>,
    private api: ApiService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.api.getList<any>('/products').subscribe(list => {
      this.products = list;
    });
    this.api.getList<any>('/lines').subscribe(list => {
      this.lines = list;
    });
  }

  onProductChange(): void {
    this.api.getList<any>('/processes', { productId: this.form.productId }).subscribe(list => {
      this.processes = list;
      this.form.processId = this.processes.length > 0 ? this.processes[0].id : '';
    });
  }

  save(): void {
    this.saving = true;
    const body = { ...this.form };
    if (body.dueDate) body.dueDate = new Date(body.dueDate).toISOString();
    if (!body.lineId) delete body.lineId;
    this.api.post('/work-orders', body).subscribe({
      next: () => {
        this.snackBar.open('Work order created', 'Close', { duration: 3000 });
        this.dialogRef.close(true);
      },
      error: (err: any) => {
        this.saving = false;
        const msg = err?.error?.message || 'Failed to create work order';
        this.snackBar.open(msg, 'Close', { duration: 5000 });
      }
    });
  }
}
