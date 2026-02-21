import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { ToastController, LoadingController } from '@ionic/angular';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  standalone: false
})
export class LoginPage {
  email = '';
  password = '';

  constructor(
    private authService: AuthService,
    private router: Router,
    private toastCtrl: ToastController,
    private loadingCtrl: LoadingController
  ) {}

  async onLogin(): Promise<void> {
    if (!this.email || !this.password) return;
    const loading = await this.loadingCtrl.create({ message: 'Signing in...' });
    await loading.present();
    this.authService.login(this.email, this.password).subscribe({
      next: async () => {
        await loading.dismiss();
        await this.router.navigate(['/tabs/dashboard']);
      },
      error: async (err) => {
        await loading.dismiss();
        const toast = await this.toastCtrl.create({
          message: err?.error?.message || 'Login failed. Check your credentials.',
          duration: 3000,
          color: 'danger',
          position: 'top'
        });
        await toast.present();
      }
    });
  }
}
