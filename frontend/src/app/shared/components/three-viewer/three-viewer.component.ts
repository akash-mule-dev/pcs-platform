import {
  Component, ElementRef, ViewChild, Input, OnDestroy, AfterViewInit,
  Output, EventEmitter, OnChanges, SimpleChanges
} from '@angular/core';
import { CommonModule } from '@angular/common';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

@Component({
  selector: 'app-three-viewer',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="viewer-container" #container>
      @if (loading) {
        <div class="loading-overlay">
          @if (loadProgress > 0 && loadProgress < 100) {
            <div class="progress-ring">
              <svg viewBox="0 0 80 80">
                <circle class="ring-bg" cx="40" cy="40" r="34"/>
                <circle class="ring-fg" cx="40" cy="40" r="34"
                  [attr.stroke-dasharray]="213.6"
                  [attr.stroke-dashoffset]="213.6 - (213.6 * loadProgress / 100)"/>
              </svg>
              <span class="progress-text">{{ loadProgress }}%</span>
            </div>
            <span>Downloading 3D Model...</span>
          } @else {
            <div class="spinner"></div>
            <span>Loading 3D Model...</span>
          }
        </div>
      }
      @if (error) {
        <div class="error-overlay">
          <span>{{ error }}</span>
        </div>
      }
      <canvas #canvas></canvas>
    </div>
  `,
  styles: [`
    .viewer-container {
      position: relative;
      width: 100%;
      height: 100%;
      min-height: 400px;
      background: var(--clay-surface, #f5f0e8);
      border-radius: var(--clay-radius, 12px);
      overflow: hidden;
      box-shadow: var(--clay-shadow-raised, 0 4px 12px rgba(0,0,0,0.1));
    }
    canvas { display: block; width: 100%; height: 100%; }
    .loading-overlay, .error-overlay {
      position: absolute; top: 0; left: 0; right: 0; bottom: 0;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 16px; z-index: 5;
      background: rgba(245,240,232,0.85);
      color: var(--clay-text, #3d3229);
    }
    .spinner {
      width: 40px; height: 40px;
      border: 3px solid var(--clay-border, #ddd);
      border-top-color: var(--clay-primary, #6b5ce7);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .error-overlay { color: #c0392b; }
    .progress-ring {
      position: relative; width: 80px; height: 80px;
    }
    .progress-ring svg { width: 80px; height: 80px; transform: rotate(-90deg); }
    .ring-bg { fill: none; stroke: var(--clay-border, #ddd); stroke-width: 6; }
    .ring-fg {
      fill: none; stroke: var(--clay-primary, #6b5ce7); stroke-width: 6;
      stroke-linecap: round; transition: stroke-dashoffset 0.3s ease;
    }
    .progress-text {
      position: absolute; top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      font-size: 16px; font-weight: 700;
      color: var(--clay-primary, #6b5ce7);
    }
  `]
})
export class ThreeViewerComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('canvas') canvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('container') containerRef!: ElementRef<HTMLDivElement>;

  @Input() modelUrl: string | null = null;
  @Input() qualityData: { meshName: string; status: 'pass' | 'fail' | 'warning' }[] = [];
  @Output() modelLoaded = new EventEmitter<void>();
  @Output() meshClicked = new EventEmitter<string>(); // emits meshName on click

  loading = false;
  loadProgress = 0;
  error: string | null = null;

  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private controls!: OrbitControls;
  private animationId = 0;
  private resizeObserver!: ResizeObserver;
  private currentModel: THREE.Group | null = null;
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();

  ngAfterViewInit(): void {
    this.initScene();
    if (this.modelUrl) {
      this.loadModel(this.modelUrl);
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['modelUrl'] && !changes['modelUrl'].firstChange && this.modelUrl) {
      this.loadModel(this.modelUrl);
    }
    if (changes['qualityData'] && !changes['qualityData'].firstChange) {
      this.applyQualityOverlay();
    }
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.animationId);
    this.resizeObserver?.disconnect();
    this.controls?.dispose();
    this.renderer?.dispose();
  }

  private initScene(): void {
    const canvas = this.canvasRef.nativeElement;
    const container = this.containerRef.nativeElement;

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf5f0e8);

    // Camera
    this.camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
    this.camera.position.set(3, 2, 5);

    // Controls
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = true;
    this.controls.minDistance = 0.5;
    this.controls.maxDistance = 50;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight.position.set(5, 10, 7);
    dirLight.castShadow = true;
    this.scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
    fillLight.position.set(-5, 3, -5);
    this.scene.add(fillLight);

    // Grid
    const grid = new THREE.GridHelper(10, 20, 0xd5c8b5, 0xe5ddd0);
    this.scene.add(grid);

    // Click detection for mesh selection
    canvas.addEventListener('click', (event) => this.onCanvasClick(event, canvas));

    // Resize
    this.handleResize(container);
    this.resizeObserver = new ResizeObserver(() => this.handleResize(container));
    this.resizeObserver.observe(container);

    // Animate
    this.animate();
  }

  private handleResize(container: HTMLDivElement): void {
    const w = container.clientWidth;
    const h = container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private animate(): void {
    this.animationId = requestAnimationFrame(() => this.animate());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  loadModel(url: string): void {
    this.loading = true;
    this.loadProgress = 0;
    this.error = null;

    // Remove existing model
    if (this.currentModel) {
      this.scene.remove(this.currentModel);
      this.currentModel = null;
    }

    const loader = new GLTFLoader();
    loader.load(
      url,
      (gltf) => {
        this.currentModel = gltf.scene;
        this.scene.add(this.currentModel);

        // Auto-center and scale
        const box = new THREE.Box3().setFromObject(this.currentModel);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = 3 / maxDim;

        this.currentModel.scale.setScalar(scale);
        this.currentModel.position.sub(center.multiplyScalar(scale));

        // Update camera
        this.camera.position.set(3, 2, 5);
        this.controls.target.set(0, 0, 0);
        this.controls.update();

        this.applyQualityOverlay();
        this.loadProgress = 0;
        this.loading = false;
        this.modelLoaded.emit();
      },
      (xhr) => {
        if (xhr.total > 0) {
          this.loadProgress = Math.round((xhr.loaded / xhr.total) * 100);
        }
      },
      (err) => {
        this.loading = false;
        this.loadProgress = 0;
        this.error = 'Failed to load 3D model';
        console.error('GLTFLoader error:', err);
      }
    );
  }

  private applyQualityOverlay(): void {
    if (!this.currentModel || !this.qualityData.length) return;

    const colorMap: Record<string, THREE.Color> = {
      pass: new THREE.Color(0x27ae60),
      fail: new THREE.Color(0xe74c3c),
      warning: new THREE.Color(0xf39c12),
    };

    this.currentModel.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const qa = this.qualityData.find(q => q.meshName === child.name);
        if (qa && colorMap[qa.status]) {
          child.material = new THREE.MeshStandardMaterial({
            color: colorMap[qa.status],
            transparent: true,
            opacity: 0.85,
            roughness: 0.5,
          });
        }
      }
    });
  }

  private onCanvasClick(event: MouseEvent, canvas: HTMLCanvasElement): void {
    if (!this.currentModel) return;

    const rect = canvas.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const meshes: THREE.Mesh[] = [];
    this.currentModel.traverse((child) => {
      if (child instanceof THREE.Mesh) meshes.push(child);
    });

    const intersects = this.raycaster.intersectObjects(meshes, false);
    if (intersects.length > 0) {
      const hit = intersects[0].object as THREE.Mesh;
      this.meshClicked.emit(hit.name || 'unnamed');
    }
  }

  resetCamera(): void {
    this.camera.position.set(3, 2, 5);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  getMeshNames(): string[] {
    if (!this.currentModel) return [];
    const names: string[] = [];
    this.currentModel.traverse((child) => {
      if (child instanceof THREE.Mesh && child.name) names.push(child.name);
    });
    return names;
  }
}
