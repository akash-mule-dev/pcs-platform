import { Component, OnInit } from '@angular/core';
import { AuthService, User } from '../core/services/auth.service';
import { TimeTrackingService, TimeEntry } from '../core/services/time-tracking.service';

@Component({
  selector: 'app-profile',
  templateUrl: './profile.page.html',
  styleUrls: ['./profile.page.scss'],
  standalone: false
})
export class ProfilePage implements OnInit {
  user: User | null = null;
  weekStages = 0;
  avgTimeSeconds = 0;
  efficiencyPct = 0;

  constructor(
    private authService: AuthService,
    private timeService: TimeTrackingService
  ) {}

  ngOnInit(): void {
    this.authService.currentUser$.subscribe(u => {
      this.user = u;
      // If user is loaded from storage but profile data may be stale,
      // fetch fresh data from the API
      if (u && !this._profileFetched) {
        this._profileFetched = true;
        this.authService.getProfile().subscribe();
      }
    });
    this.loadStats();
  }

  private _profileFetched = false;

  loadStats(): void {
    this.timeService.getHistory().subscribe(entries => {
      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 86400000);
      const recent = entries.filter(e => e.endTime && new Date(e.startTime) >= weekAgo);
      this.weekStages = recent.length;
      const totalActual = recent.reduce((s, e) => s + (e.durationSeconds || 0), 0);
      this.avgTimeSeconds = this.weekStages > 0 ? Math.round(totalActual / this.weekStages) : 0;
      const totalTarget = recent.reduce((s, e) => s + (e.workOrderStage?.stage?.targetTimeSeconds || 0), 0);
      this.efficiencyPct = totalTarget > 0 ? Math.round((totalTarget / totalActual) * 100) : 0;
    });
  }

  getRoleName(): string {
    return this.user?.role?.name || '';
  }

  async logout(): Promise<void> {
    await this.authService.logout();
  }
}
