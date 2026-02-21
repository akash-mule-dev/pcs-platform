import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from './core/services/auth.service';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false
})
export class AppComponent implements OnInit {
  constructor(private authService: AuthService, private router: Router) {}

  async ngOnInit(): Promise<void> {
    await this.authService.init();
    if (!this.authService.isAuthenticated$.value) {
      await this.router.navigate(['/login']);
    }
  }
}
