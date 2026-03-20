import { Component, OnInit, OnDestroy, ElementRef, ViewChild, AfterViewInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ToastController } from '@ionic/angular';
import { ApiService } from '../../core/services/api.service';
import { ModelCacheService } from '../../core/services/model-cache.service';
import { environment } from '../../../environments/environment';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

@Component({
  selector: 'app-model-view',
  templateUrl: './model-view.page.html',
  styleUrls: ['./model-view.page.scss'],
  standalone: false,
})
export class ModelViewPage implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('canvas', { static: false }) canvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('container', { static: false }) containerRef!: ElementRef<HTMLDivElement>;

  modelName = 'Loading...';
  loading = true;
  error: string | null = null;
  loadProgress = 0;          // 0-100, or -1 for indeterminate
  loadedBytes = '';           // e.g. "2.4 MB"

  private modelId = '';
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private controls!: OrbitControls;
  private animationId = 0;
  private resizeObserver!: ResizeObserver;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
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

    // Lights
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight.position.set(5, 10, 7);
    this.scene.add(dirLight);
    this.scene.add(new THREE.DirectionalLight(0xffffff, 0.3).translateX(-5));

    // Grid
    this.scene.add(new THREE.GridHelper(10, 20, 0x333355, 0x222244));

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
    // Fetch model metadata
    this.api.get<any>(`/models/${this.modelId}`).subscribe({
      next: (model) => {
        this.modelName = model.name;
        this.loadGLTF(`${environment.apiUrl}/models/${this.modelId}/file`);
      },
      error: async () => {
        this.loading = false;
        this.error = 'Model not found';
        const toast = await this.toastCtrl.create({
          message: 'Failed to load model', duration: 3000, color: 'danger', position: 'top',
        });
        await toast.present();
      },
    });
  }

  private async loadGLTF(url: string): Promise<void> {
    try {
      const gltf = await this.modelCache.load(url, (progress) => {
        this.loadProgress = progress.percent;
        if (progress.total > 0) {
          this.loadedBytes = this.formatBytes(progress.loaded) + ' / ' + this.formatBytes(progress.total);
        } else if (progress.loaded > 0) {
          this.loadedBytes = this.formatBytes(progress.loaded);
        }
      });

      // Clone the scene so cached originals aren't mutated
      const model = gltf.scene.clone(true);
      this.scene.add(model);

      // Auto-center and scale
      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const scale = 3 / maxDim;
      model.scale.setScalar(scale);
      model.position.sub(center.multiplyScalar(scale));

      this.camera.position.set(3, 2, 5);
      this.controls.target.set(0, 0, 0);
      this.controls.update();

      this.loading = false;
    } catch {
      this.loading = false;
      this.error = 'Failed to load 3D file';
    }
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  resetCamera(): void {
    this.camera.position.set(3, 2, 5);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  openAR(): void {
    this.router.navigate(['/tabs/models', this.modelId, 'ar']);
  }
}
