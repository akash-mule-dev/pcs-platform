import { Component, OnInit, OnDestroy } from '@angular/core';
import { AuthService, User } from '../core/services/auth.service';
import { TimeTrackingService, TimeEntry } from '../core/services/time-tracking.service';
import { WorkOrderService } from '../core/services/work-order.service';
import { Router } from '@angular/router';
import { Subject, takeUntil, forkJoin } from 'rxjs';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.page.html',
  styleUrls: ['./dashboard.page.scss'],
  standalone: false
})
export class DashboardPage implements OnInit, OnDestroy {
  user: User | null = null;
  activeEntry: TimeEntry | null = null;
  workOrderCount = 0;
  todayCompleted = 0;
  todayTotalSeconds = 0;
  private destroy$ = new Subject<void>();

  constructor(
    private authService: AuthService,
    private timeService: TimeTrackingService,
    private woService: WorkOrderService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.authService.currentUser$.pipe(takeUntil(this.destroy$)).subscribe(u => this.user = u);
    this.loadData();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadData(event?: { target: { complete: () => void } }): void {
    forkJoin({
      active: this.timeService.getActive(),
      history: this.timeService.getHistory(),
      orders: this.woService.getAll()
    }).subscribe({
      next: ({ active, history, orders }) => {
        this.activeEntry = active.length > 0 ? active[0] : null;
        const today = new Date().toISOString().slice(0, 10);
        const todayEntries = history.filter(e => e.startTime?.slice(0, 10) === today);
        this.todayCompleted = todayEntries.filter(e => e.endTime).length;
        this.todayTotalSeconds = todayEntries.reduce((sum, e) => sum + (e.durationSeconds || 0), 0);
        this.workOrderCount = orders.length;
        if (event) event.target.complete();
      },
      error: () => { if (event) event.target.complete(); }
    });
  }

  goToTimer(): void {
    this.router.navigate(['/tabs/timer']);
  }

  get greeting(): string {
    const h = new Date().getHours();
    if (h < 12) return 'Good Morning';
    if (h < 18) return 'Good Afternoon';
    return 'Good Evening';
  }
}
