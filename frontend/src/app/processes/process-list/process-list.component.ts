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
import { PermissionsService } from '../../core/services/permissions.service';
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
        @if (canEdit) {
          <button class="btn-primary" (click)="openForm()">
            <mat-icon>add</mat-icon>
            <span>Add Process</span>
          </button>
        }
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
                <div class="cell-entity">
                  <div class="entity-icon tone-purple">
                    <mat-icon>account_tree</mat-icon>
                  </div>
                  <div class="entity-info">
                    <span class="entity-name">{{ p.name }}</span>
                    <span class="entity-sub">{{ p.product?.name || 'No product' }}</span>
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
              @if (canEdit) {
                <div class="row-actions">
                  <button class="icon-btn" (click)="openForm(p); $event.stopPropagation()" matTooltip="Edit">
                    <mat-icon>edit</mat-icon>
                  </button>
                  <button class="icon-btn icon-btn-danger" (click)="deleteProcess(p); $event.stopPropagation()" matTooltip="Delete">
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
    /* page-header/title/subtitle, btn-primary, toolbar, search-box & meta-count are inherited from global styles.scss */

    /* Table theme, .table-wrap, .cell-entity & .row-actions inherited from global styles.scss */
    .cell-link { text-decoration: none; color: inherit; }

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
  `]
})
export class ProcessListComponent implements OnInit, AfterViewInit {
  dataSource = new MatTableDataSource<any>([]);
  columns = ['name', 'version', 'stages', 'actions'];
  searchTerm = '';
  @ViewChild(MatPaginator) paginator!: MatPaginator;

  canEdit = false;

  constructor(private api: ApiService, private dialog: MatDialog, private snackBar: MatSnackBar, private permissions: PermissionsService) {
    this.canEdit = this.permissions.canManage('processes');
  }

  ngOnInit(): void { this.load(); }

  ngAfterViewInit(): void { this.dataSource.paginator = this.paginator; }

  load(): void {
    this.api.getList<any>('/processes').subscribe(list => {
      this.dataSource.data = list;
    });
  }

  applyFilter(): void {
    this.dataSource.filter = this.searchTerm.trim().toLowerCase();
  }

  openForm(process?: any): void {
    const ref = this.dialog.open(ProcessFormComponent, { width: process ? '500px' : '680px', maxWidth: '94vw', data: process || null });
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
