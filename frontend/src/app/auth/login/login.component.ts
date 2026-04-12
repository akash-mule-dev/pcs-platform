import { Component, ElementRef, ViewChild, AfterViewInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../core/services/auth.service';
import { ThemeService } from '../../core/services/theme.service';
import { environment } from '../../../environments/environment';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <div class="login-terminal">
      <!-- Left Panel -->
      <div class="terminal-left">
        <div class="terminal-content">
          <div class="terminal-badge">
            <span class="badge-dot"></span>
            SPADEBLOOM PCS &mdash; SECURE GATEWAY
          </div>

          <div class="terminal-header">
            <h1>TERMINAL<br/>INITIALIZATION</h1>
            <p class="terminal-sub">AUTHENTICATE OPERATOR CREDENTIALS TO ACCESS<br/>PRODUCTION CONTROL SYSTEM v4.2.1</p>
          </div>

          @if (error) {
            <div class="error-message">
              <mat-icon>error_outline</mat-icon>
              <span>{{ error }}</span>
            </div>
          }

          <form (ngSubmit)="onLogin()" class="terminal-form">
            <div class="form-group">
              <label class="field-label">OPERATOR ID</label>
              <mat-form-field appearance="outline" class="terminal-field">
                <input matInput type="email" [(ngModel)]="email" name="email" required placeholder="operator&#64;spadebloom.com">
                <mat-icon matPrefix>person_outline</mat-icon>
              </mat-form-field>
            </div>
            <div class="form-group">
              <label class="field-label">ACCESS KEY</label>
              <mat-form-field appearance="outline" class="terminal-field">
                <input matInput [type]="hidePassword ? 'password' : 'text'" [(ngModel)]="password" name="password" required placeholder="Enter secure passphrase">
                <mat-icon matPrefix>lock_outline</mat-icon>
                <button mat-icon-button matSuffix type="button" (click)="hidePassword = !hidePassword" tabindex="-1">
                  <mat-icon>{{ hidePassword ? 'visibility_off' : 'visibility' }}</mat-icon>
                </button>
              </mat-form-field>
            </div>
            <button mat-flat-button type="submit" class="submit-btn" [disabled]="loading">
              @if (loading) {
                <mat-spinner diameter="18"></mat-spinner>
              } @else {
                SUBMIT &amp; ACCESS
                <mat-icon>arrow_forward</mat-icon>
              }
            </button>
          </form>

          <div class="terminal-meta">
            <div class="meta-row">
              <mat-icon>shield</mat-icon>
              <span>AES-256 ENCRYPTED SESSION</span>
            </div>
            <div class="meta-row">
              <mat-icon>dns</mat-icon>
              <span>NODE: PCS-GATEWAY-01</span>
            </div>
          </div>

          <div class="terminal-footer">
            <span class="copyright">&copy; 2026 SPADEBLOOM INDUSTRIES. ALL SYSTEMS MONITORED.</span>
            <button class="theme-toggle" (click)="themeService.toggle()" type="button">
              <mat-icon>{{ themeService.theme() === 'dark' ? 'light_mode' : 'dark_mode' }}</mat-icon>
            </button>
          </div>
        </div>
      </div>

      <!-- Right Panel: 3D Viewer -->
      <div class="terminal-right">
        <div class="scan-header">
          <h2>SCANNED DATA OVERLAY</h2>
          <div class="scan-coords">
            <span>COORDINATES</span>
            <span class="coord-value">X: 001.24 &nbsp; Y: 003.41 &nbsp; Z: 001.08</span>
          </div>
        </div>
        <div class="viewer-wrapper" #viewerContainer>
          <canvas #viewerCanvas></canvas>
          <div class="scan-grid-overlay"></div>
        </div>
        <div class="scan-metrics">
          <div class="metric">
            <span class="metric-value">{{ scanPoints | number }}</span>
            <span class="metric-label">ODP</span>
          </div>
          <div class="metric">
            <span class="metric-value">{{ scanDeviation }}%</span>
            <span class="metric-label">DEVIATION</span>
          </div>
          <div class="metric">
            <span class="metric-value">NOMINAL</span>
            <span class="metric-label">STATUS</span>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    /* ===== Layout ===== */
    .login-terminal {
      display: flex;
      height: 100vh;
      overflow: hidden;
      background: var(--clay-bg);
    }

    /* ===== Left Panel ===== */
    .terminal-left {
      width: 480px;
      min-width: 420px;
      display: flex;
      flex-direction: column;
      background: var(--clay-bg);
      border-right: 1px solid var(--clay-border);
      position: relative;
      z-index: 2;
    }
    .terminal-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: center;
      padding: 48px 40px;
      gap: 28px;
    }
    .terminal-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-family: 'Space Grotesk', monospace;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.1em;
      color: var(--clay-text-muted);
      text-transform: uppercase;
    }
    .badge-dot {
      width: 6px; height: 6px;
      border-radius: 50%;
      background: var(--status-completed);
      box-shadow: 0 0 8px var(--status-completed);
      animation: pulse-dot 2s ease-in-out infinite;
    }
    @keyframes pulse-dot {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }

    .terminal-header h1 {
      font-family: 'Space Grotesk', monospace;
      font-size: 38px;
      font-weight: 700;
      line-height: 1.1;
      letter-spacing: -0.02em;
      color: var(--clay-text);
      margin: 0;
    }
    .terminal-sub {
      font-family: 'Space Grotesk', monospace;
      font-size: 11px;
      font-weight: 500;
      letter-spacing: 0.06em;
      color: var(--clay-text-muted);
      margin: 10px 0 0;
      line-height: 1.6;
    }

    /* ===== Form ===== */
    .terminal-form {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .form-group {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .field-label {
      font-family: 'Space Grotesk', monospace;
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.12em;
      color: var(--clay-text-muted);
      text-transform: uppercase;
      padding-left: 2px;
    }
    .terminal-field {
      width: 100%;
    }
    .terminal-field ::ng-deep .mat-mdc-form-field-subscript-wrapper {
      display: none;
    }

    .submit-btn {
      height: 48px;
      width: 100%;
      font-family: 'Space Grotesk', monospace;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.08em;
      background: linear-gradient(135deg, var(--clay-primary), var(--clay-primary-light)) !important;
      color: var(--clay-bg) !important;
      border: none;
      border-radius: var(--clay-radius-xs) !important;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      cursor: pointer;
      transition: all 0.2s ease;
      margin-top: 4px;
    }
    .submit-btn:hover:not([disabled]) {
      filter: brightness(1.1);
      box-shadow: 0 0 20px rgba(var(--clay-primary), 0.3);
    }
    .submit-btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .submit-btn mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    /* ===== Error ===== */
    .error-message {
      display: flex;
      align-items: center;
      gap: 8px;
      background: var(--error-bg);
      color: var(--error-text);
      padding: 10px 14px;
      border-radius: var(--clay-radius-xs);
      font-family: 'Space Grotesk', monospace;
      font-size: 12px;
      font-weight: 500;
      letter-spacing: 0.02em;
      border: 1px solid var(--error-border);
    }
    .error-message mat-icon {
      font-size: 16px; width: 16px; height: 16px;
      flex-shrink: 0;
    }

    /* ===== Meta & Footer ===== */
    .terminal-meta {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .meta-row {
      display: flex;
      align-items: center;
      gap: 8px;
      font-family: 'Space Grotesk', monospace;
      font-size: 10px;
      font-weight: 500;
      letter-spacing: 0.08em;
      color: var(--clay-text-muted);
    }
    .meta-row mat-icon {
      font-size: 14px; width: 14px; height: 14px;
      opacity: 0.6;
    }

    .terminal-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-top: 12px;
      border-top: 1px solid var(--clay-border);
    }
    .copyright {
      font-family: 'Space Grotesk', monospace;
      font-size: 9px;
      letter-spacing: 0.06em;
      color: var(--clay-text-muted);
      opacity: 0.6;
    }
    .theme-toggle {
      background: var(--clay-surface);
      border: 1px solid var(--clay-border);
      border-radius: var(--clay-radius-xs);
      width: 32px; height: 32px;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer;
      color: var(--clay-text-muted);
      transition: all 0.2s ease;
    }
    .theme-toggle:hover {
      color: var(--clay-text);
      background: var(--clay-surface-hover);
    }
    .theme-toggle mat-icon { font-size: 16px; width: 16px; height: 16px; }

    /* ===== Right Panel ===== */
    .terminal-right {
      flex: 1;
      display: flex;
      flex-direction: column;
      background: var(--clay-bg-warm);
      position: relative;
      overflow: hidden;
    }
    .scan-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 20px 28px;
      z-index: 2;
      position: relative;
    }
    .scan-header h2 {
      font-family: 'Space Grotesk', monospace;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.1em;
      color: var(--clay-text);
      margin: 0;
    }
    .scan-coords {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 2px;
    }
    .scan-coords span:first-child {
      font-family: 'Space Grotesk', monospace;
      font-size: 9px;
      font-weight: 600;
      letter-spacing: 0.12em;
      color: var(--clay-text-muted);
    }
    .coord-value {
      font-family: 'Space Grotesk', monospace;
      font-size: 11px;
      font-weight: 500;
      letter-spacing: 0.06em;
      color: var(--clay-text-secondary);
    }

    /* ===== 3D Viewer ===== */
    .viewer-wrapper {
      flex: 1;
      position: relative;
      overflow: hidden;
    }
    .viewer-wrapper canvas {
      display: block;
      width: 100%;
      height: 100%;
    }
    .scan-grid-overlay {
      position: absolute;
      inset: 0;
      pointer-events: none;
      background:
        linear-gradient(0deg, transparent 95%, var(--clay-border) 95%),
        linear-gradient(90deg, transparent 95%, var(--clay-border) 95%);
      background-size: 60px 60px;
      opacity: 0.15;
    }

    /* ===== Scan Metrics ===== */
    .scan-metrics {
      display: flex;
      gap: 32px;
      padding: 16px 28px;
      z-index: 2;
      position: relative;
      justify-content: flex-end;
    }
    .metric {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 2px;
    }
    .metric-value {
      font-family: 'Space Grotesk', monospace;
      font-size: 18px;
      font-weight: 700;
      letter-spacing: -0.01em;
      color: var(--clay-text);
    }
    .metric-label {
      font-family: 'Space Grotesk', monospace;
      font-size: 9px;
      font-weight: 600;
      letter-spacing: 0.14em;
      color: var(--clay-text-muted);
    }

    /* ===== Responsive ===== */
    @media (max-width: 900px) {
      .login-terminal {
        flex-direction: column;
      }
      .terminal-left {
        width: 100%;
        min-width: unset;
        border-right: none;
        border-bottom: 1px solid var(--clay-border);
      }
      .terminal-right {
        min-height: 300px;
      }
      .terminal-header h1 {
        font-size: 28px;
      }
    }
  `]
})
export class LoginComponent implements AfterViewInit, OnDestroy {
  @ViewChild('viewerCanvas') canvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('viewerContainer') containerRef!: ElementRef<HTMLDivElement>;

  email = '';
  password = '';
  hidePassword = true;
  loading = false;
  error = '';

  scanPoints = 10842;
  scanDeviation = '0.0011';

  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private controls!: OrbitControls;
  private animationId = 0;
  private resizeObserver!: ResizeObserver;
  private themeCleanup: (() => void) | null = null;

  constructor(
    private auth: AuthService,
    private router: Router,
    public themeService: ThemeService,
  ) {}

  ngAfterViewInit(): void {
    this.initScene();
    this.loadModel();
    this.watchTheme();
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.animationId);
    this.resizeObserver?.disconnect();
    this.controls?.dispose();
    this.renderer?.dispose();
    this.themeCleanup?.();
  }

  onLogin(): void {
    if (!this.email || !this.password) return;
    this.loading = true;
    this.error = '';
    this.auth.login(this.email, this.password).subscribe({
      next: () => {
        this.loading = false;
        this.router.navigateByUrl('/').then(success => {
          if (!success) {
            window.location.href = '/';
          }
        });
      },
      error: (err) => {
        this.loading = false;
        this.error = err.error?.message || err.message || 'Login failed. Please check your credentials.';
      }
    });
  }

  private initScene(): void {
    const canvas = this.canvasRef.nativeElement;
    const container = this.containerRef.nativeElement;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.scene = new THREE.Scene();
    this.updateSceneTheme();

    this.camera = new THREE.PerspectiveCamera(40, container.clientWidth / container.clientHeight, 0.1, 1000);
    this.camera.position.set(4, 1.5, 4);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.8;
    this.controls.enablePan = false;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 12;

    // Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    this.scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0xadc6ff, 1.2);
    keyLight.position.set(5, 8, 5);
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x74d1ff, 0.4);
    fillLight.position.set(-5, 3, -3);
    this.scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xffb595, 0.3);
    rimLight.position.set(0, -2, -5);
    this.scene.add(rimLight);

    this.handleResize(container);
    this.resizeObserver = new ResizeObserver(() => this.handleResize(container));
    this.resizeObserver.observe(container);

    this.animate();
  }

  private handleResize(container: HTMLDivElement): void {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;
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
    const modelUrl = `${environment.apiUrl.replace('/api', '')}/test-model.glb`;
    const loader = new GLTFLoader();
    loader.load(
      modelUrl,
      (gltf) => {
        const model = gltf.scene;
        this.scene.add(model);

        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = 3 / maxDim;

        model.scale.setScalar(scale);
        model.position.sub(center.multiplyScalar(scale));

        this.controls.target.set(0, 0, 0);
        this.controls.update();
      },
      undefined,
      () => {
        // Model failed to load — show a fallback wireframe torus knot
        const geometry = new THREE.TorusKnotGeometry(1.2, 0.4, 128, 32);
        const wireframe = new THREE.WireframeGeometry(geometry);
        const line = new THREE.LineSegments(wireframe, new THREE.LineBasicMaterial({
          color: 0x4b8eff,
          transparent: true,
          opacity: 0.6,
        }));
        this.scene.add(line);
      }
    );
  }

  private updateSceneTheme(): void {
    if (!this.scene) return;
    const isDark = this.themeService.theme() === 'dark';
    this.scene.background = new THREE.Color(isDark ? 0x181c22 : 0xe8edf3);
    this.scene.fog = new THREE.Fog(isDark ? 0x181c22 : 0xe8edf3, 8, 20);
  }

  private watchTheme(): void {
    const observer = new MutationObserver(() => this.updateSceneTheme());
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    this.themeCleanup = () => observer.disconnect();
  }
}
