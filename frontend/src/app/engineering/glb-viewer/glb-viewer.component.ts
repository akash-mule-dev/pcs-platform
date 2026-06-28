import { Component, ElementRef, OnDestroy, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { ThreeViewerComponent } from '../../shared/components/three-viewer/three-viewer.component';
import { fileAccept } from '../../shared/upload-accept';

/**
 * Engineering › Model Viewer.
 *
 * View a .glb / .gltf model straight from the user's computer. The file is read
 * locally and turned into an object URL — nothing is uploaded to the server — so
 * an engineer can sanity-check a model on the portal before it's ever published.
 */
@Component({
  selector: 'app-glb-viewer',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule, ThreeViewerComponent],
  template: `
    <div class="page">
      <div class="page-header">
        <h1><mat-icon>view_in_ar</mat-icon> Model Viewer</h1>
        <p class="subtitle">
          Open a <strong>.glb</strong> or <strong>.gltf</strong> 3D model from your computer.
          The file is rendered locally in your browser — nothing is uploaded.
        </p>
      </div>

      @if (!modelUrl) {
        <div
          class="dropzone"
          [class.drag]="dragOver"
          (click)="fileInput.click()"
          (dragover)="onDragOver($event)"
          (dragleave)="onDragLeave($event)"
          (drop)="onDrop($event)"
        >
          <mat-icon class="big">cloud_upload</mat-icon>
          <p class="dz-title">Drag a <strong>.glb</strong> / <strong>.gltf</strong> file here</p>
          <p class="dz-sub">or click to choose a file</p>
          <span class="fake-btn">Choose file</span>
          <input
            #fileInput
            type="file"
            [attr.accept]="acceptModel"
            hidden
            (change)="onPick($event)"
          />
          @if (error) {
            <p class="error"><mat-icon>error_outline</mat-icon> {{ error }}</p>
          }
        </div>
      } @else {
        <div class="toolbar">
          <span class="fname"><mat-icon>deployed_code</mat-icon> {{ fileName }}</span>
          <span class="spacer"></span>
          <div class="modes">
            <button mat-button [class.active]="renderMode === 'solid'" (click)="setMode('solid')">Solid</button>
            <button mat-button [class.active]="renderMode === 'xray'" (click)="setMode('xray')">X-Ray</button>
          </div>
          <button mat-icon-button (click)="resetView()" aria-label="Reset view">
            <mat-icon>center_focus_strong</mat-icon>
          </button>
          <button mat-button (click)="clear()"><mat-icon>refresh</mat-icon> Load another</button>
        </div>
        <div class="viewer">
          <app-three-viewer [modelUrl]="modelUrl" [renderMode]="renderMode"></app-three-viewer>
        </div>
      }
    </div>
  `,
  styles: [`
    .page { padding: 24px; max-width: 1200px; margin: 0 auto; }
    .page-header h1 {
      display: flex; align-items: center; gap: 10px;
      font-size: 24px; font-weight: 700; color: var(--clay-text, #3d3229); margin: 0;
    }
    .subtitle { color: var(--clay-text-muted, #8a7d6d); margin: 6px 0 20px; }

    .dropzone {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 10px; text-align: center; cursor: pointer;
      min-height: 360px; padding: 40px;
      border: 2px dashed var(--clay-border, #d5c8b5); border-radius: var(--clay-radius, 12px);
      background: var(--clay-surface, #f5f0e8);
      transition: border-color 0.2s, background 0.2s;
    }
    .dropzone.drag { border-color: var(--clay-primary, #6b5ce7); background: rgba(107, 92, 231, 0.06); }
    .dropzone .big { font-size: 56px; width: 56px; height: 56px; color: var(--clay-primary, #6b5ce7); }
    .dz-title { font-size: 16px; color: var(--clay-text, #3d3229); margin: 4px 0 0; }
    .dz-sub { font-size: 13px; color: var(--clay-text-muted, #8a7d6d); margin: 0; }
    .fake-btn {
      margin-top: 8px; padding: 9px 20px; border-radius: 999px;
      background: var(--clay-primary, #6b5ce7); color: #fff; font-weight: 600; font-size: 14px;
    }
    .error {
      display: flex; align-items: center; gap: 6px; margin-top: 12px;
      color: var(--danger, #c0392b); font-size: 14px;
    }
    .error mat-icon { font-size: 18px; width: 18px; height: 18px; }

    .toolbar {
      display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
      padding: 10px 12px; margin-bottom: 12px;
      background: var(--clay-surface, #f5f0e8); border-radius: var(--clay-radius, 12px);
    }
    .fname { display: flex; align-items: center; gap: 6px; font-weight: 600; color: var(--clay-text, #3d3229); }
    .fname mat-icon { font-size: 20px; width: 20px; height: 20px; }
    .spacer { flex: 1; }
    .modes { display: flex; gap: 4px; }
    .modes .active { background: var(--clay-primary, #6b5ce7); color: #fff; }

    .viewer { height: calc(100vh - 240px); min-height: 480px; }
  `]
})
export class GlbViewerComponent implements OnDestroy {
  /** Desktop accept filter; dropped on iOS so WebKit doesn't grey out .glb/.gltf files. */
  readonly acceptModel = fileAccept('.glb,.gltf,model/gltf-binary');
  @ViewChild(ThreeViewerComponent) private viewer?: ThreeViewerComponent;

  modelUrl: string | null = null;
  fileName = '';
  renderMode: 'solid' | 'xray' = 'solid';
  error: string | null = null;
  dragOver = false;

  onPick(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.loadFile(input.files?.[0] ?? null);
    input.value = ''; // allow re-picking the same file
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver = false;
    this.loadFile(event.dataTransfer?.files?.[0] ?? null);
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragOver = true;
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.dragOver = false;
  }

  setMode(mode: 'solid' | 'xray'): void {
    this.renderMode = mode;
  }

  resetView(): void {
    this.viewer?.resetCamera();
  }

  clear(): void {
    this.revoke();
    this.modelUrl = null;
    this.fileName = '';
    this.error = null;
    this.renderMode = 'solid';
  }

  ngOnDestroy(): void {
    this.revoke();
  }

  private loadFile(file: File | null): void {
    if (!file) return;
    const name = file.name.toLowerCase();
    if (!name.endsWith('.glb') && !name.endsWith('.gltf')) {
      this.error = 'Please choose a .glb or .gltf file.';
      return;
    }
    this.revoke();
    this.error = null;
    this.fileName = file.name;
    this.renderMode = 'solid';
    this.modelUrl = URL.createObjectURL(file);
  }

  private revoke(): void {
    if (this.modelUrl) {
      URL.revokeObjectURL(this.modelUrl);
      this.modelUrl = null;
    }
  }
}
