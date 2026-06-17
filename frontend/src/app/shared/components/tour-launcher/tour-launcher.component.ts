import { Component, Input, OnInit, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TourService } from '../../../core/services/tour.service';

/**
 * Drop-in button that launches (and optionally auto-runs) a registered tour.
 *
 *   <app-tour-launcher tourId="kanban" [auto]="true"></app-tour-launcher>
 *
 * Renders nothing if the tour id isn't registered, so it's safe to place freely.
 */
@Component({
  selector: 'app-tour-launcher',
  standalone: true,
  imports: [MatIconModule, MatButtonModule, MatTooltipModule],
  template: `
    @if (tour.hasTour(tourId)) {
      <button mat-icon-button type="button" class="tour-launcher-btn"
              (click)="tour.start(tourId)" [matTooltip]="tooltip">
        <mat-icon>{{ icon }}</mat-icon>
      </button>
    }
  `,
  styles: [`
    .tour-launcher-btn { color: var(--clay-text-muted); }
    .tour-launcher-btn:hover { color: var(--clay-primary); }
  `],
})
export class TourLauncherComponent implements OnInit {
  /** Registered tour id (see tour-definitions.ts). */
  @Input({ required: true }) tourId!: string;
  @Input() icon = 'help_outline';
  @Input() tooltip = 'Take a tour of this page';
  /** When true, auto-run the tour the first time an eligible user sees this page. */
  @Input() auto = false;

  tour = inject(TourService);

  ngOnInit(): void {
    if (this.auto) this.tour.maybeAutoStart(this.tourId);
  }
}
