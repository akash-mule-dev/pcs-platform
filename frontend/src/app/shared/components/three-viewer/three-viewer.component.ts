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
    .error-overlay { color: var(--danger, #c0392b); }
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
  @Input() set renderMode(mode: 'solid' | 'xray') {
    if (mode !== this._renderMode) {
      this._renderMode = mode;
      this.applyRenderMode();
    }
  }
  get renderMode(): 'solid' | 'xray' { return this._renderMode; }
  @Output() modelLoaded = new EventEmitter<void>();
  @Output() meshClicked = new EventEmitter<string>(); // emits meshName on click

  /** GLB node names (== IFC GlobalIds) to spotlight; all other meshes dim. Empty = off. */
  @Input() set highlightNames(names: string[]) {
    this._highlight = new Set(names || []);
    this.applyHighlight();
  }

  loading = false;
  loadProgress = 0;
  error: string | null = null;

  private _renderMode: 'solid' | 'xray' = 'solid';
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private controls!: OrbitControls;
  private animationId = 0;
  private resizeObserver!: ResizeObserver;
  private currentModel: THREE.Group | null = null;
  private sky: THREE.Mesh | null = null;
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private edgeLines: THREE.LineSegments[] = [];
  private originalMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  private _highlight = new Set<string>();
  private _highlightActive = false;

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

    // Renderer (preserveDrawingBuffer lets us capture a thumbnail via toBlob)
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;

    // Scene — sky-gradient dome (a real skybox: blue above, soft ground below
    // the horizon) with the horizon color as the clear-color fallback.
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xeaf4fc);
    this.sky = ThreeViewerComponent.createSkyDome();
    this.scene.add(this.sky);

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

    // Grid — cool tones to sit on the sky dome's ground
    const grid = new THREE.GridHelper(10, 20, 0xb9cbdc, 0xd9e5f0);
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

        // Store original materials for mode switching
        this.originalMaterials.clear();
        this.currentModel.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            this.originalMaterials.set(child, child.material);
          }
        });

        this.applyQualityOverlay();
        this.applyRenderMode();
        if (this._highlight.size > 0) this.applyHighlight();
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

  /** Spotlight highlighted meshes (orange) and dim the rest; restore base styling when cleared. */
  private applyHighlight(): void {
    if (!this.currentModel) return;
    if (this._highlight.size === 0) {
      if (this._highlightActive) {
        this.currentModel.traverse((c) => {
          if (c instanceof THREE.Mesh) { const o = this.originalMaterials.get(c); if (o) c.material = o; }
        });
        this._highlightActive = false;
        this.applyQualityOverlay();
        this.applyRenderMode();
      }
      return;
    }
    this._highlightActive = true;
    this.currentModel.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      if (this._highlight.has(child.name)) {
        child.material = new THREE.MeshStandardMaterial({ color: 0xff8c00, emissive: 0x4a2600, roughness: 0.45, metalness: 0.1 });
      } else {
        child.material = new THREE.MeshStandardMaterial({ color: 0xbfb8ab, transparent: true, opacity: 0.15, depthWrite: false });
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

  private applyRenderMode(): void {
    if (!this.currentModel) return;

    // Remove existing edge lines
    this.edgeLines.forEach(line => {
      line.parent?.remove(line);
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    });
    this.edgeLines = [];

    const defaultEdgeColor = 0x4a90d9;
    const defaultFaceColor = 0x3a7bd5;
    const qualityEdgeColors: Record<string, number> = { pass: 0x4caf50, fail: 0xef5350, warning: 0xffca28 };
    const qualityFaceColors: Record<string, number> = { pass: 0x27ae60, fail: 0xe74c3c, warning: 0xf39c12 };

    this.currentModel.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const qa = this.qualityData.find(q => q.meshName === child.name);

      if (this._renderMode === 'xray') {
        const faceColor = qa ? (qualityFaceColors[qa.status] ?? defaultFaceColor) : defaultFaceColor;
        const edgeColor = qa ? (qualityEdgeColors[qa.status] ?? defaultEdgeColor) : defaultEdgeColor;

        child.material = new THREE.MeshStandardMaterial({
          color: faceColor,
          transparent: true,
          opacity: 0.1,
          depthWrite: false,
          side: THREE.DoubleSide,
          roughness: 0.8,
        });
        child.renderOrder = 0;

        const edges = new THREE.EdgesGeometry(child.geometry, 25);
        const lineMat = new THREE.LineBasicMaterial({ color: edgeColor });
        const lineSegments = new THREE.LineSegments(edges, lineMat);
        lineSegments.renderOrder = 1;
        child.add(lineSegments);
        this.edgeLines.push(lineSegments);
      } else {
        // Restore original material or apply quality overlay
        const original = this.originalMaterials.get(child);
        if (qa) {
          child.material = new THREE.MeshStandardMaterial({
            color: qualityFaceColors[qa.status] ?? 0x999999,
            transparent: true,
            opacity: 0.85,
            roughness: 0.5,
          });
        } else if (original) {
          child.material = original;
        }
        child.renderOrder = 0;
      }
    });

    // X-Ray: hide the sky dome and go dark so the edges pop; solid: sky back on.
    if (this.scene) {
      const xray = this._renderMode === 'xray';
      if (this.sky) this.sky.visible = !xray;
      this.scene.background = new THREE.Color(xray ? 0x1a1a2e : 0xeaf4fc);
    }
  }

  /**
   * Gradient sky dome (BackSide sphere + shader): azure overhead blending to a
   * bright horizon, with a soft light ground below — a lightweight skybox that
   * works identically in WebGL here and in expo-gl on mobile.
   */
  private static createSkyDome(): THREE.Mesh {
    const uniforms = {
      topColor: { value: new THREE.Color(0x73b8ec) },
      horizonColor: { value: new THREE.Color(0xeaf4fc) },
      bottomColor: { value: new THREE.Color(0xe6ebf0) },
      offset: { value: 0 },
      exponent: { value: 0.7 },
    };
    const material = new THREE.ShaderMaterial({
      uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        uniform vec3 bottomColor;
        uniform float offset;
        uniform float exponent;
        varying vec3 vWorldPosition;
        void main() {
          float h = normalize(vWorldPosition + vec3(0.0, offset, 0.0)).y;
          vec3 sky = mix(horizonColor, topColor, pow(max(h, 0.0), exponent));
          vec3 ground = mix(horizonColor, bottomColor, pow(max(-h, 0.0), 0.45));
          gl_FragColor = vec4(h >= 0.0 ? sky : ground, 1.0);
        }
      `,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), material);
    sky.renderOrder = -1;
    return sky;
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

  /** Capture a square PNG thumbnail of the current view (client-side, no server GL). */
  async captureThumbnail(maxSize = 256): Promise<Blob | null> {
    if (!this.renderer || !this.currentModel) return null;
    // Draw a fresh frame so the buffer is populated before we read it.
    this.renderer.render(this.scene, this.camera);
    const source = this.renderer.domElement;
    const side = Math.min(source.width, source.height);
    if (!side) return null;
    const out = document.createElement('canvas');
    const s = Math.min(maxSize, side);
    out.width = s;
    out.height = s;
    const ctx = out.getContext('2d');
    if (!ctx) return null;
    const sx = (source.width - side) / 2;
    const sy = (source.height - side) / 2;
    ctx.drawImage(source, sx, sy, side, side, 0, 0, s, s);
    return new Promise((resolve) => out.toBlob((b) => resolve(b), 'image/png'));
  }
}
