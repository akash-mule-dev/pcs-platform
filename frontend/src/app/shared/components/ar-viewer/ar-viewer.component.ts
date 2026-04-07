import {
  Component, Input, CUSTOM_ELEMENTS_SCHEMA, OnChanges,
  SimpleChanges, ViewChild, ElementRef, AfterViewInit, OnDestroy, NgZone
} from '@angular/core';
import { CommonModule } from '@angular/common';
import '@google/model-viewer';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

@Component({
  selector: 'app-ar-viewer',
  standalone: true,
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div class="ar-viewer-container" #wrapper>
      @if (!arSessionActive) {
        <!-- Normal 3D preview mode -->
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
          </model-viewer>
        } @else {
          <div class="no-model">
            <span class="no-model-icon">📦</span>
            <p>No 3D model available</p>
          </div>
        }
      } @else {
        <!-- Custom AR camera session -->
        <div class="ar-camera-container" #arContainer>
          <video #cameraVideo autoplay playsinline class="camera-feed"></video>
          <canvas #arCanvas class="ar-overlay"
            (click)="onCanvasTap($event)"
            (touchend)="onCanvasTouch($event)">
          </canvas>
          @if (!modelPlaced) {
            <div class="tap-hint">
              <span class="hint-icon">👆</span>
              <span>Tap anywhere to place the model</span>
            </div>
          }
          @if (modelPlaced) {
            <div class="placed-controls">
              <button class="placed-btn" (click)="removeModel()">
                <span>🗑️</span> Remove
              </button>
              <button class="placed-btn" (click)="removeModel()">
                <span>📍</span> Reposition
              </button>
            </div>
          }
        </div>
      }

      <div class="ar-controls">
        @if (!arSessionActive) {
          <div class="control-buttons">
            <button class="control-btn" (click)="resetView()" title="Reset camera">
              <span class="btn-icon">🎯</span> Reset View
            </button>
            <button class="control-btn" (click)="toggleAutoRotate()" title="Toggle rotation">
              <span class="btn-icon">{{ autoRotate ? '⏸' : '🔄' }}</span>
              {{ autoRotate ? 'Stop Rotate' : 'Auto Rotate' }}
            </button>
            @if (modelUrl) {
              <button class="control-btn ar-activate" (click)="startARSession()" title="Start AR session">
                <span class="btn-icon">📷</span> Start AR Session
              </button>
            }
          </div>
        } @else {
          <div class="control-buttons">
            <button class="control-btn ar-stop" (click)="stopARSession()" title="Stop AR session">
              <span class="btn-icon">✕</span> Stop AR Session
            </button>
          </div>
        }
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

    .ar-camera-container {
      flex: 1;
      position: relative;
      width: 100%;
      min-height: 350px;
      background: #000;
      overflow: hidden;
    }

    .camera-feed {
      position: absolute;
      top: 0; left: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .ar-overlay {
      position: absolute;
      top: 0; left: 0;
      width: 100%;
      height: 100%;
      cursor: crosshair;
    }

    .tap-hint {
      position: absolute;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      gap: 8px;
      background: rgba(0, 0, 0, 0.7);
      color: #fff;
      padding: 12px 24px;
      border-radius: 24px;
      font-size: 14px;
      font-weight: 500;
      pointer-events: none;
      animation: pulse 2s ease-in-out infinite;
      z-index: 10;
    }
    .hint-icon { font-size: 20px; }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.6; }
    }

    .placed-controls {
      position: absolute;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      gap: 8px;
      z-index: 10;
    }

    .placed-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      background: rgba(0, 0, 0, 0.7);
      color: #fff;
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 20px;
      padding: 8px 16px;
      font-size: 13px;
      cursor: pointer;
      transition: background 0.2s;
    }
    .placed-btn:hover {
      background: rgba(0, 0, 0, 0.85);
    }

    .ar-controls {
      padding: 12px 16px;
      background: var(--clay-bg, #faf7f2);
      border-top: 1px solid var(--clay-border, #e5ddd0);
    }

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
      background: var(--clay-primary, #5a4bd6);
    }

    .control-btn.ar-stop {
      background: var(--danger, #e74c3c);
      color: #fff;
      border-color: var(--danger, #e74c3c);
    }
    .control-btn.ar-stop:hover {
      background: var(--danger, #c0392b);
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
  @ViewChild('cameraVideo') cameraVideoRef!: ElementRef<HTMLVideoElement>;
  @ViewChild('arCanvas') arCanvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('arContainer') arContainerRef!: ElementRef<HTMLDivElement>;

  @Input() modelUrl: string | null = null;
  @Input() modelName: string | null = null;

  arSupported = false;
  autoRotate = true;
  arSessionActive = false;
  modelPlaced = false;

  private arCheckInterval: any;
  private mediaStream: MediaStream | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private loadedModel: THREE.Group | null = null;
  private placedModel: THREE.Object3D | null = null;
  private animationFrameId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;

  constructor(private ngZone: NgZone) {}

  ngAfterViewInit(): void {
    this.checkArSupport();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['modelUrl'] && !changes['modelUrl'].firstChange) {
      this.loadedModel = null;
      if (this.arSessionActive) {
        this.stopARSession();
      }
      setTimeout(() => this.checkArSupport(), 100);
    }
  }

  ngOnDestroy(): void {
    if (this.arCheckInterval) {
      clearTimeout(this.arCheckInterval);
    }
    this.stopARSession();
  }

  private checkArSupport(): void {
    const mv = this.modelViewerRef?.nativeElement;
    if (!mv) return;

    if (typeof mv.canActivateAR === 'boolean') {
      this.arSupported = mv.canActivateAR;
    } else {
      mv.addEventListener('load', () => {
        this.arSupported = mv.canActivateAR ?? false;
      }, { once: true });

      if ('xr' in navigator) {
        (navigator as any).xr?.isSessionSupported('immersive-ar').then((supported: boolean) => {
          this.arSupported = this.arSupported || supported;
        }).catch(() => {});
      }
    }
  }

  async startARSession(): Promise<void> {
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
      });

      this.arSessionActive = true;
      this.modelPlaced = false;
      this.placedModel = null;

      // Wait for the view to render the camera elements
      setTimeout(() => this.initARScene(), 50);
    } catch (err) {
      console.error('Failed to access camera:', err);
      alert('Could not access your camera. Please grant camera permission and try again.');
    }
  }

  private initARScene(): void {
    const video = this.cameraVideoRef?.nativeElement;
    const canvas = this.arCanvasRef?.nativeElement;
    const container = this.arContainerRef?.nativeElement;
    if (!video || !canvas || !container) return;

    // Set camera video source
    video.srcObject = this.mediaStream;
    video.play();

    const width = container.clientWidth;
    const height = container.clientHeight;

    // Setup Three.js scene
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, width / height, 0.01, 1000);
    this.camera.position.set(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(0x000000, 0);

    // Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 1.0);
    this.scene.add(ambient);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(2, 4, 3);
    this.scene.add(dirLight);

    // Pre-load the 3D model
    if (this.modelUrl && !this.loadedModel) {
      const loader = new GLTFLoader();
      loader.load(this.modelUrl, (gltf) => {
        this.loadedModel = gltf.scene;
        // Normalize model size
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = 0.5 / maxDim; // Normalize to ~0.5 units
        this.loadedModel.scale.setScalar(scale);
        // Center the model at its origin
        const center = box.getCenter(new THREE.Vector3());
        this.loadedModel.position.sub(center.multiplyScalar(scale));
      });
    }

    // Handle resize
    this.resizeObserver = new ResizeObserver(() => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (this.camera && this.renderer) {
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
      }
    });
    this.resizeObserver.observe(container);

    // Start render loop
    this.ngZone.runOutsideAngular(() => this.renderLoop());
  }

  private renderLoop(): void {
    if (!this.arSessionActive || !this.renderer || !this.scene || !this.camera) return;

    // Slowly rotate placed model for visual feedback
    if (this.placedModel) {
      this.placedModel.rotation.y += 0.005;
    }

    this.renderer.render(this.scene, this.camera);
    this.animationFrameId = requestAnimationFrame(() => this.renderLoop());
  }

  onCanvasTap(event: MouseEvent): void {
    if (!this.arSessionActive || !this.loadedModel || !this.camera || !this.scene) return;

    const canvas = this.arCanvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    // Convert click to normalized device coordinates
    const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.placeModelAt(ndcX, ndcY);
  }

  onCanvasTouch(event: TouchEvent): void {
    if (!this.arSessionActive || !this.loadedModel || !this.camera || !this.scene) return;
    event.preventDefault();

    const touch = event.changedTouches[0];
    if (!touch) return;

    const canvas = this.arCanvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const ndcX = ((touch.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((touch.clientY - rect.top) / rect.height) * 2 + 1;

    this.placeModelAt(ndcX, ndcY);
  }

  private placeModelAt(ndcX: number, ndcY: number): void {
    if (!this.scene || !this.camera || !this.loadedModel) return;

    // Remove previous placement
    if (this.placedModel) {
      this.scene.remove(this.placedModel);
    }

    // Clone the pre-loaded model
    const model = this.loadedModel.clone();

    // Place the model at a fixed distance in front of the camera,
    // offset by the tap position
    const distance = 2;
    const vector = new THREE.Vector3(ndcX, ndcY, -1).normalize();
    model.position.copy(vector.multiplyScalar(distance));

    this.scene.add(model);
    this.placedModel = model;

    this.ngZone.run(() => {
      this.modelPlaced = true;
    });
  }

  removeModel(): void {
    if (this.placedModel && this.scene) {
      this.scene.remove(this.placedModel);
      this.placedModel = null;
    }
    this.modelPlaced = false;
  }

  stopARSession(): void {
    this.arSessionActive = false;
    this.modelPlaced = false;

    if (this.animationFrameId != null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(t => t.stop());
      this.mediaStream = null;
    }

    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }

    if (this.placedModel && this.scene) {
      this.scene.remove(this.placedModel);
    }
    this.placedModel = null;
    this.scene = null;
    this.camera = null;
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
