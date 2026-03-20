import { Component, OnInit, OnDestroy, ElementRef, ViewChild, AfterViewInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ToastController } from '@ionic/angular';
import { ApiService } from '../../core/services/api.service';
import { ModelCacheService } from '../../core/services/model-cache.service';
import { environment } from '../../../environments/environment';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

interface QualityEntry {
  id: string;
  meshName: string;
  regionLabel: string | null;
  status: 'pass' | 'fail' | 'warning';
  inspector: string | null;
  inspectionDate: string | null;
  notes: string | null;
  defectType: string | null;
  severity: string | null;
  measurementValue: number | null;
  measurementUnit: string | null;
  toleranceMin: number | null;
  toleranceMax: number | null;
}

interface QualitySummary {
  total: number;
  pass: number;
  fail: number;
  warning: number;
}

@Component({
  selector: 'app-quality-view',
  templateUrl: './quality-view.page.html',
  styleUrls: ['./quality-view.page.scss'],
  standalone: false,
})
export class QualityViewPage implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('canvas', { static: false }) canvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('container', { static: false }) containerRef!: ElementRef<HTMLDivElement>;

  modelName = 'Loading...';
  loading = true;
  error: string | null = null;
  entries: QualityEntry[] = [];
  summary: QualitySummary | null = null;
  selectedEntry: QualityEntry | null = null;
  showDetailSheet = false;

  private modelId = '';
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private controls!: OrbitControls;
  private animationId = 0;
  private resizeObserver!: ResizeObserver;
  private currentModel: THREE.Group | null = null;
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();

  constructor(
    private route: ActivatedRoute,
    private api: ApiService,
    private toastCtrl: ToastController,
    private modelCache: ModelCacheService,
  ) {}

  ngOnInit(): void {
    this.modelId = this.route.snapshot.paramMap.get('id') || '';
  }

  ngAfterViewInit(): void {
    this.initScene();
    this.loadModel();
    this.loadQualityData();
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

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a2e);

    this.camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 1000);
    this.camera.position.set(3, 2, 5);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight.position.set(5, 10, 7);
    this.scene.add(dirLight);
    this.scene.add(new THREE.GridHelper(10, 20, 0x333355, 0x222244));

    // Tap to select mesh
    canvas.addEventListener('click', (e) => this.onTap(e, canvas));

    this.handleResize(container);
    this.resizeObserver = new ResizeObserver(() => this.handleResize(container));
    this.resizeObserver.observe(container);

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

  private loadModel(): void {
    this.api.get<any>(`/models/${this.modelId}`).subscribe({
      next: (model) => {
        this.modelName = model.name;
        this.loadGLTF(`${environment.apiUrl}/models/${this.modelId}/file`);
      },
      error: () => {
        this.loading = false;
        this.error = 'Model not found';
      },
    });
  }

  private async loadGLTF(url: string): Promise<void> {
    try {
      const gltf = await this.modelCache.load(url);
      this.currentModel = gltf.scene.clone(true);
      this.scene.add(this.currentModel);

      const box = new THREE.Box3().setFromObject(this.currentModel);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const scale = 3 / maxDim;
      this.currentModel.scale.setScalar(scale);
      this.currentModel.position.sub(center.multiplyScalar(scale));

      this.camera.position.set(3, 2, 5);
      this.controls.target.set(0, 0, 0);
      this.controls.update();

      this.loading = false;
      this.applyQualityOverlay();
    } catch {
      this.loading = false;
      this.error = 'Failed to load 3D file';
    }
  }

  private loadQualityData(): void {
    this.api.get<QualityEntry[]>(`/quality-data/by-model/${this.modelId}`).subscribe({
      next: (entries) => {
        this.entries = entries;
        this.applyQualityOverlay();
      },
    });
    this.api.get<QualitySummary>(`/quality-data/summary/${this.modelId}`).subscribe({
      next: (s) => this.summary = s,
    });
  }

  private applyQualityOverlay(): void {
    if (!this.currentModel || !this.entries.length) return;

    const colorMap: Record<string, THREE.Color> = {
      pass: new THREE.Color(0x27ae60),
      fail: new THREE.Color(0xe74c3c),
      warning: new THREE.Color(0xf39c12),
    };

    this.currentModel.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const qa = this.entries.find(e => e.meshName === child.name);
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

  private onTap(event: MouseEvent, canvas: HTMLCanvasElement): void {
    if (!this.currentModel) return;
    const rect = canvas.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const meshes: THREE.Mesh[] = [];
    this.currentModel.traverse((c) => { if (c instanceof THREE.Mesh) meshes.push(c); });

    const hits = this.raycaster.intersectObjects(meshes, false);
    if (hits.length > 0) {
      const name = (hits[0].object as THREE.Mesh).name;
      const entry = this.entries.find(e => e.meshName === name);
      if (entry) {
        this.selectedEntry = entry;
        this.showDetailSheet = true;
      }
    }
  }

  closeDetail(): void {
    this.showDetailSheet = false;
    this.selectedEntry = null;
  }

  selectEntry(entry: QualityEntry): void {
    this.selectedEntry = entry;
    this.showDetailSheet = true;
  }

  statusColor(status: string): string {
    const m: Record<string, string> = { pass: 'success', fail: 'danger', warning: 'warning' };
    return m[status] || 'medium';
  }

  resetCamera(): void {
    this.camera.position.set(3, 2, 5);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }
}
