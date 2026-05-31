import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-not-found',
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatIconModule],
  template: `
    <div class="not-found">
      <mat-icon class="nf-icon">error_outline</mat-icon>
      <h1>404</h1>
      <p>The page you are looking for does not exist.</p>
      <a mat-raised-button color="primary" routerLink="/">Back to dashboard</a>
    </div>
  `,
  styles: [`
    .not-found {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 60vh;
      text-align: center;
      gap: 12px;
    }
    .nf-icon { font-size: 64px; width: 64px; height: 64px; opacity: 0.5; }
    h1 { font-size: 48px; margin: 0; }
    p { opacity: 0.7; margin: 0 0 8px; }
  `],
})
export class NotFoundComponent {}
