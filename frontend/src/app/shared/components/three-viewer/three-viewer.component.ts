import {
  Component, ElementRef, ViewChild, Input, OnDestroy, AfterViewInit,
  Output, EventEmitter, OnChanges, SimpleChanges
} from '@angular/core';
import { CommonModule } from '@angular/common';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

/** A part's true length in mm, keyed by GLB mesh name (== ifc_guid). Used to
 *  self-calibrate the model's unit scale so on-model measurements read in real mm. */
export interface ViewerReferenceLength { meshName: string; lengthMm: number; }

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
      <!-- CSS2D label layer (measurement dims) — overlays the canvas, click-through -->
      <div #labelLayer class="label-layer"></div>

      @if (showTools && !loading && !error) {
        <div class="tools">
          <button type="button" class="tool" [class.on]="measureMode" (click)="toggleMeasure()"
            title="Measure distance between two points">
            <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M3 17.25 17.25 3 21 6.75 6.75 21 3 17.25Zm3.4-3.4 1.1-1.1-2-2 1-1 2 2 1.1-1.1-2-2 1-1 2 2 1.1-1.1-2-2 1-1 2 2 1.4-1.4-3.75-3.75L4.6 16.1l1.8 1.75Z"/></svg>
            <span>Measure</span>
          </button>
          <button type="button" class="tool" [class.on]="showDimensions" (click)="toggleDimensions()"
            title="Show bounding-box dimensions of the selected part">
            <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M4 20V8h2v4h2V8h2v4h2V8h2v4h2V8h2v12H4Zm0-14V4h16v2H4Z"/></svg>
            <span>Dimensions</span>
          </button>
          @if (hasMeasurements()) {
            <button type="button" class="tool" (click)="clearMeasurements()" title="Clear all measurements">
              <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12ZM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4Z"/></svg>
              <span>Clear</span>
            </button>
          }
          <button type="button" class="tool" (click)="resetCamera()" title="Reset the camera view">
            <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8Z"/></svg>
            <span>Reset</span>
          </button>
        </div>
        @if (measureMode || measureHint) {
          <div class="measure-readout">{{ measureHint || 'Click two points to measure' }}</div>
        }
        @if (!calibrated && (measureMode || showDimensions)) {
          <div class="measure-warn" title="No reference length was found to calibrate the model's unit scale. Distances assume metres and may be approximate.">~ approx — uncalibrated</div>
        }
      }
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

    /* CSS2D measurement labels overlay — never intercepts pointer events.
       Labels are created by CSS2DRenderer outside the template, so ::ng-deep is
       required to pierce view encapsulation (scoped under :host). */
    .label-layer { position: absolute; inset: 0; overflow: hidden; pointer-events: none; z-index: 4; }
    :host ::ng-deep .dim-label {
      background: rgba(28,32,46,0.92); color: #fff; font-size: 12px; font-weight: 600;
      padding: 2px 7px; border-radius: 6px; white-space: nowrap; letter-spacing: .01em;
      font-family: 'Space Grotesk', 'Inter', system-ui, sans-serif;
      box-shadow: 0 2px 6px rgba(0,0,0,0.25);
    }
    :host ::ng-deep .dim-label.axis-x { background: rgba(198,40,40,0.94); }
    :host ::ng-deep .dim-label.axis-y { background: rgba(46,125,50,0.94); }
    :host ::ng-deep .dim-label.axis-z { background: rgba(21,101,192,0.94); }

    /* Floating tool buttons (top-right) — opt-in via [showTools]. */
    .tools {
      position: absolute; top: 10px; right: 10px; z-index: 6;
      display: flex; flex-direction: column; gap: 6px; align-items: stretch;
    }
    .tool {
      display: inline-flex; align-items: center; gap: 6px; cursor: pointer;
      background: rgba(255,255,255,0.92); color: var(--clay-text, #3d3229);
      border: 1px solid var(--clay-border, #e0d8cc); border-radius: 8px;
      padding: 6px 10px; font-size: 12px; font-weight: 600; font-family: inherit;
      box-shadow: 0 2px 6px rgba(0,0,0,0.1); transition: background .12s, color .12s, border-color .12s;
    }
    .tool svg { flex-shrink: 0; }
    .tool:hover { border-color: var(--clay-primary, #6b5ce7); color: var(--clay-primary, #6b5ce7); }
    .tool.on { background: var(--clay-primary, #6b5ce7); color: #fff; border-color: var(--clay-primary, #6b5ce7); }
    .measure-readout {
      position: absolute; bottom: 10px; left: 50%; transform: translateX(-50%); z-index: 6;
      background: rgba(28,32,46,0.92); color: #fff; font-size: 12px; font-weight: 600;
      padding: 5px 12px; border-radius: 999px; box-shadow: 0 2px 8px rgba(0,0,0,0.2); pointer-events: none;
    }
    .measure-warn {
      position: absolute; bottom: 10px; right: 10px; z-index: 6;
      background: rgba(245,166,35,0.95); color: #3d2c00; font-size: 11px; font-weight: 700;
      padding: 4px 9px; border-radius: 6px; pointer-events: none;
    }
  `]
})
export class ThreeViewerComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('canvas') canvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('container') containerRef!: ElementRef<HTMLDivElement>;
  @ViewChild('labelLayer') labelLayerRef!: ElementRef<HTMLDivElement>;

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
    if (this.autoFocus && this.controls) this.focusOnHighlight();
    if (this.showDimensions) this.rebuildDimensions();
  }

  /** Fly the camera to frame the highlighted meshes (zoom-to-selection), so tiny
   *  parts are findable. Opt-in — other viewer usages keep a fixed camera. */
  @Input() autoFocus = false;

  /** Show the floating measurement/dimension toolbar (Measure / Dimensions / Clear / Reset).
   *  Opt-in so existing read-only viewer embeds are unchanged. */
  @Input() showTools = false;

  /** Known true lengths (mm) for some meshes, used to auto-calibrate the model's
   *  unit scale so measurements read in real mm. The GLB carries the IFC's native
   *  units (m/mm/in vary per file), so we derive mm-per-unit from these. */
  @Input() set referenceLengths(refs: ViewerReferenceLength[]) {
    this._refLengths = refs || [];
    if (this.currentModel) this.calibrate();
  }

  loading = false;
  loadProgress = 0;
  error: string | null = null;

  // ── Measurement state (template-bound) ──
  measureMode = false;
  showDimensions = false;
  measureHint = '';
  calibrated = false;

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
  private camAnim: {
    fromPos: THREE.Vector3; toPos: THREE.Vector3;
    fromTgt: THREE.Vector3; toTgt: THREE.Vector3;
    start: number; duration: number;
  } | null = null;

  // ── Measurement / dimension internals ──
  private labelRenderer!: CSS2DRenderer;
  /** Millimetres per *world* unit, from calibration. We calibrate directly in the
   *  scaled world space that raycasts/bounding-boxes report in, so the model's
   *  fit-scale and any baked GLB node scale are absorbed automatically (NaN until
   *  calibrated → measurements show "—"). */
  private mmPerWorldUnit = NaN;
  private _refLengths: ViewerReferenceLength[] = [];
  /** World-space group holding measurement markers/lines/labels (no model transform). */
  private measureGroup = new THREE.Group();
  /** World-space group holding the bounding-box dimension visuals. */
  private dimGroup = new THREE.Group();
  /** Points picked so far for the in-progress point-to-point measurement. */
  private measurePts: THREE.Vector3[] = [];
  /** Marker for a half-finished (1-point) measurement, so it can be undone on exit. */
  private pendingMarker: THREE.Object3D | null = null;

  ngAfterViewInit(): void {
    this.initScene();
    // Defer the first load to a fresh task: mutating view-bound state (loading)
    // synchronously inside ngAfterViewInit would trip NG0100 in dev.
    if (this.modelUrl) {
      const url = this.modelUrl;
      queueMicrotask(() => { if (this.renderer) this.loadModel(url); });
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
    this.clearMeasurements();
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

    // CSS2D label renderer for crisp measurement labels (overlays the canvas).
    this.labelRenderer = new CSS2DRenderer({ element: this.labelLayerRef.nativeElement });
    this.labelRenderer.setSize(container.clientWidth, container.clientHeight);

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
    this.controls.minDistance = 0.1;
    this.controls.maxDistance = 50;
    // A user grab takes over from any in-flight fly-to animation.
    this.controls.addEventListener('start', () => { this.camAnim = null; });

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

    // Measurement overlays live in world space (no model transform), so the
    // raycast world-points they're built from line up exactly.
    this.scene.add(this.measureGroup);
    this.scene.add(this.dimGroup);

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
    this.labelRenderer?.setSize(w, h);
  }

  private animate(): void {
    this.animationId = requestAnimationFrame(() => this.animate());
    if (this.camAnim) {
      const a = this.camAnim;
      const t = Math.min(1, (performance.now() - a.start) / a.duration);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; // ease-in-out cubic
      this.camera.position.lerpVectors(a.fromPos, a.toPos, e);
      this.controls.target.lerpVectors(a.fromTgt, a.toTgt, e);
      if (t >= 1) this.camAnim = null;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer?.render(this.scene, this.camera);
  }

  /** Zoom-to-selection: frame the highlighted meshes' bounding sphere, keeping
   *  the current view direction so the user doesn't lose orientation. */
  private focusOnHighlight(): void {
    if (!this.currentModel || this._highlight.size === 0) return;
    this.currentModel.updateWorldMatrix(true, true);
    const box = new THREE.Box3();
    let found = false;
    this.currentModel.traverse((c) => {
      if (c instanceof THREE.Mesh && this._highlight.has(c.name)) { box.expandByObject(c); found = true; }
    });
    if (!found || box.isEmpty()) return;

    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(sphere.radius, 0.01);
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const fitDist = (radius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.15;
    const distance = THREE.MathUtils.clamp(fitDist, this.controls.minDistance + 0.05, this.controls.maxDistance);

    const dir = this.camera.position.clone().sub(this.controls.target);
    if (dir.lengthSq() < 1e-6) dir.set(3, 2, 5);
    dir.normalize();

    this.camAnim = {
      fromPos: this.camera.position.clone(),
      toPos: sphere.center.clone().add(dir.multiplyScalar(distance)),
      fromTgt: this.controls.target.clone(),
      toTgt: sphere.center.clone(),
      start: performance.now(),
      duration: 600,
    };
  }

  loadModel(url: string): void {
    this.loading = true;
    this.loadProgress = 0;
    this.error = null;

    // Remove existing model + any measurements from the previous model
    this.camAnim = null;
    this.clearMeasurements();
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
        this.calibrate();
        if (this._highlight.size > 0) {
          this.applyHighlight();
          if (this.autoFocus) this.focusOnHighlight();
        }
        if (this.showDimensions) this.rebuildDimensions();
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

    // Measure mode: clicks pick world points to measure between (not select).
    if (this.measureMode) {
      if (intersects.length > 0) this.addMeasurePoint(intersects[0].point.clone());
      else this.measureHint = 'Click on the model surface to place a point';
      return;
    }

    if (intersects.length > 0) {
      const hit = intersects[0].object as THREE.Mesh;
      this.meshClicked.emit(hit.name || 'unnamed');
    }
  }

  // ── Unit calibration ──────────────────────────────────────────────────────
  /**
   * Derive mm-per-WORLD-unit from known part lengths. The GLB is auto-scaled to
   * fit the view and may carry a baked node scale, so a world unit has no fixed
   * real size — we recover it by comparing a part's true length_mm against the
   * world length of its longest geometry edge (geometry edge × the mesh's world
   * scale). Only clearly linear members (length ≫ section) are trusted, since a
   * plate's longest edge isn't its "length"; the median is the calibration.
   */
  private calibrate(): void {
    this.calibrated = false;
    if (!this.currentModel || !this._refLengths.length) return;

    const byName = new Map<string, number>();
    for (const r of this._refLengths) {
      if (r?.meshName && r.lengthMm > 0) byName.set(r.meshName, r.lengthMm);
    }
    if (!byName.size) return;

    this.currentModel.updateWorldMatrix(true, true);
    const ratios: number[] = [];
    const size = new THREE.Vector3();
    const wscale = new THREE.Vector3();
    this.currentModel.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const lengthMm = byName.get(child.name);
      if (lengthMm == null) return;
      const geom = child.geometry;
      if (!geom.boundingBox) geom.computeBoundingBox();
      geom.boundingBox!.getSize(size);
      const edges = [size.x, size.y, size.z].sort((a, b) => b - a); // desc
      const longest = edges[0];
      if (longest <= 1e-9) return;
      // Only trust clearly linear members (length ≫ section) for calibration.
      if (longest < edges[1] * 3) return;
      // Geometry-local edge → world length via the mesh's (uniform) world scale.
      child.getWorldScale(wscale);
      const s = Math.cbrt(Math.abs(wscale.x * wscale.y * wscale.z)) || 1;
      const worldLongest = longest * s;
      if (worldLongest <= 1e-9) return;
      ratios.push(lengthMm / worldLongest); // mm per world unit
    });

    if (!ratios.length) return;
    ratios.sort((a, b) => a - b);
    this.mmPerWorldUnit = ratios[Math.floor(ratios.length / 2)];
    this.calibrated = true;
  }

  /** World-space distance → real millimetres (NaN until calibrated). */
  private worldToMm(worldDist: number): number {
    return worldDist * this.mmPerWorldUnit;
  }

  /** Human-readable length: mm under 1 m, else m with 2 decimals. */
  private fmtLen(mm: number): string {
    if (!isFinite(mm)) return '—';
    if (mm >= 1000) return `${(mm / 1000).toFixed(mm >= 10000 ? 1 : 2)} m`;
    return `${Math.round(mm)} mm`;
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

  // ── Measurement tools (toolbar) ────────────────────────────────────────────
  hasMeasurements(): boolean { return this.measureGroup.children.length > 0; }

  toggleMeasure(): void {
    this.measureMode = !this.measureMode;
    if (this.measureMode) {
      this.measureHint = 'Click two points on the model to measure';
    } else {
      // Abandon any half-finished measurement (single placed point).
      if (this.pendingMarker) { this.measureGroup.remove(this.pendingMarker); this.pendingMarker = null; }
      this.measurePts = [];
      this.measureHint = '';
    }
  }

  toggleDimensions(): void {
    this.showDimensions = !this.showDimensions;
    if (this.showDimensions) this.rebuildDimensions();
    else this.clearDimensions();
  }

  /** Clear all point-to-point measurements (toolbar Clear / model reload / destroy). */
  clearMeasurements(): void {
    this.disposeGroup(this.measureGroup);
    this.measurePts = [];
    this.pendingMarker = null;
    if (this.measureMode) this.measureHint = 'Click two points on the model to measure';
  }

  private addMeasurePoint(p: THREE.Vector3): void {
    const marker = this.makeMarker(p);
    this.measureGroup.add(marker);
    this.measurePts.push(p);

    if (this.measurePts.length === 1) {
      this.pendingMarker = marker;
      this.measureHint = 'Click the second point';
      return;
    }

    // Second point — commit the segment: connecting line + distance label.
    const [a, b] = this.measurePts;
    const lineGeom = new THREE.BufferGeometry().setFromPoints([a, b]);
    const line = new THREE.Line(lineGeom, new THREE.LineBasicMaterial({ color: 0xff6a00, depthTest: false }));
    line.renderOrder = 999;
    this.measureGroup.add(line);

    const mm = this.worldToMm(a.distanceTo(b));
    const label = this.makeLabel(this.fmtLen(mm), a.clone().lerp(b, 0.5));
    this.measureGroup.add(label);

    this.measurePts = [];
    this.pendingMarker = null;
    this.measureHint = `Distance: ${this.fmtLen(mm)} — click to measure again`;
  }

  // ── Bounding-box dimensions of the current selection ───────────────────────
  /** Draw an L×W×H dimension box around the highlighted meshes (or the whole
   *  model when nothing is highlighted), labelled in real mm. */
  private rebuildDimensions(): void {
    this.clearDimensions();
    if (!this.currentModel) return;

    const box = new THREE.Box3();
    let found = false;
    if (this._highlight.size > 0) {
      this.currentModel.traverse((c) => {
        if (c instanceof THREE.Mesh && this._highlight.has(c.name)) { box.expandByObject(c); found = true; }
      });
    } else {
      box.setFromObject(this.currentModel);
      found = !box.isEmpty();
    }
    if (!found || box.isEmpty()) return;

    const helper = new THREE.Box3Helper(box, new THREE.Color(0x2c3142));
    (helper.material as THREE.LineBasicMaterial).depthTest = false;
    helper.renderOrder = 998;
    this.dimGroup.add(helper);

    const size = box.getSize(new THREE.Vector3());
    const min = box.min, max = box.max;
    const cx = (min.x + max.x) / 2, cy = (min.y + max.y) / 2, cz = (min.z + max.z) / 2;
    const tiny = 1e-4;
    // One label per axis, placed at the midpoint of a representative box edge.
    if (size.x > tiny) this.dimGroup.add(this.makeLabel(this.fmtLen(this.worldToMm(size.x)), new THREE.Vector3(cx, min.y, min.z), 'axis-x'));
    if (size.y > tiny) this.dimGroup.add(this.makeLabel(this.fmtLen(this.worldToMm(size.y)), new THREE.Vector3(min.x, cy, min.z), 'axis-y'));
    if (size.z > tiny) this.dimGroup.add(this.makeLabel(this.fmtLen(this.worldToMm(size.z)), new THREE.Vector3(min.x, min.y, cz), 'axis-z'));
  }

  // ── Shared helpers ─────────────────────────────────────────────────────────
  private makeMarker(p: THREE.Vector3): THREE.Mesh {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.02, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xff6a00, depthTest: false }),
    );
    m.position.copy(p);
    m.renderOrder = 1000;
    return m;
  }

  private makeLabel(text: string, pos: THREE.Vector3, cls = ''): CSS2DObject {
    const div = document.createElement('div');
    div.className = cls ? `dim-label ${cls}` : 'dim-label';
    div.textContent = text;
    const obj = new CSS2DObject(div);
    obj.position.copy(pos);
    return obj;
  }

  private clearDimensions(): void { this.disposeGroup(this.dimGroup); }

  /** Remove + dispose every child of a measurement overlay group (frees GPU
   *  buffers; CSS2DObject removal also detaches its DOM label). */
  private disposeGroup(group: THREE.Group): void {
    for (const child of group.children) {
      const o = child as THREE.Object3D & { geometry?: THREE.BufferGeometry; material?: THREE.Material | THREE.Material[] };
      o.geometry?.dispose?.();
      const mat = o.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose?.();
    }
    group.clear();
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
