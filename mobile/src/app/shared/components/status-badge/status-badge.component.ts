import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-status-badge',
  template: `<ion-chip [color]="chipColor" [outline]="true"><ion-label>{{ label }}</ion-label></ion-chip>`,
  standalone: false
})
export class StatusBadgeComponent {
  @Input() status = '';

  get label(): string {
    return this.status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  get chipColor(): string {
    const map: Record<string, string> = {
      draft: 'medium',
      pending: 'warning',
      in_progress: 'primary',
      completed: 'success',
      cancelled: 'danger',
      skipped: 'medium',
      low: 'success',
      medium: 'warning',
      high: 'tertiary',
      urgent: 'danger'
    };
    return map[this.status] || 'medium';
  }
}
