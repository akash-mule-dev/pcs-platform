import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ToastController } from '@ionic/angular';
import { WorkOrderService, WorkOrder, WorkOrderStage } from '../../core/services/work-order.service';
import { TimeTrackingService } from '../../core/services/time-tracking.service';

@Component({
  selector: 'app-work-order-detail',
  templateUrl: './work-order-detail.page.html',
  styleUrls: ['./work-order-detail.page.scss'],
  standalone: false
})
export class WorkOrderDetailPage implements OnInit {
  workOrder: WorkOrder | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private woService: WorkOrderService,
    private timeService: TimeTrackingService,
    private toastCtrl: ToastController
  ) {}

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.woService.getById(id).subscribe(wo => this.workOrder = wo);
    }
  }

  async clockInToStage(stage: WorkOrderStage): Promise<void> {
    this.timeService.clockIn(stage.id).subscribe({
      next: async () => {
        const toast = await this.toastCtrl.create({ message: 'Clocked in!', duration: 2000, color: 'success', position: 'top' });
        await toast.present();
        await this.router.navigate(['/tabs/timer']);
      },
      error: async (err) => {
        const toast = await this.toastCtrl.create({ message: err?.error?.message || 'Failed to clock in', duration: 3000, color: 'danger', position: 'top' });
        await toast.present();
      }
    });
  }

  stageStatusIcon(status: string): string {
    const m: Record<string, string> = { pending: 'ellipse-outline', in_progress: 'play-circle', completed: 'checkmark-circle', skipped: 'remove-circle' };
    return m[status] || 'ellipse-outline';
  }

  stageStatusColor(status: string): string {
    const m: Record<string, string> = { pending: 'medium', in_progress: 'primary', completed: 'success', skipped: 'warning' };
    return m[status] || 'medium';
  }
}
