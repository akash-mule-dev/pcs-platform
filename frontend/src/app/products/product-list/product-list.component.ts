import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ApiService } from '../../core/services/api.service';
import { ProductFormComponent } from '../product-form/product-form.component';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'app-product-list',
  standalone: true,
  imports: [CommonModule, FormsModule, MatTableModule, MatPaginatorModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule, MatDialogModule],
  template: `
    <div class="page-header">
      <h2>Products</h2>
      <button mat-raised-button color="primary" (click)="openForm()">
        <mat-icon>add</mat-icon> Add Product
      </button>
    </div>

    <mat-form-field appearance="outline" class="search-field">
      <mat-label>Search products</mat-label>
      <input matInput [(ngModel)]="searchTerm" (ngModelChange)="applyFilter()" placeholder="Name or SKU">
      <mat-icon matPrefix>search</mat-icon>
    </mat-form-field>

    <table mat-table [dataSource]="filtered" class="full-width mat-elevation-z2">
      <ng-container matColumnDef="name">
        <th mat-header-cell *matHeaderCellDef>Name</th>
        <td mat-cell *matCellDef="let p">{{ p.name }}</td>
      </ng-container>
      <ng-container matColumnDef="sku">
        <th mat-header-cell *matHeaderCellDef>SKU</th>
        <td mat-cell *matCellDef="let p">{{ p.sku }}</td>
      </ng-container>
      <ng-container matColumnDef="description">
        <th mat-header-cell *matHeaderCellDef>Description</th>
        <td mat-cell *matCellDef="let p">{{ p.description || '—' }}</td>
      </ng-container>
      <ng-container matColumnDef="actions">
        <th mat-header-cell *matHeaderCellDef>Actions</th>
        <td mat-cell *matCellDef="let p">
          <button mat-icon-button color="primary" (click)="openForm(p)"><mat-icon>edit</mat-icon></button>
          <button mat-icon-button color="warn" (click)="deleteProduct(p)"><mat-icon>delete</mat-icon></button>
        </td>
      </ng-container>
      <tr mat-header-row *matHeaderRowDef="columns"></tr>
      <tr mat-row *matRowDef="let row; columns: columns;"></tr>
    </table>

    <mat-paginator [length]="products.length" [pageSize]="10" [pageSizeOptions]="[5, 10, 25]"
      (page)="onPage($event)"></mat-paginator>
  `,
  styles: [`
    .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    h2 { margin: 0; color: #1a237e; }
    .search-field { width: 300px; margin-bottom: 8px; }
    .full-width { width: 100%; }
  `]
})
export class ProductListComponent implements OnInit {
  products: any[] = [];
  filtered: any[] = [];
  columns = ['name', 'sku', 'description', 'actions'];
  searchTerm = '';

  constructor(private api: ApiService, private dialog: MatDialog, private snackBar: MatSnackBar) {}

  ngOnInit(): void { this.load(); }

  load(): void {
    this.api.get<any>('/products').subscribe(data => {
      this.products = Array.isArray(data) ? data : data.data || [];
      this.applyFilter();
    });
  }

  applyFilter(): void {
    const term = this.searchTerm.toLowerCase();
    this.filtered = this.products.filter(p =>
      p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term)
    );
  }

  onPage(event: PageEvent): void {}

  openForm(product?: any): void {
    const ref = this.dialog.open(ProductFormComponent, { width: '500px', data: product || null });
    ref.afterClosed().subscribe(result => { if (result) this.load(); });
  }

  deleteProduct(product: any): void {
    const ref = this.dialog.open(ConfirmDialogComponent, {
      data: { title: 'Delete Product', message: `Delete "${product.name}"?` }
    });
    ref.afterClosed().subscribe(confirmed => {
      if (confirmed) {
        this.api.delete(`/products/${product.id}`).subscribe(() => {
          this.snackBar.open('Product deleted', 'Close', { duration: 3000 });
          this.load();
        });
      }
    });
  }
}
