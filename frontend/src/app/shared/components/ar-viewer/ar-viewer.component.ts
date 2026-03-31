import {
  Component, Input, CUSTOM_ELEMENTS_SCHEMA, OnChanges,
  SimpleChanges, ViewChild, ElementRef, AfterViewInit, OnDestroy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import '@google/model-viewer';

@Component({
  selector: 'app-ar-viewer',
  standalone: true,
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div class="ar-viewer-container" #wrapper>
      @if (modelUrl) {
        <model-viewer
          #modelViewer
          [attr.src]="modelUrl"
          camera-controls
          touch-action="pan-y"
          ar
          ar-modes="webxr scene-viewer quick-look"
          ar-scale="auto"
          auto-rotate
          shadow-intensity="1"
          environment-image="neutral"
          exposure="1.0"
          [attr.poster]="null"
          [attr.alt]="modelName || '3D Model'"
          class="model-viewer"
        >
          <button slot="ar-button" class="ar-button">
            <span class="ar-icon">📱</span>
            View in your space
          </button>

          <div class="ar-prompt" slot="ar-prompt">
            <img src="https://modelviewer.dev/shared-assets/icons/hand.png" alt="AR prompt">
          </div>
        </model-viewer>
      } @else {
        <div class="no-model">
          <span class="no-model-icon">📦</span>
          <p>No 3D model available</p>
        </div>
      }

      <div class="ar-controls">
        @if (!arSupported) {
          <div class="ar-fallback-notice">
            <span class="notice-icon">ℹ️</span>
            <span>AR requires a camera-enabled device (mobile/tablet). You can still interact with the 3D model here.</span>
          </div>
        }
        <div class="control-buttons">
          <button class="control-btn" (click)="resetView()" title="Reset camera">
            <span class="btn-icon">🎯</span> Reset View
          </button>
          <button class="control-btn" (click)="toggleAutoRotate()" title="Toggle rotation">
            <span class="btn-icon">{{ autoRotate ? '⏸' : '🔄' }}</span>
            {{ autoRotate ? 'Stop Rotate' : 'Auto Rotate' }}
          </button>
          @if (arSupported) {
            <button class="control-btn ar-activate" (click)="activateAR()" title="Open camera AR">
              <span class="btn-icon">📷</span> Open Camera
            </button>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .ar-viewer-container {
      position: relative;
      width: 100%;
      height: 100%;
      min-height: 400px;
      display: flex;
      flex-direction: column;
      background: var(--clay-surface, #f5f0e8);
      border-radius: var(--clay-radius, 12px);
      overflow: hidden;
    }

    .model-viewer {
      flex: 1;
      width: 100%;
      min-height: 350px;
      --poster-color: transparent;
    }

    .ar-button {
      display: flex;
      align-items: center;
      gap: 8px;
      position: absolute;
      bottom: 16px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--clay-primary, #6b5ce7);
      color: #fff;
      border: none;
      border-radius: 24px;
      padding: 10px 24px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 4px 16px rgba(107, 92, 231, 0.4);
      transition: all 0.2s;
      z-index: 10;
    }
    .ar-button:hover {
      background: #5a4bd6;
      box-shadow: 0 6px 20px rgba(107, 92, 231, 0.5);
    }
    .ar-icon { font-size: 18px; }

    .ar-controls {
      padding: 12px 16px;
      background: var(--clay-bg, #faf7f2);
      border-top: 1px solid var(--clay-border, #e5ddd0);
    }

    .ar-fallback-notice {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      margin-bottom: 10px;
      background: rgba(107, 92, 231, 0.06);
      border-radius: 8px;
      font-size: 12px;
      color: var(--clay-text-secondary, #6b5e50);
    }
    .notice-icon { font-size: 14px; }

    .control-buttons {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .control-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: var(--clay-surface, #f5f0e8);
      border: 1px solid var(--clay-border, #e5ddd0);
      border-radius: 8px;
      padding: 8px 16px;
      font-size: 13px;
      font-weight: 500;
      color: var(--clay-text, #3d3229);
      cursor: pointer;
      transition: all 0.2s;
    }
    .control-btn:hover {
      background: var(--clay-border, #e5ddd0);
    }
    .btn-icon { font-size: 14px; }

    .control-btn.ar-activate {
      background: var(--clay-primary, #6b5ce7);
      color: #fff;
      border-color: var(--clay-primary, #6b5ce7);
    }
    .control-btn.ar-activate:hover {
      background: #5a4bd6;
    }

    .no-model {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: var(--clay-text-muted, #9e8e7e);
    }
    .no-model-icon { font-size: 48px; opacity: 0.4; }
    .no-model p { margin-top: 12px; }
  `]
})
export class ArViewerComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('modelViewer') modelViewerRef!: ElementRef;

  @Input() modelUrl: string | null = null;
  @Input() modelName: string | null = null;

  arSupported = false;
  autoRotate = true;

  private arCheckInterval: any;

  ngAfterViewInit(): void {
    this.checkArSupport();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['modelUrl'] && !changes['modelUrl'].firstChange) {
      setTimeout(() => this.checkArSupport(), 100);
    }
  }

  ngOnDestroy(): void {
    if (this.arCheckInterval) {
      clearTimeout(this.arCheckInterval);
    }
  }

  private checkArSupport(): void {
    const mv = this.modelViewerRef?.nativeElement;
    if (!mv) return;

    // model-viewer exposes canActivateAR after loading
    if (typeof mv.canActivateAR === 'boolean') {
      this.arSupported = mv.canActivateAR;
    } else {
      // Check after model loads
      mv.addEventListener('load', () => {
        this.arSupported = mv.canActivateAR ?? false;
      }, { once: true });

      // Also check via WebXR support
      if ('xr' in navigator) {
        (navigator as any).xr?.isSessionSupported('immersive-ar').then((supported: boolean) => {
          this.arSupported = this.arSupported || supported;
        }).catch(() => {});
      }
    }
  }

  activateAR(): void {
    const mv = this.modelViewerRef?.nativeElement;
    if (mv?.activateAR) {
      mv.activateAR();
    }
  }

  resetView(): void {
    const mv = this.modelViewerRef?.nativeElement;
    if (mv) {
      mv.cameraOrbit = 'auto auto auto';
      mv.cameraTarget = 'auto auto auto';
      mv.fieldOfView = 'auto';
    }
  }

  toggleAutoRotate(): void {
    this.autoRotate = !this.autoRotate;
    const mv = this.modelViewerRef?.nativeElement;
    if (mv) {
      if (this.autoRotate) {
        mv.setAttribute('auto-rotate', '');
      } else {
        mv.removeAttribute('auto-rotate');
      }
    }
  }
}
