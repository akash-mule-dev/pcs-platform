import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatChipsModule } from '@angular/material/chips';
import { ApiService } from '../../core/services/api.service';
import { ProcessFormComponent } from '../process-form/process-form.component';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'app-process-list',
  standalone: true,
  imports: [CommonModule, RouterModule, MatTableModule, MatButtonModule, MatIconModule, MatChipsModule],
  template: `
    <div class="page-header">
      <h2>Processes</h2>
      <button mat-raised-button color="primary" (click)="openForm()">
        <mat-icon>add</mat-icon> Add Process
      </button>
    </div>

    <table mat-table [dataSource]="processes" class="full-width mat-elevation-z2">
      <ng-container matColumnDef="name">
        <th mat-header-cell *matHeaderCellDef>Name</th>
        <td mat-cell *matCellDef="let p">
          <a [routerLink]="['/processes', p.id]" class="link">{{ p.name }}</a>
        </td>
      </ng-container>
      <ng-container matColumnDef="product">
        <th mat-header-cell *matHeaderCellDef>Product</th>
        <td mat-cell *matCellDef="let p">{{ p.product?.name || '—' }}</td>
      </ng-container>
      <ng-container matColumnDef="version">
        <th mat-header-cell *matHeaderCellDef>Version</th>
        <td mat-cell *matCellDef="let p">v{{ p.version }}</td>
      </ng-container>
      <ng-container matColumnDef="stages">
        <th mat-header-cell *matHeaderCellDef>Stages</th>
        <td mat-cell *matCellDef="let p">{{ p.stages?.length || 0 }}</td>
      </ng-container>
      <ng-container matColumnDef="actions">
        <th mat-header-cell *matHeaderCellDef>Actions</th>
        <td mat-cell *matCellDef="let p">
          <button mat-icon-button color="primary" (click)="openForm(p)"><mat-icon>edit</mat-icon></button>
          <button mat-icon-button color="warn" (click)="deleteProcess(p)"><mat-icon>delete</mat-icon></button>
        </td>
      </ng-container>
      <tr mat-header-row *matHeaderRowDef="columns"></tr>
      <tr mat-row *matRowDef="let row; columns: columns;"></tr>
    </table>
  `,
  styles: [`
    .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    h2 { margin: 0; color: #1a237e; }
    .full-width { width: 100%; }
    .link { color: #1565c0; text-decoration: none; font-weight: 500; }
    .link:hover { text-decoration: underline; }
  `]
})
export class ProcessListComponent implements OnInit {
  processes: any[] = [];
  columns = ['name', 'product', 'version', 'stages', 'actions'];

  constructor(private api: ApiService, private dialog: MatDialog, private snackBar: MatSnackBar) {}

  ngOnInit(): void { this.load(); }

  load(): void {
    this.api.get<any>('/processes').subscribe(data => {
      this.processes = Array.isArray(data) ? data : data.data || [];
    });
  }

  openForm(process?: any): void {
    const ref = this.dialog.open(ProcessFormComponent, { width: '500px', data: process || null });
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
