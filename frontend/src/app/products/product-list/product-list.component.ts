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
import { AuthService } from '../../core/services/auth.service';
import { canManage } from '../../core/permissions';
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
              <div class="cell-product">
                <div class="product-icon">
                  <mat-icon>inventory_2</mat-icon>
                </div>
                <div class="product-info">
                  <span class="product-name">{{ p.name }}</span>
                  <span class="product-desc">{{ p.description || 'No description' }}</span>
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
    /* ===== Page Shell ===== */
    .page-shell { max-width: 1200px; }

    .page-header {
      display: flex; justify-content: space-between; align-items: flex-start;
      margin-bottom: 24px;
    }
    .page-title {
      margin: 0; font-size: 24px; font-weight: 700; color: var(--clay-text);
      letter-spacing: -0.02em;
    }
    .page-subtitle {
      margin: 4px 0 0; font-size: 13px; color: var(--clay-text-muted);
    }

    .btn-primary {
      display: inline-flex; align-items: center; gap: 6px;
      background: var(--clay-primary); color: #fff;
      border: none; border-radius: var(--clay-radius-sm);
      padding: 10px 20px; font-size: 13px; font-weight: 600;
      cursor: pointer; transition: all 0.2s;
      font-family: inherit;
    }
    .btn-primary:hover { filter: brightness(1.1); transform: translateY(-1px); }
    .btn-primary mat-icon { font-size: 18px; width: 18px; height: 18px; }

    /* ===== Toolbar ===== */
    .toolbar {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 16px; gap: 16px;
    }
    .search-box {
      display: flex; align-items: center; gap: 8px;
      background: var(--clay-surface); border: 1px solid var(--clay-border);
      border-radius: var(--clay-radius-sm); padding: 8px 14px;
      width: 320px; transition: border-color 0.2s;
    }
    .search-box:focus-within { border-color: var(--clay-primary); }
    .search-ico { font-size: 18px; width: 18px; height: 18px; color: var(--clay-text-muted); }
    .search-box input {
      border: none; outline: none; background: transparent;
      font-size: 13px; color: var(--clay-text); width: 100%;
      font-family: inherit;
    }
    .search-box input::placeholder { color: var(--clay-text-muted); }
    .meta-count { font-size: 12px; color: var(--clay-text-muted); font-family: 'Space Grotesk', sans-serif; }
    .count-num { font-weight: 600; color: var(--clay-text-secondary); }

    /* ===== Table ===== */
    .table-wrap {
      background: var(--clay-surface); border-radius: var(--clay-radius);
      border: 1px solid var(--clay-border); overflow: hidden;
    }
    .sb-table { width: 100%; }

    ::ng-deep .sb-table .mat-mdc-header-row {
      background: var(--clay-bg-warm) !important; height: 44px;
    }
    ::ng-deep .sb-table .mat-mdc-header-cell {
      color: var(--clay-text-muted) !important; font-weight: 600 !important;
      font-size: 11px !important; text-transform: uppercase;
      letter-spacing: 0.06em; border-bottom: 1px solid var(--clay-border) !important;
      font-family: 'Space Grotesk', sans-serif !important;
    }
    ::ng-deep .sb-table .mat-mdc-row {
      border-bottom: 1px solid var(--clay-border) !important;
      transition: background 0.15s; height: 64px;
    }
    ::ng-deep .sb-table .mat-mdc-row:hover {
      background: var(--clay-surface-hover) !important;
    }
    ::ng-deep .sb-table .mat-mdc-cell {
      color: var(--clay-text) !important; font-size: 13px;
      border-bottom: none !important;
    }

    /* Product cell */
    .cell-product { display: flex; align-items: center; gap: 12px; }
    .product-icon {
      width: 40px; height: 40px; border-radius: var(--clay-radius-xs);
      background: var(--kpi-blue-bg); color: var(--kpi-blue-fg);
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    .product-icon mat-icon { font-size: 20px; width: 20px; height: 20px; }
    .product-info { display: flex; flex-direction: column; gap: 2px; }
    .product-name { font-weight: 600; font-size: 13px; color: var(--clay-text); }
    .product-desc {
      font-size: 11px; color: var(--clay-text-muted);
      max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }

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

    /* Row actions */
    .row-actions { display: flex; gap: 2px; }
    .icon-btn {
      width: 32px; height: 32px; border-radius: var(--clay-radius-xs);
      border: none; background: transparent; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      color: var(--clay-text-muted); transition: all 0.15s;
    }
    .icon-btn:hover { background: var(--clay-surface-hover); color: var(--clay-text); }
    .icon-btn-danger:hover { color: var(--danger); background: var(--danger-bg); }
    .icon-btn mat-icon { font-size: 18px; width: 18px; height: 18px; }

    @media (max-width: 768px) {
      .toolbar { flex-direction: column; align-items: stretch; }
      .search-box { width: 100%; }
    }
  `]
})
export class ProductListComponent implements OnInit, AfterViewInit {
  products: any[] = [];
  dataSource = new MatTableDataSource<any>([]);
  columns = ['name', 'model', 'actions'];
  searchTerm = '';
  @ViewChild(MatPaginator) paginator!: MatPaginator;

  canEdit = false;

  constructor(private api: ApiService, private dialog: MatDialog, private snackBar: MatSnackBar, private auth: AuthService) {
    this.canEdit = canManage('products', this.auth.userRole);
  }

  ngOnInit(): void { this.load(); }

  ngAfterViewInit(): void { this.dataSource.paginator = this.paginator; }

  load(): void {
    this.api.get<any>('/products').subscribe(data => {
      this.products = Array.isArray(data) ? data : data.data || [];
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
