import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { ToastController, ActionSheetController } from '@ionic/angular';
import { ApiService } from '../../core/services/api.service';
import { environment } from '../../../environments/environment';

interface Model3D {
  id: string;
  name: string;
  description: string;
  fileName: string;
  originalName: string;
  fileSize: number;
  modelType: string;
  product?: { id: string; name: string; sku: string };
  createdAt: string;
}

@Component({
  selector: 'app-model-list',
  templateUrl: './model-list.page.html',
  styleUrls: ['./model-list.page.scss'],
  standalone: false,
})
export class ModelListPage implements OnInit {
  models: Model3D[] = [];
  filterType = '';

  constructor(
    private api: ApiService,
    private router: Router,
    private toastCtrl: ToastController,
    private actionSheetCtrl: ActionSheetController,
  ) {}

  ngOnInit(): void {
    this.loadModels();
  }

  loadModels(event?: { target: { complete: () => void } }): void {
    const params: Record<string, string> = {};
    if (this.filterType) params['modelType'] = this.filterType;
    this.api.get<any>('/models', params).subscribe({
      next: (res) => {
        this.models = res.data || res;
        if (event) event.target.complete();
      },
      error: async () => {
        if (event) event.target.complete();
        const toast = await this.toastCtrl.create({
          message: 'Failed to load models', duration: 3000, color: 'danger', position: 'top',
        });
        await toast.present();
      },
    });
  }

  async openModel(model: Model3D): Promise<void> {
    const actionSheet = await this.actionSheetCtrl.create({
      header: model.name,
      buttons: [
        {
          text: 'View in 3D',
          icon: 'cube-outline',
          handler: () => this.router.navigate(['/tabs/models', model.id, 'view']),
        },
        {
          text: 'View in AR (WebXR)',
          icon: 'scan-outline',
          handler: () => this.router.navigate(['/tabs/models', model.id, 'ar']),
        },
        {
          text: 'Native AR + Image Tracking',
          icon: 'camera-outline',
          handler: () => this.router.navigate(['/tabs/models', model.id, 'native-ar']),
        },
        {
          text: 'Quality Inspection',
          icon: 'shield-checkmark-outline',
          handler: () => this.router.navigate(['/tabs/models', model.id, 'quality']),
        },
        { text: 'Cancel', role: 'cancel', icon: 'close' },
      ],
    });
    await actionSheet.present();
  }

  formatSize(bytes: number): string {
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }
}
