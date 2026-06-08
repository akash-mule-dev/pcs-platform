import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { HttpClient, HttpRequest, HttpEventType } from '@angular/common/http';
import { ApiService } from '../../core/services/api.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-product-form',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatDialogModule, MatFormFieldModule,
    MatInputModule, MatIconModule, MatProgressBarModule,
  ],
  template: `
    <div class="dialog-shell">
      <div class="dialog-header has-icon">
        <div class="header-icon tone-purple"><mat-icon>inventory_2</mat-icon></div>
        <div class="header-text">
          <h2>{{ data ? 'Edit' : 'Add' }} Product</h2>
          <p class="dialog-subtitle">{{ data ? 'Update product details and 3D model' : 'Create a product and optionally attach a 3D model' }}</p>
        </div>
      </div>

      <div class="dialog-body">
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Name</mat-label>
          <input matInput [(ngModel)]="form.name" required>
        </mat-form-field>
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Description</mat-label>
          <textarea matInput [(ngModel)]="form.description" rows="3"></textarea>
        </mat-form-field>

        <!-- 3D Model Upload Section -->
        <div class="model-upload-section">
          <div class="section-label">3D Model (for Quality Analysis)</div>

          <!-- Existing models (edit mode) -->
          @if (existingModels.length > 0) {
            <div class="existing-models">
              @for (model of existingModels; track model.id) {
                <div class="model-chip">
                  <mat-icon class="model-chip-icon">view_in_ar</mat-icon>
                  <div class="model-chip-info">
                    <span class="model-chip-name">{{ model.originalName }}</span>
                    <span class="model-chip-size">{{ (model.fileSize / 1024 / 1024).toFixed(1) }} MB</span>
                  </div>
                  <button type="button" class="icon-btn icon-btn-danger" (click)="removeExistingModel(model.id)">
                    <mat-icon>close</mat-icon>
                  </button>
                </div>
              }
            </div>
          }

          <!-- Pending file to upload -->
          @if (modelFile || cadFile) {
            <div class="model-chip pending">
              <mat-icon class="model-chip-icon">upload_file</mat-icon>
              <div class="model-chip-info">
                <span class="model-chip-name">{{ (modelFile || cadFile)!.name }}</span>
                <span class="model-chip-size">
                  {{ ((modelFile || cadFile)!.size / 1024 / 1024).toFixed(1) }} MB
                  @if (!uploading) { · Ready to upload }
                  @if (uploading && uploadProgress < 100) { · Uploading {{ uploadProgress }}% }
                  @if (uploading && uploadProgress >= 100) { · Converting to 3D... }
                </span>
              </div>
              @if (!uploading) {
                <button type="button" class="icon-btn icon-btn-danger" (click)="modelFile = null; cadFile = null">
                  <mat-icon>close</mat-icon>
                </button>
              }
            </div>
          }

          @if (uploading) {
            <mat-progress-bar [mode]="uploadProgress < 100 ? 'determinate' : 'indeterminate'"
                              [value]="uploadProgress" class="upload-bar"></mat-progress-bar>
            <div class="upload-status">
              @if (uploadProgress < 100) {
                Uploading... {{ uploadProgress }}%
              } @else {
                Server is processing the file — converting to 3D viewer format...
              }
            </div>
          }

          <div class="upload-actions">
            <button type="button" class="btn-outline" (click)="modelFileInput.click()" [disabled]="uploading">
              <mat-icon>upload_file</mat-icon> Upload 3D Model
            </button>
            <button type="button" class="btn-outline" (click)="cadFileInput.click()" [disabled]="uploading">
              <mat-icon>engineering</mat-icon> Import CAD
            </button>
            <input #modelFileInput type="file" hidden accept=".glb,.gltf,.obj,.fbx,.stl"
                   (change)="onModelFileSelected($event)">
            <input #cadFileInput type="file" hidden accept=".step,.stp,.iges,.igs,.ifc"
                   (change)="onCadFileSelected($event)">
          </div>
          <div class="upload-hint">Supported: GLB, GLTF, OBJ, FBX, STL, STEP, IGES, IFC (max 500MB)</div>
        </div>
      </div>

      <div class="dialog-footer">
        <button type="button" class="btn-ghost" (click)="dialogRef.close()">Cancel</button>
        <button type="button" class="btn-primary" (click)="save()" [disabled]="!form.name || saving">
          {{ saving ? 'Saving…' : (data ? 'Save Changes' : 'Create Product') }}
        </button>
      </div>
    </div>
  `,
  styles: [`
    .model-upload-section {
      margin-top: 4px; padding: 16px;
      background: var(--clay-bg-warm);
      border: 1px dashed var(--clay-border);
      border-radius: var(--clay-radius-sm);
    }
    /* .section-label inherited from global styles.scss */
    .existing-models { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
    .model-chip {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 12px; border-radius: var(--clay-radius-sm);
      background: var(--clay-surface);
      border: 1px solid var(--clay-border);
    }
    .model-chip.pending {
      border-color: var(--clay-primary);
      background: var(--info-bg);
    }
    .model-chip-icon { color: var(--clay-primary); font-size: 20px; width: 20px; height: 20px; }
    .model-chip-info { flex: 1; display: flex; flex-direction: column; min-width: 0; }
    .model-chip-name { font-size: 13px; font-weight: 500; color: var(--clay-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .model-chip-size { font-size: 11px; color: var(--clay-text-muted); }
    .upload-actions { display: flex; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
    .upload-hint { font-size: 11px; color: var(--clay-text-muted); }
    .upload-bar { margin-bottom: 8px; border-radius: 4px; }
    .upload-status {
      font-size: 12px; color: var(--clay-text-muted);
      text-align: center; margin-bottom: 12px;
    }
  `]
})
export class ProductFormComponent {
  form = { name: '', description: '' };
  modelFile: File | null = null;
  cadFile: File | null = null;
  existingModels: any[] = [];
  uploading = false;
  saving = false;
  uploadProgress = 0;

