import { Component, OnInit, AfterViewInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatPaginatorModule, MatPaginator } from '@angular/material/paginator';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ApiService } from '../../core/services/api.service';
import { PermissionsService } from '../../core/services/permissions.service';
import { ProductFormComponent } from '../product-form/product-form.component';
import { ProductViewerComponent } from '../product-viewer/product-viewer.component';
import { ArViewerDialogComponent } from '../ar-viewer-dialog/ar-viewer-dialog.component';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog/confirm-dialog.component';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-product-list',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterModule, MatTableModule, MatPaginatorModule,
    MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule, MatDialogModule,
    MatTooltipModule,
  ],
  template: `
    <div class="page-shell">
      <!-- Page Header -->
      <div class="page-header">
        <div class="header-left">
          <h1 class="page-title">Product Catalog</h1>
          <p class="page-subtitle">Manage your manufacturing product library</p>
        </div>
        @if (canEdit) {
          <button class="btn-primary" (click)="openForm()">
            <mat-icon>add</mat-icon>
            <span>Create New Product</span>
          </button>
        }
      </div>

      <!-- Toolbar -->
      <div class="toolbar">
        <div class="search-box">
          <mat-icon class="search-ico">search</mat-icon>
          <input type="text" placeholder="Search products..." [(ngModel)]="searchTerm" (ngModelChange)="applyFilter()">
        </div>
        <div class="meta-count">
          <span class="count-num">{{ dataSource.filteredData.length }}</span> products
        </div>
      </div>

      <!-- Table -->
      <div class="table-wrap">
        <table mat-table [dataSource]="dataSource" class="sb-table">
          <ng-container matColumnDef="name">
            <th mat-header-cell *matHeaderCellDef>Product</th>
            <td mat-cell *matCellDef="let p">
              <div class="cell-entity">
                <div class="entity-icon">
                  <mat-icon>inventory_2</mat-icon>
                </div>
                <div class="entity-info">
                  <span class="entity-name">{{ p.name }}</span>
                  <span class="entity-sub">{{ p.description || 'No description' }}</span>
                </div>
              </div>
            </td>
          </ng-container>
          <ng-container matColumnDef="model">
            <th mat-header-cell *matHeaderCellDef>3D Model</th>
            <td mat-cell *matCellDef="let p">
              @if (p.models?.length > 0) {
                <div class="model-actions">
                  <button class="action-chip chip-primary" (click)="view3D(p)" matTooltip="View 3D model">
                    <mat-icon>view_in_ar</mat-icon>
                    <span>View 3D</span>
                    @if (p.models.length > 1) {
                      <span class="chip-badge">{{ p.models.length }}</span>
                    }
                  </button>
                  <button class="action-chip chip-success" (click)="viewAR(p)" matTooltip="View with camera (AR)">
                    <mat-icon>photo_camera</mat-icon>
                    <span>AR</span>
                  </button>
                </div>
              } @else {
                <span class="no-model">
                  <mat-icon>view_in_ar</mat-icon> No model
                </span>
              }
            </td>
          </ng-container>
          <ng-container matColumnDef="actions">
            <th mat-header-cell *matHeaderCellDef></th>
            <td mat-cell *matCellDef="let p">
              @if (canEdit) {
                <div class="row-actions">
                  <button class="icon-btn" (click)="openForm(p)" matTooltip="Edit">
                    <mat-icon>edit</mat-icon>
                  </button>
                  <button class="icon-btn icon-btn-danger" (click)="deleteProduct(p)" matTooltip="Delete">
                    <mat-icon>delete_outline</mat-icon>
                  </button>
                </div>
              }
            </td>
          </ng-container>
          <tr mat-header-row *matHeaderRowDef="columns"></tr>
          <tr mat-row *matRowDef="let row; columns: columns;"></tr>
        </table>
      </div>

      <mat-paginator [pageSize]="10" [pageSizeOptions]="[5, 10, 25]" showFirstLastButtons></mat-paginator>
    </div>
  `,
  styles: [`
    .page-shell { max-width: 1200px; }
    /* page-header/title/subtitle, btn-primary, toolbar, search-box & meta-count inherited from global styles.scss */

    /* Table theme, .table-wrap & .cell-entity inherited from global styles.scss */

    /* Action chips */
    .model-actions { display: flex; gap: 6px; }
    .action-chip {
      display: inline-flex; align-items: center; gap: 4px;
      border: none; border-radius: 4px; padding: 4px 10px;
      font-size: 11px; font-weight: 600; cursor: pointer;
      font-family: 'Space Grotesk', sans-serif;
      transition: all 0.15s; letter-spacing: 0.02em;
    }
    .action-chip mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .chip-primary {
      background: var(--info-bg); color: var(--info-text);
    }
    .chip-primary:hover { filter: brightness(1.2); }
    .chip-success {
      background: var(--success-bg); color: var(--success-text);
    }
    .chip-success:hover { filter: brightness(1.2); }
    .chip-badge {
      background: var(--clay-primary); color: #fff;
      font-size: 9px; font-weight: 700;
      width: 16px; height: 16px; line-height: 16px;
      border-radius: 50%; text-align: center;
    }
    .no-model {
      display: inline-flex; align-items: center; gap: 4px;
      color: var(--clay-text-muted); font-size: 12px;
    }
    .no-model mat-icon { font-size: 16px; width: 16px; height: 16px; opacity: 0.5; }

  `]
})
export class ProductListComponent implements OnInit, AfterViewInit {
  products: any[] = [];
  dataSource = new MatTableDataSource<any>([]);
  columns = ['name', 'model', 'actions'];
  searchTerm = '';
  @ViewChild(MatPaginator) paginator!: MatPaginator;

  canEdit = false;

  constructor(private api: ApiService, private dialog: MatDialog, private snackBar: MatSnackBar, private permissions: PermissionsService) {
    this.canEdit = this.permissions.canManage('products');
  }

  ngOnInit(): void { this.load(); }

  ngAfterViewInit(): void { this.dataSource.paginator = this.paginator; }

  load(): void {
    this.api.getList<any>('/products').subscribe(list => {
      this.products = list;
      this.applyFilter();
    });
  }

  applyFilter(): void {
    const term = this.searchTerm.toLowerCase();
    this.dataSource.data = this.products.filter(p =>
      p.name.toLowerCase().includes(term)
    );
  }

  openForm(product?: any): void {
    const ref = this.dialog.open(ProductFormComponent, { width: '560px', data: product || null });
    ref.afterClosed().subscribe(result => { if (result) this.load(); });
  }

  view3D(product: any): void {
    this.dialog.open(ProductViewerComponent, {
      width: '90vw',
      height: '85vh',
      maxWidth: '1400px',
      data: { product },
      panelClass: 'product-viewer-dialog',
    });
  }

  viewAR(product: any): void {
    const models = product.models || [];
    if (models.length === 0) return;
    const model = models[0];
    const modelUrl = `${environment.apiUrl}/models/${model.id}/file`;

    this.dialog.open(ArViewerDialogComponent, {
      width: '90vw',
      height: '85vh',
      maxWidth: '1400px',
      data: { modelUrl, modelName: model.originalName, productName: product.name },
      panelClass: 'ar-viewer-dialog',
    });
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
