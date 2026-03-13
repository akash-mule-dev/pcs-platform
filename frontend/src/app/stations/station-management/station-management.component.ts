import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatListModule } from '@angular/material/list';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatDividerModule } from '@angular/material/divider';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ApiService } from '../../core/services/api.service';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'app-station-management',
  standalone: true,
  imports: [CommonModule, FormsModule, MatCardModule, MatListModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule, MatExpansionModule, MatDividerModule],
  template: `
    <h2>Lines & Stations</h2>

    <div class="layout-grid">
      <mat-card class="lines-panel">
        <mat-card-header>
          <mat-card-title>Production Lines</mat-card-title>
        </mat-card-header>
        <mat-card-content>
          <div class="add-form">
            <mat-form-field appearance="outline" class="flex-grow">
              <mat-label>New Line Name</mat-label>
              <input matInput [(ngModel)]="newLineName">
            </mat-form-field>
            <button mat-raised-button color="primary" (click)="addLine()" [disabled]="!newLineName">
              <mat-icon>add</mat-icon>
            </button>
          </div>
          <mat-nav-list>
            @for (line of lines; track line.id) {
              <a mat-list-item (click)="selectLine(line)" [class.selected]="selectedLine?.id === line.id">
                <mat-icon matListItemIcon>factory</mat-icon>
                <span matListItemTitle>{{ line.name }}</span>
              </a>
            }
          </mat-nav-list>
        </mat-card-content>
      </mat-card>

      <mat-card class="stations-panel">
        @if (selectedLine) {
          <mat-card-header>
            <mat-card-title>Stations — {{ selectedLine.name }}</mat-card-title>
          </mat-card-header>
          <mat-card-content>
            <div class="add-form">
              <mat-form-field appearance="outline" class="flex-grow">
                <mat-label>New Station Name</mat-label>
                <input matInput [(ngModel)]="newStationName">
              </mat-form-field>
              <button mat-raised-button color="primary" (click)="addStation()" [disabled]="!newStationName">
                <mat-icon>add</mat-icon>
              </button>
            </div>
            @for (station of stations; track station.id) {
              <mat-card class="station-item">
                @if (editingStation?.id === station.id) {
                  <mat-form-field appearance="outline" class="flex-grow">
                    <input matInput [(ngModel)]="editingStation.name">
                  </mat-form-field>
                  <button mat-icon-button color="primary" (click)="saveStation()"><mat-icon>check</mat-icon></button>
                  <button mat-icon-button (click)="editingStation = null"><mat-icon>close</mat-icon></button>
                } @else {
                  <mat-icon class="station-icon">computer</mat-icon>
                  <span class="station-name">{{ station.name }}</span>
                  <span class="spacer"></span>
                  <button mat-icon-button color="primary" (click)="editStation(station)"><mat-icon>edit</mat-icon></button>
                  <button mat-icon-button color="warn" (click)="deleteStation(station)"><mat-icon>delete</mat-icon></button>
                }
              </mat-card>
            }
            @if (stations.length === 0) {
              <p class="no-data">No stations. Add one above.</p>
            }
          </mat-card-content>
        } @else {
          <mat-card-content class="select-prompt">
            <mat-icon>arrow_back</mat-icon>
            <p>Select a production line</p>
          </mat-card-content>
        }
      </mat-card>
    </div>
  `,
  styles: [`
    h2 { margin: 0 0 24px; color: var(--clay-text); }
    .layout-grid { display: grid; grid-template-columns: 320px 1fr; gap: 24px; }
    .lines-panel, .stations-panel { padding: 16px; }
    .add-form { display: flex; gap: 8px; align-items: flex-start; margin-bottom: 16px; }
    .flex-grow { flex: 1; }
    .selected {
      background: var(--clay-surface) !important;
      box-shadow: var(--clay-shadow-raised);
      color: var(--clay-primary) !important;
    }
    .station-item {
      display: flex; align-items: center; padding: 12px 16px; margin-bottom: 8px; gap: 12px;
      box-shadow: var(--clay-shadow-soft);
      border-radius: var(--clay-radius-sm);
    }
    .station-icon { color: var(--clay-accent); }
    .station-name { font-weight: 500; }
    .spacer { flex: 1; }
    .no-data { text-align: center; color: var(--clay-text-muted); padding: 24px; }
    .select-prompt { text-align: center; padding: 60px 24px; color: var(--clay-text-muted); }
    .select-prompt mat-icon { font-size: 48px; width: 48px; height: 48px; color: var(--clay-text-muted); opacity: 0.4; }
    @media (max-width: 768px) { .layout-grid { grid-template-columns: 1fr; } }
  `]
})
export class StationManagementComponent implements OnInit {
  lines: any[] = [];
  selectedLine: any = null;
  stations: any[] = [];
  newLineName = '';
  newStationName = '';
  editingStation: any = null;

  constructor(private api: ApiService, private dialog: MatDialog, private snackBar: MatSnackBar) {}

  ngOnInit(): void { this.loadLines(); }

  loadLines(): void {
    this.api.get<any>('/lines').subscribe(data => {
      this.lines = Array.isArray(data) ? data : data.data || [];
    });
  }

  selectLine(line: any): void {
    this.selectedLine = line;
    this.loadStations();
  }

  loadStations(): void {
    if (!this.selectedLine) return;
    this.api.get<any>(`/lines/${this.selectedLine.id}/stations`).subscribe(data => {
      this.stations = Array.isArray(data) ? data : data.data || [];
    });
  }

  addLine(): void {
    this.api.post('/lines', { name: this.newLineName }).subscribe({
      next: () => {
        this.snackBar.open('Line created', 'Close', { duration: 3000 });
        this.newLineName = '';
        this.loadLines();
      }
    });
  }

  addStation(): void {
    this.api.post('/stations', { name: this.newStationName, lineId: this.selectedLine.id }).subscribe({
      next: () => {
        this.snackBar.open('Station created', 'Close', { duration: 3000 });
        this.newStationName = '';
        this.loadStations();
      }
    });
  }

  editStation(station: any): void {
    this.editingStation = { ...station };
  }

  saveStation(): void {
    this.api.patch(`/stations/${this.editingStation.id}`, { name: this.editingStation.name }).subscribe({
      next: () => {
        this.snackBar.open('Station updated', 'Close', { duration: 3000 });
        this.editingStation = null;
        this.loadStations();
      }
    });
  }

  deleteStation(station: any): void {
    const ref = this.dialog.open(ConfirmDialogComponent, {
      data: { title: 'Delete Station', message: `Delete "${station.name}"?` }
    });
    ref.afterClosed().subscribe(confirmed => {
      if (confirmed) {
        this.api.delete(`/stations/${station.id}`).subscribe(() => {
          this.snackBar.open('Station deleted', 'Close', { duration: 3000 });
          this.loadStations();
        });
      }
    });
  }
}