  constructor(
    public dialogRef: MatDialogRef<ProductFormComponent>,
    @Inject(MAT_DIALOG_DATA) public data: any,
    private api: ApiService,
    private http: HttpClient,
    private snackBar: MatSnackBar
  ) {
    if (data) {
      this.form = { name: data.name, description: data.description || '' };
      this.loadExistingModels(data.id);
    }
  }

  loadExistingModels(productId: string): void {
    this.api.getList<any>(`/products/${productId}/models`).subscribe({
      next: (list) => {
        this.existingModels = list;
      },
    });
  }

  onModelFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    this.modelFile = input.files[0];
    this.cadFile = null;
    input.value = '';
  }

  onCadFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    this.cadFile = input.files[0];
    this.modelFile = null;
    input.value = '';
  }

  removeExistingModel(modelId: string): void {
    this.api.delete(`/models/${modelId}`).subscribe({
      next: () => {
        this.existingModels = this.existingModels.filter(m => m.id !== modelId);
        this.snackBar.open('3D model removed', 'Close', { duration: 3000 });
      },
      error: () => this.snackBar.open('Failed to remove model', 'Close', { duration: 3000 }),
    });
  }

  save(): void {
    this.saving = true;
    const obs = this.data
      ? this.api.patch(`/products/${this.data.id}`, this.form)
      : this.api.post('/products', this.form);

    obs.subscribe({
      next: (product: any) => {
        const productId = product.id || this.data?.id;
        if (this.modelFile && productId) {
          this.uploadWithProgress('/models', productId, this.modelFile,
            `Product ${this.data ? 'updated' : 'created'} with 3D model`);
        } else if (this.cadFile && productId) {
          this.uploadWithProgress('/cad/convert-and-upload', productId, this.cadFile,
            `Product ${this.data ? 'updated' : 'created'} with CAD model (converted to GLB)`);
        } else {
          this.saving = false;
          this.snackBar.open(`Product ${this.data ? 'updated' : 'created'}`, 'Close', { duration: 3000 });
          this.dialogRef.close(true);
        }
      },
      error: () => { this.saving = false; }
    });
  }

  private uploadWithProgress(url: string, productId: string, file: File, successMsg: string): void {
    this.uploading = true;
    this.uploadProgress = 0;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('name', `${this.form.name} - 3D Model`);
    formData.append('modelType', 'quality');
    formData.append('productId', productId);

    const req = new HttpRequest('POST', `${environment.apiUrl}${url}`, formData, {
      reportProgress: true,
    });

    this.http.request(req).subscribe({
      next: (event) => {
        if (event.type === HttpEventType.UploadProgress && event.total) {
          this.uploadProgress = Math.round((event.loaded / event.total) * 100);
        }
        if (event.type === HttpEventType.Response) {
          this.uploading = false;
          this.saving = false;
          this.uploadProgress = 0;
          this.snackBar.open(successMsg, 'Close', { duration: 3000 });
          this.dialogRef.close(true);
        }
      },
      error: (err) => {
        this.uploading = false;
        this.saving = false;
        this.uploadProgress = 0;
        this.snackBar.open(
          `Product saved but upload failed: ${err?.error?.message || 'Unknown error'}`,
          'Close', { duration: 5000 }
        );
        this.dialogRef.close(true);
      },
    });
  }
}
