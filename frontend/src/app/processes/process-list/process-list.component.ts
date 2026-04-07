import { Component, OnInit, AfterViewInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatPaginatorModule, MatPaginator } from '@angular/material/paginator';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ApiService } from '../../core/services/api.service';
import { ProcessFormComponent } from '../process-form/process-form.component';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'app-process-list',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, MatTableModule, MatPaginatorModule, MatButtonModule, MatIconModule, MatChipsModule, MatTooltipModule],
  template: `
    <div class="page-shell">
      <!-- Page Header -->
      <div class="page-header">
        <div class="header-left">
          <h1 class="page-title">Processes</h1>
          <p class="page-subtitle">Define manufacturing workflows and stage sequences</p>
        </div>
        <button class="btn-primary" (click)="openForm()">
          <mat-icon>add</mat-icon>
          <span>Add Process</span>
        </button>
      </div>

      <!-- Toolbar -->
      <div class="toolbar">
        <div class="search-box">
          <mat-icon class="search-ico">search</mat-icon>
          <input type="text" placeholder="Search processes..." [(ngModel)]="searchTerm" (ngModelChange)="applyFilter()">
        </div>
        <div class="meta-count">
          <span class="count-num">{{ dataSource.filteredData.length }}</span> processes
        </div>
      </div>

      <!-- Table -->
      <div class="table-wrap">
        <table mat-table [dataSource]="dataSource" class="sb-table">
          <ng-container matColumnDef="name">
            <th mat-header-cell *matHeaderCellDef>Process</th>
            <td mat-cell *matCellDef="let p">
              <a [routerLink]="['/processes', p.id]" class="cell-link">
                <div class="cell-process">
                  <div class="process-icon">
                    <mat-icon>account_tree</mat-icon>
                  </div>
                  <div class="process-info">
                    <span class="process-name">{{ p.name }}</span>
                    <span class="process-product">{{ p.product?.name || 'No product' }}</span>
                  </div>
                </div>
              </a>
            </td>
          </ng-container>
          <ng-container matColumnDef="version">
            <th mat-header-cell *matHeaderCellDef>Version</th>
            <td mat-cell *matCellDef="let p">
              <span class="version-tag">v{{ p.version }}</span>
            </td>
          </ng-container>
          <ng-container matColumnDef="stages">
            <th mat-header-cell *matHeaderCellDef>Stages</th>
            <td mat-cell *matCellDef="let p">
              <span class="stage-count">{{ p.stages?.length || 0 }}</span>
            </td>
          </ng-container>
          <ng-container matColumnDef="actions">
            <th mat-header-cell *matHeaderCellDef></th>
            <td mat-cell *matCellDef="let p">
              <div class="row-actions">
                <button class="icon-btn" (click)="openForm(p); $event.stopPropagation()" matTooltip="Edit">
                  <mat-icon>edit</mat-icon>
                </button>
                <button class="icon-btn icon-btn-danger" (click)="deleteProcess(p); $event.stopPropagation()" matTooltip="Delete">
                  <mat-icon>delete_outline</mat-icon>
                </button>
              </div>
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

    .page-header {
      display: flex; justify-content: space-between; align-items: flex-start;
      margin-bottom: 24px;
    }
    .page-title {
      margin: 0; font-size: 24px; font-weight: 700; color: var(--clay-text);
      letter-spacing: -0.02em;
    }
    .page-subtitle { margin: 4px 0 0; font-size: 13px; color: var(--clay-text-muted); }

    .btn-primary {
      display: inline-flex; align-items: center; gap: 6px;
      background: var(--clay-primary); color: #fff;
      border: none; border-radius: var(--clay-radius-sm);
      padding: 10px 20px; font-size: 13px; font-weight: 600;
      cursor: pointer; transition: all 0.2s; font-family: inherit;
    }
    .btn-primary:hover { filter: brightness(1.1); transform: translateY(-1px); }
    .btn-primary mat-icon { font-size: 18px; width: 18px; height: 18px; }

    /* Toolbar */
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
      font-size: 13px; color: var(--clay-text); width: 100%; font-family: inherit;
    }
    .search-box input::placeholder { color: var(--clay-text-muted); }
    .meta-count { font-size: 12px; color: var(--clay-text-muted); font-family: 'Space Grotesk', sans-serif; }
    .count-num { font-weight: 600; color: var(--clay-text-secondary); }

    /* Table */
    .table-wrap {
      background: var(--clay-surface); border-radius: var(--clay-radius);
      border: 1px solid var(--clay-border); overflow: hidden;
    }
    .sb-table { width: 100%; }
    ::ng-deep .sb-table .mat-mdc-header-row { background: var(--clay-bg-warm) !important; height: 44px; }
    ::ng-deep .sb-table .mat-mdc-header-cell {
      color: var(--clay-text-muted) !important; font-weight: 600 !important;
      font-size: 11px !important; text-transform: uppercase;
      letter-spacing: 0.06em; border-bottom: 1px solid var(--clay-border) !important;
      font-family: 'Space Grotesk', sans-serif !important;
    }
    ::ng-deep .sb-table .mat-mdc-row {
      border-bottom: 1px solid var(--clay-border) !important;
      transition: background 0.15s; height: 60px;
    }
    ::ng-deep .sb-table .mat-mdc-row:hover { background: var(--clay-surface-hover) !important; }
    ::ng-deep .sb-table .mat-mdc-cell {
      color: var(--clay-text) !important; font-size: 13px; border-bottom: none !important;
    }

    /* Process cell */
    .cell-link { text-decoration: none; color: inherit; }
    .cell-process { display: flex; align-items: center; gap: 12px; }
    .process-icon {
      width: 40px; height: 40px; border-radius: var(--clay-radius-xs);
      background: var(--kpi-purple-bg); color: var(--kpi-purple-fg);
      display: flex; align-items: center; justify-content: center; flex-shrink: 0;
    }
    .process-icon mat-icon { font-size: 20px; width: 20px; height: 20px; }
    .process-info { display: flex; flex-direction: column; gap: 2px; }
    .process-name { font-weight: 600; font-size: 13px; color: var(--clay-text); }
    .process-product { font-size: 11px; color: var(--clay-text-muted); }

    .version-tag {
      font-family: 'Space Grotesk', monospace; font-size: 12px;
      font-weight: 600; color: var(--clay-text-secondary);
      background: var(--clay-bg-warm); padding: 2px 8px;
      border-radius: 4px;
    }
    .stage-count {
      font-family: 'Space Grotesk', monospace; font-size: 14px;
      font-weight: 600; color: var(--clay-text);
    }

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
export class ProcessListComponent implements OnInit, AfterViewInit {
  dataSource = new MatTableDataSource<any>([]);
  columns = ['name', 'version', 'stages', 'actions'];
  searchTerm = '';
  @ViewChild(MatPaginator) paginator!: MatPaginator;

  constructor(private api: ApiService, private dialog: MatDialog, private snackBar: MatSnackBar) {}

  ngOnInit(): void { this.load(); }

  ngAfterViewInit(): void { this.dataSource.paginator = this.paginator; }

  load(): void {
    this.api.get<any>('/processes').subscribe(data => {
      this.dataSource.data = Array.isArray(data) ? data : data.data || [];
    });
  }

  applyFilter(): void {
    this.dataSource.filter = this.searchTerm.trim().toLowerCase();
  }

  openForm(process?: any): void {
    const ref = this.dialog.open(ProcessFormComponent, { width: process ? '500px' : '640px', data: process || null });
    ref.afterClosed().subscribe(result => { if (result) this.load(); });
  }

  deleteProcess(process: any): void {
    const ref = this.dialog.open(ConfirmDialogComponent, {
      data: { title: 'Delete Process', message: `Delete "${process.name}"?` }
    });
    ref.afterClosed().subscribe(confirmed => {
      if (confirmed) {
        this.api.delete(`/processes/${process.id}`).subscribe(() => {
          this.snackBar.open('Process deleted', 'Close', { duration: 3000 });
          this.load();
        });
      }
    });
  }
}
