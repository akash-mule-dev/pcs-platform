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

  ngOnInit(): void {
    // Auth is initialized via APP_INITIALIZER before routing starts.
    // Just redirect to login if not authenticated.
    if (!this.authService.isAuthenticated$.value) {
      this.router.navigate(['/login']);
    }
  }
}
