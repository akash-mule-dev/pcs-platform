import { Component, OnInit, OnDestroy, ElementRef, ViewChild, AfterViewInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ToastController } from '@ionic/angular';
import { ApiService } from '../../core/services/api.service';
import { environment } from '../../../environments/environment';
import * as THREE from 'three';
import { ModelCacheService } from '../../core/services/model-cache.service';

@Component({
  selector: 'app-ar-view',
  templateUrl: './ar-view.page.html',
  styleUrls: ['./ar-view.page.scss'],
  standalone: false,
})
export class ArViewPage implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('arCanvas', { static: false }) canvasRef!: ElementRef<HTMLCanvasElement>;

  modelName = 'AR View';
  arSupported = false;
  arActive = false;
  loading = true;
  error: string | null = null;

  private modelId = '';
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private animationId = 0;
  private xrSession: XRSession | null = null;
  private loadedModel: THREE.Group | null = null;
  private hitTestSource: XRHitTestSource | null = null;
  private reticle!: THREE.Mesh;
  private modelPlaced = false;
  private placedModel: THREE.Group | null = null;

  // Gesture state for scale/rotate
  private touchStartDistance = 0;
  private touchStartAngle = 0;
  private initialScale = 1;
  private initialRotation = 0;

  constructor(
    private route: ActivatedRoute,
    private api: ApiService,
    private toastCtrl: ToastController,
    private modelCache: ModelCacheService,
  ) {}

  ngOnInit(): void {
    this.modelId = this.route.snapshot.paramMap.get('id') || '';
    this.checkARSupport();
  }

  ngAfterViewInit(): void {
    this.initScene();
    this.loadModelFile();
  }

  ngOnDestroy(): void {
    this.endAR();
    cancelAnimationFrame(this.animationId);
    this.renderer?.dispose();
  }

  private async checkARSupport(): Promise<void> {
    if ('xr' in navigator) {
      try {
        this.arSupported = await (navigator as any).xr.isSessionSupported('immersive-ar');
      } catch {
        this.arSupported = false;
      }
    }
  }

  private initScene(): void {
    const canvas = this.canvasRef.nativeElement;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.xr.enabled = true;

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 100);

    // Lights for AR
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight.position.set(2, 5, 2);
    dirLight.castShadow = true;
    this.scene.add(dirLight);

    // Reticle (placement indicator)
    const reticleGeometry = new THREE.RingGeometry(0.05, 0.07, 32).rotateX(-Math.PI / 2);
    const reticleMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff88 });
    this.reticle = new THREE.Mesh(reticleGeometry, reticleMaterial);
    this.reticle.visible = false;
    this.scene.add(this.reticle);

    // Pinch-to-scale and two-finger-rotate gestures
    canvas.addEventListener('touchstart', (e) => this.onTouchStart(e), { passive: false });
    canvas.addEventListener('touchmove', (e) => this.onTouchMove(e), { passive: false });
  }

  private onTouchStart(e: TouchEvent): void {
    if (e.touches.length === 2 && this.placedModel) {
      e.preventDefault();
      const dx = e.touches[1].clientX - e.touches[0].clientX;
      const dy = e.touches[1].clientY - e.touches[0].clientY;
      this.touchStartDistance = Math.hypot(dx, dy);
      this.touchStartAngle = Math.atan2(dy, dx);
      this.initialScale = this.placedModel.scale.x;
      this.initialRotation = this.placedModel.rotation.y;
    }
  }

  private onTouchMove(e: TouchEvent): void {
    if (e.touches.length === 2 && this.placedModel && this.touchStartDistance > 0) {
      e.preventDefault();
      const dx = e.touches[1].clientX - e.touches[0].clientX;
      const dy = e.touches[1].clientY - e.touches[0].clientY;
      const distance = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx);

      // Scale: pinch gesture
      const scaleFactor = distance / this.touchStartDistance;
      const newScale = Math.max(0.05, Math.min(5, this.initialScale * scaleFactor));
      this.placedModel.scale.setScalar(newScale);

      // Rotate: two-finger twist
      const angleDelta = angle - this.touchStartAngle;
      this.placedModel.rotation.y = this.initialRotation + angleDelta;
    }
  }

  private loadModelFile(): void {
    this.api.get<any>(`/models/${this.modelId}`).subscribe({
      next: async (model) => {
        this.modelName = model.name;
        const url = `${environment.apiUrl}/models/${this.modelId}/file`;
        try {
          const gltf = await this.modelCache.load(url);
          this.loadedModel = gltf.scene.clone(true);
          const box = new THREE.Box3().setFromObject(this.loadedModel);
          const size = box.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z);
          this.loadedModel.scale.setScalar(0.3 / maxDim); // 30cm in AR
          this.loading = false;
        } catch {
          this.loading = false;
          this.error = 'Failed to load 3D model';
        }
      },
      error: () => {
        this.loading = false;
        this.error = 'Model not found';
      },
    });
  }

  async startAR(): Promise<void> {
    if (!this.arSupported) {
      const toast = await this.toastCtrl.create({
        message: 'AR is not supported on this device/browser. Try using Chrome on an ARCore-compatible Android device.',
        duration: 4000, color: 'warning', position: 'top',
      });
      await toast.present();
      return;
    }

    try {
      const session = await (navigator as any).xr.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test'],
        optionalFeatures: ['dom-overlay'],
      });

      this.xrSession = session;
      this.arActive = true;
      this.renderer.xr.setReferenceSpaceType('local');
      await this.renderer.xr.setSession(session);

      // Set up hit test
      const viewerSpace = await session.requestReferenceSpace('viewer');
      this.hitTestSource = await session.requestHitTestSource({ space: viewerSpace });

      session.addEventListener('end', () => {
        this.arActive = false;
        this.xrSession = null;
        this.hitTestSource = null;
      });

      // Handle tap to place
      session.addEventListener('select', () => this.placeModel());

      this.renderer.setAnimationLoop((timestamp: number, frame: XRFrame) => {
        if (frame && this.hitTestSource && !this.modelPlaced) {
          const results = frame.getHitTestResults(this.hitTestSource);
          if (results.length > 0) {
            const hit = results[0];
            const refSpace = this.renderer.xr.getReferenceSpace();
            if (refSpace) {
              const pose = hit.getPose(refSpace);
              if (pose) {
                this.reticle.visible = true;
                this.reticle.matrix.fromArray(pose.transform.matrix);
                this.reticle.matrixAutoUpdate = false;
              }
            }
          }
        }
        this.renderer.render(this.scene, this.camera);
      });
    } catch (err) {
      const toast = await this.toastCtrl.create({
        message: 'Failed to start AR session', duration: 3000, color: 'danger', position: 'top',
      });
      await toast.present();
    }
  }

  private placeModel(): void {
    if (!this.loadedModel || this.modelPlaced) return;

    const clone = this.loadedModel.clone();
    clone.position.setFromMatrixPosition(this.reticle.matrix);
    this.scene.add(clone);
    this.placedModel = clone;

    this.reticle.visible = false;
    this.modelPlaced = true;
  }

  async endAR(): Promise<void> {
    if (this.xrSession) {
      await this.xrSession.end();
      this.xrSession = null;
    }
    this.arActive = false;
    this.modelPlaced = false;
    this.renderer.setAnimationLoop(null);
  }

  resetPlacement(): void {
    if (this.placedModel) {
      this.scene.remove(this.placedModel);
      this.placedModel = null;
    }
    this.modelPlaced = false;
    this.reticle.visible = true;
  }
}
