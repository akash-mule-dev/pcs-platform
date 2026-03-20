import { Component, OnInit, OnDestroy, NgZone } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ToastController, AlertController, Platform } from '@ionic/angular';
import { ApiService } from '../../core/services/api.service';
import { environment } from '../../../environments/environment';
import { Capacitor } from '@capacitor/core';

/**
 * Native AR View with Image Tracking.
 *
 * Uses platform-specific AR capabilities:
 * - Android: ARCore via custom Capacitor plugin
 * - iOS: ARKit via custom Capacitor plugin
 *
 * Supports image tracking: recognizes a reference image (e.g., a product label
 * or QR code) and overlays the 3D model on the tracked image in real-time.
 */

interface ImageTrackingTarget {
  name: string;
  imageUrl: string;
  physicalWidthMm: number;
}

@Component({
  selector: 'app-native-ar',
  templateUrl: './native-ar.page.html',
  styleUrls: ['./native-ar.page.scss'],
  standalone: false,
})
export class NativeArPage implements OnInit, OnDestroy {
  modelName = 'Native AR';
  modelId = '';
  arSupported = false;
  arActive = false;
  loading = true;
  error: string | null = null;
  imageTrackingEnabled = false;
  trackingStatus: 'none' | 'detecting' | 'tracking' | 'lost' = 'none';
  modelPlaced = false;

  // Image tracking targets
  trackingTargets: ImageTrackingTarget[] = [];
  selectedTarget: ImageTrackingTarget | null = null;

  // Scale/rotation state
  modelScale = 1.0;
  modelRotationY = 0;

  private arPlugin: any = null;
  private modelFileUrl = '';

  constructor(
    private route: ActivatedRoute,
    private api: ApiService,
    private toastCtrl: ToastController,
    private alertCtrl: AlertController,
    private platform: Platform,
    private zone: NgZone,
  ) {}

  ngOnInit(): void {
    this.modelId = this.route.snapshot.paramMap.get('id') || '';
    this.checkNativeArSupport();
    this.loadModelInfo();
  }

  ngOnDestroy(): void {
    this.stopAr();
  }

  private async checkNativeArSupport(): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      this.arSupported = false;
      this.loading = false;
      return;
    }

    try {
      // Dynamically import the AR plugin based on platform
      if (Capacitor.getPlatform() === 'android') {
        const { PcsArCore } = await import('../../plugins/ar-core.plugin');
        this.arPlugin = PcsArCore;
      } else if (Capacitor.getPlatform() === 'ios') {
        const { PcsArKit } = await import('../../plugins/ar-kit.plugin');
        this.arPlugin = PcsArKit;
      }

      if (this.arPlugin) {
        const { supported } = await this.arPlugin.checkSupport();
        this.arSupported = supported;
      }
    } catch {
      this.arSupported = false;
    }
  }

  private loadModelInfo(): void {
    this.api.get<any>(`/models/${this.modelId}`).subscribe({
      next: (model) => {
        this.modelName = model.name;
        this.modelFileUrl = `${environment.apiUrl}/models/${this.modelId}/file`;
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.error = 'Model not found';
      },
    });
  }

  async startAr(): Promise<void> {
    if (!this.arPlugin) {
      await this.showToast('Native AR not available on this device', 'warning');
      return;
    }

    try {
      this.arActive = true;
      this.trackingStatus = 'none';

      // Initialize AR session
      await this.arPlugin.startSession({
        modelUrl: this.modelFileUrl,
        enableImageTracking: this.imageTrackingEnabled,
        trackingImages: this.trackingTargets.map(t => ({
          name: t.name,
          imageUrl: t.imageUrl,
          physicalWidth: t.physicalWidthMm / 1000, // Convert mm to meters
        })),
        enablePlaneDetection: true,
        enableLightEstimation: true,
      });

      // Listen for AR events
      this.arPlugin.addListener('onImageDetected', (event: any) => {
        this.zone.run(() => {
          this.trackingStatus = 'tracking';
          this.modelPlaced = true;
        });
      });

      this.arPlugin.addListener('onImageLost', () => {
        this.zone.run(() => {
          this.trackingStatus = 'lost';
        });
      });

      this.arPlugin.addListener('onModelPlaced', () => {
        this.zone.run(() => {
          this.modelPlaced = true;
        });
      });

      this.arPlugin.addListener('onError', (event: any) => {
        this.zone.run(() => {
          this.error = event.message || 'AR error occurred';
        });
      });

    } catch (err: any) {
      this.arActive = false;
      await this.showToast(`Failed to start AR: ${err.message || err}`, 'danger');
    }
  }

  async stopAr(): Promise<void> {
    if (this.arPlugin && this.arActive) {
      try {
        await this.arPlugin.stopSession();
        this.arPlugin.removeAllListeners();
      } catch {
        // Ignore cleanup errors
      }
    }
    this.arActive = false;
    this.modelPlaced = false;
    this.trackingStatus = 'none';
  }

  async resetPlacement(): Promise<void> {
    if (this.arPlugin) {
      await this.arPlugin.resetPlacement();
      this.modelPlaced = false;
      this.trackingStatus = this.imageTrackingEnabled ? 'detecting' : 'none';
    }
  }

  async adjustScale(delta: number): Promise<void> {
    this.modelScale = Math.max(0.1, Math.min(5.0, this.modelScale + delta));
    if (this.arPlugin && this.modelPlaced) {
      await this.arPlugin.setModelScale({ scale: this.modelScale });
    }
  }

  async rotateModel(degrees: number): Promise<void> {
    this.modelRotationY = (this.modelRotationY + degrees) % 360;
    if (this.arPlugin && this.modelPlaced) {
      await this.arPlugin.setModelRotation({ y: this.modelRotationY });
    }
  }

  toggleImageTracking(): void {
    this.imageTrackingEnabled = !this.imageTrackingEnabled;
  }

  async addTrackingTarget(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Add Tracking Image',
      message: 'Enter details for the reference image to track',
      inputs: [
        { name: 'name', type: 'text', placeholder: 'Target name (e.g., "Product Label")' },
        { name: 'imageUrl', type: 'url', placeholder: 'Image URL or path' },
        { name: 'widthMm', type: 'number', placeholder: 'Physical width in mm (e.g., 100)' },
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Add',
          handler: (data) => {
            if (data.name && data.imageUrl && data.widthMm) {
              this.trackingTargets.push({
                name: data.name,
                imageUrl: data.imageUrl,
                physicalWidthMm: parseFloat(data.widthMm),
              });
            }
          },
        },
      ],
    });
    await alert.present();
  }

  removeTrackingTarget(index: number): void {
    this.trackingTargets.splice(index, 1);
  }

  async takeScreenshot(): Promise<void> {
    if (!this.arPlugin) return;
    try {
      const { imagePath } = await this.arPlugin.captureScreenshot();
      await this.showToast(`Screenshot saved: ${imagePath}`, 'success');
    } catch {
      await this.showToast('Failed to capture screenshot', 'danger');
    }
  }

  private async showToast(message: string, color: string): Promise<void> {
    const toast = await this.toastCtrl.create({
      message, duration: 3000, color, position: 'top',
    });
    await toast.present();
  }
}
