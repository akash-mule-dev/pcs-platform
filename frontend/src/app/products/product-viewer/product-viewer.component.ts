import { Component, Inject, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatTooltipModule } from '@angular/material/tooltip';
import { FormsModule } from '@angular/forms';
import { ThreeViewerComponent } from '../../shared/components/three-viewer/three-viewer.component';
import { ArViewerComponent } from '../../shared/components/ar-viewer/ar-viewer.component';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-product-viewer',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatDialogModule, MatButtonModule,
    MatIconModule, MatSelectModule, MatFormFieldModule, MatTooltipModule,
    ThreeViewerComponent, ArViewerComponent,
  ],
  template: `
    <div class="dialog-header" mat-dialog-title>
      <div class="header-left">
        <mat-icon class="header-icon">view_in_ar</mat-icon>
        <div>
          <h2>{{ data.product.name }}</h2>
          <span class="product-id">{{ data.product.id }}</span>
        </div>
      </div>
      <div class="header-right">
        @if (models.length > 1) {
          <mat-form-field appearance="outline" class="model-select">
            <mat-label>Model</mat-label>
            <mat-select [(ngModel)]="selectedModelId" (selectionChange)="onModelChange()">
              @for (m of models; track m.id) {
                <mat-option [value]="m.id">
                  {{ m.originalName }} ({{ (m.fileSize / 1024 / 1024).toFixed(1) }}MB)
                </mat-option>
              }
            </mat-select>
          </mat-form-field>
        }
        <button mat-icon-button (click)="viewMode === '3d' ? viewer?.resetCamera() : null"
                matTooltip="Reset camera" [disabled]="viewMode !== '3d'">
          <mat-icon>center_focus_strong</mat-icon>
        </button>
        <button mat-flat-button class="camera-toggle-btn"
                (click)="toggleViewMode()"
                [matTooltip]="viewMode === '3d' ? 'Open camera / AR view' : 'Back to 3D viewer'">
          <mat-icon>{{ viewMode === '3d' ? 'photo_camera' : 'view_in_ar' }}</mat-icon>
          {{ viewMode === '3d' ? 'Open Camera' : '3D View' }}
        </button>
        <button mat-icon-button (click)="dialogRef.close()" matTooltip="Close">
          <mat-icon>close</mat-icon>
        </button>
      </div>
    </div>

    <mat-dialog-content class="viewer-body">
      @if (selectedModelUrl) {
        @if (viewMode === '3d') {
          <app-three-viewer #viewer
            [modelUrl]="selectedModelUrl"
            (modelLoaded)="onModelLoaded()"
            (meshClicked)="onMeshClicked($event)"
          ></app-three-viewer>
        } @else {
          <app-ar-viewer
            [modelUrl]="selectedModelUrl"
            [modelName]="selectedModel?.originalName"
          ></app-ar-viewer>
        }
      } @else {
        <div class="no-model">
          <mat-icon>cloud_off</mat-icon>
          <p>No 3D model available for this product.</p>
        </div>
      }
    </mat-dialog-content>

    <mat-dialog-actions class="dialog-footer">
      <div class="model-info">
        @if (selectedModel) {
          <span class="info-chip">
            <mat-icon>straighten</mat-icon>
            {{ selectedModel.fileFormat | uppercase }}
          </span>
          <span class="info-chip">
            <mat-icon>save</mat-icon>
            {{ (selectedModel.fileSize / 1024 / 1024).toFixed(1) }} MB
          </span>
          <span class="info-chip">
            <mat-icon>calendar_today</mat-icon>
            {{ selectedModel.createdAt | date:'mediumDate' }}
          </span>
          @if (clickedMesh) {
            <span class="info-chip mesh-chip">
              <mat-icon>touch_app</mat-icon>
              {{ clickedMesh }}
            </span>
          }
        }
      </div>
      <div class="footer-right">
        <span class="model-count">{{ models.length }} model(s)</span>
        <button mat-button (click)="dialogRef.close()">Close</button>
      </div>
    </mat-dialog-actions>
  `,
  styles: [`
    .dialog-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 0 4px; margin-bottom: 0;
    }
    .header-left { display: flex; align-items: center; gap: 12px; }
    .header-icon { font-size: 28px; width: 28px; height: 28px; color: var(--clay-primary, #6b5ce7); }
    h2 { margin: 0; font-size: 18px; color: var(--clay-text, #3d3229); }
    .product-id { font-size: 12px; color: var(--clay-text-muted, #9e8e7e); }
    .header-right { display: flex; align-items: center; gap: 8px; }
    .model-select { width: 240px; margin: 0; }
    ::ng-deep .model-select .mat-mdc-form-field-subscript-wrapper { display: none; }

    .viewer-body { position: relative; }
    .viewer-body app-three-viewer { display: block; width: 100%; height: 100%; }
    ::ng-deep .viewer-body .viewer-container { min-height: 100% !important; height: 100% !important; }

    .no-model {
      display: flex; flex-direction: column; align-items: center;
      justify-content: center; height: 100%;
      color: var(--clay-text-muted, #9e8e7e);
    }
    .no-model mat-icon { font-size: 48px; width: 48px; height: 48px; opacity: 0.4; }

    .dialog-footer {
      display: flex !important; justify-content: space-between; align-items: center;
      padding: 10px 20px;
    }
    .model-info { display: flex; gap: 12px; flex-wrap: wrap; }
    .info-chip {
      display: inline-flex; align-items: center; gap: 4px;
      font-size: 12px; color: var(--clay-text-secondary, #6b5e50);
    }
    .info-chip mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .mesh-chip {
      padding: 2px 8px; border-radius: 10px;
      background: rgba(107, 92, 231, 0.1); color: var(--clay-primary, #6b5ce7);
      font-weight: 500;
    }
    .footer-right { display: flex; align-items: center; gap: 12px; }
    .model-count { font-size: 12px; color: var(--clay-text-muted, #9e8e7e); }

    .camera-toggle-btn {
      display: inline-flex !important;
      align-items: center;
      gap: 6px;
      background: rgba(107, 92, 231, 0.1) !important;
      color: var(--clay-primary, #6b5ce7) !important;
      font-size: 12px;
      font-weight: 600;
      border-radius: 20px !important;
      padding: 0 16px;
      height: 36px;
      transition: all 0.2s;
    }
    .camera-toggle-btn:hover {
      background: rgba(107, 92, 231, 0.2) !important;
      box-shadow: 0 2px 8px rgba(107, 92, 231, 0.25);
    }
    .camera-toggle-btn mat-icon { font-size: 18px; width: 18px; height: 18px; }
  `]
})
export class ProductViewerComponent {
  @ViewChild('viewer') viewer!: ThreeViewerComponent;

  models: any[] = [];
  selectedModelId: string | null = null;
  selectedModelUrl: string | null = null;
  selectedModel: any = null;
  clickedMesh: string | null = null;
  viewMode: '3d' | 'ar' = '3d';

  constructor(
    public dialogRef: MatDialogRef<ProductViewerComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { product: any },
  ) {
    this.models = data.product.models || [];
    if (this.models.length > 0) {
      this.selectedModelId = this.models[0].id;
      this.onModelChange();
    }
  }

  onModelChange(): void {
    this.selectedModel = this.models.find(m => m.id === this.selectedModelId) || null;
    this.selectedModelUrl = this.selectedModel
      ? `${environment.apiUrl}/models/${this.selectedModel.id}/file`
      : null;
    this.clickedMesh = null;
  }

  onModelLoaded(): void {}

  onMeshClicked(meshName: string): void {
    this.clickedMesh = meshName;
  }

  toggleViewMode(): void {
    this.viewMode = this.viewMode === '3d' ? 'ar' : '3d';
    this.clickedMesh = null;
  }
}
