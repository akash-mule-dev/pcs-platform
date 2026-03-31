import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ArViewerComponent } from '../../shared/components/ar-viewer/ar-viewer.component';

@Component({
  selector: 'app-ar-viewer-dialog',
  standalone: true,
  imports: [
    CommonModule, MatDialogModule, MatButtonModule, MatIconModule,
    MatTooltipModule, ArViewerComponent,
  ],
  template: `
    <div class="dialog-header" mat-dialog-title>
      <div class="header-left">
        <mat-icon class="header-icon">photo_camera</mat-icon>
        <div>
          <h2>{{ data.productName }}</h2>
          <span class="subtitle">Camera / AR View</span>
        </div>
      </div>
      <div class="header-right">
        <button mat-icon-button (click)="dialogRef.close()" matTooltip="Close">
          <mat-icon>close</mat-icon>
        </button>
      </div>
    </div>

    <mat-dialog-content class="ar-body">
      <app-ar-viewer
        [modelUrl]="data.modelUrl"
        [modelName]="data.modelName"
      ></app-ar-viewer>
    </mat-dialog-content>
  `,
  styles: [`
    .dialog-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 0 4px; margin-bottom: 0;
    }
    .header-left { display: flex; align-items: center; gap: 12px; }
    .header-icon { font-size: 28px; width: 28px; height: 28px; color: #27ae60; }
    h2 { margin: 0; font-size: 18px; color: var(--clay-text, #3d3229); }
    .subtitle { font-size: 12px; color: var(--clay-text-muted, #9e8e7e); }
    .header-right { display: flex; align-items: center; gap: 8px; }

    .ar-body { position: relative; }
    .ar-body app-ar-viewer { display: block; width: 100%; height: 100%; }
  `]
})
export class ArViewerDialogComponent {
  constructor(
    public dialogRef: MatDialogRef<ArViewerDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { modelUrl: string; modelName: string; productName: string },
  ) {}
}
