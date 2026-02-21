import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { ToastController } from '@ionic/angular';
import { TimeTrackingService, TimeEntry } from '../../core/services/time-tracking.service';
import { WorkOrderService, WorkOrder, WorkOrderStage } from '../../core/services/work-order.service';
import { Subject, takeUntil } from 'rxjs';

@Component({
  selector: 'app-timer',
  templateUrl: './timer.page.html',
  styleUrls: ['./timer.page.scss'],
  standalone: false
})
export class TimerPage implements OnInit, OnDestroy {
  activeEntry: TimeEntry | null = null;
  elapsedSeconds = 0;
  notes = '';
  pendingStages: { stage: WorkOrderStage; workOrder: WorkOrder }[] = [];
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private destroy$ = new Subject<void>();

  constructor(
    private timeService: TimeTrackingService,
    private woService: WorkOrderService,
    private toastCtrl: ToastController,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.loadState();
  }

  ngOnDestroy(): void {
    this.stopTicker();
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadState(): void {
    this.timeService.getActive().subscribe(entries => {
      if (entries.length > 0) {
        this.activeEntry = entries[0];
        this.startTicker();
      } else {
        this.activeEntry = null;
        this.loadPendingStages();
      }
    });
  }

  loadPendingStages(): void {
    this.woService.getAll().subscribe(orders => {
      this.pendingStages = [];
      for (const wo of orders) {
        if (wo.stages) {
          for (const ws of wo.stages) {
            if (ws.status === 'pending') {
              this.pendingStages.push({ stage: ws, workOrder: wo });
            }
          }
        }
      }
    });
  }

  clockIn(item: { stage: WorkOrderStage; workOrder: WorkOrder }): void {
    this.timeService.clockIn(item.stage.id).subscribe({
      next: async (entry) => {
        this.activeEntry = entry;
        this.notes = '';
        this.startTicker();
        const toast = await this.toastCtrl.create({ message: '⏱ Clocked in!', duration: 2000, color: 'success', position: 'top' });
        await toast.present();
      },
      error: async (err) => {
        const toast = await this.toastCtrl.create({ message: err?.error?.message || 'Clock-in failed', duration: 3000, color: 'danger', position: 'top' });
        await toast.present();
      }
    });
  }

  clockOut(): void {
    if (!this.activeEntry) return;
    this.timeService.clockOut(this.activeEntry.id, this.notes || undefined).subscribe({
      next: async () => {
        this.stopTicker();
        this.activeEntry = null;
        this.elapsedSeconds = 0;
        this.notes = '';
        this.loadPendingStages();
        const toast = await this.toastCtrl.create({ message: '✅ Clocked out!', duration: 2000, color: 'success', position: 'top' });
        await toast.present();
      },
      error: async (err) => {
        const toast = await this.toastCtrl.create({ message: err?.error?.message || 'Clock-out failed', duration: 3000, color: 'danger', position: 'top' });
        await toast.present();
      }
    });
  }

  goToHistory(): void {
    this.router.navigate(['/tabs/timer/history']);
  }

  get displayMinutes(): string {
    return String(Math.floor(this.elapsedSeconds / 60)).padStart(2, '0');
  }

  get displaySeconds(): string {
    return String(this.elapsedSeconds % 60).padStart(2, '0');
  }

  private startTicker(): void {
    this.stopTicker();
    this.updateElapsed();
    this.timerInterval = setInterval(() => this.updateElapsed(), 1000);
  }

  private stopTicker(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  private updateElapsed(): void {
    if (this.activeEntry) {
      const start = new Date(this.activeEntry.startTime).getTime();
      this.elapsedSeconds = Math.floor((Date.now() - start) / 1000);
    }
  }
}
