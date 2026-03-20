import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ActionSheetController, ToastController, ViewWillEnter } from '@ionic/angular';
import { WorkOrderService, WorkOrder, WorkOrderStage } from '../../core/services/work-order.service';
import { TimeTrackingService } from '../../core/services/time-tracking.service';

@Component({
  selector: 'app-work-order-detail',
  templateUrl: './work-order-detail.page.html',
  styleUrls: ['./work-order-detail.page.scss'],
  standalone: false
})
export class WorkOrderDetailPage implements OnInit, ViewWillEnter {
  workOrder: WorkOrder | null = null;
  private workOrderId: string | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private woService: WorkOrderService,
    private timeService: TimeTrackingService,
    private toastCtrl: ToastController,
    private actionSheetCtrl: ActionSheetController
  ) {}

  ngOnInit(): void {
    this.workOrderId = this.route.snapshot.paramMap.get('id');
    this.loadWorkOrder();
  }

  ionViewWillEnter(): void {
    this.loadWorkOrder();
  }

  private loadWorkOrder(): void {
    if (this.workOrderId) {
      this.woService.getById(this.workOrderId).subscribe(wo => this.workOrder = wo);
    }
  }

  async onStageTap(stage: WorkOrderStage): Promise<void> {
    if (stage.status === 'pending') {
      const buttons: any[] = [
        { text: 'Clock In & Start', icon: 'play-circle', handler: () => this.clockInToStage(stage) },
        { text: 'Skip Stage', icon: 'remove-circle', handler: () => this.updateStageStatus(stage, 'skipped') },
        { text: 'Cancel', role: 'cancel' }
      ];
      const sheet = await this.actionSheetCtrl.create({ header: stage.stage?.name || 'Stage', buttons });
      await sheet.present();
    } else if (stage.status === 'in_progress') {
      const buttons: any[] = [
        { text: 'Mark Completed', icon: 'checkmark-circle', handler: () => this.updateStageStatus(stage, 'completed') },
        { text: 'Cancel', role: 'cancel' }
      ];
      const sheet = await this.actionSheetCtrl.create({ header: stage.stage?.name || 'Stage', buttons });
      await sheet.present();
    }
  }

  private async updateStageStatus(stage: WorkOrderStage, status: string): Promise<void> {
    if (!this.workOrder) return;
    this.woService.updateStageStatus(this.workOrder.id, stage.id, status).subscribe({
      next: (wo) => {
        this.workOrder = wo;
        this.showToast(`Stage ${status.replace('_', ' ')}`, 'success');
      },
      error: (err) => this.showToast(err?.error?.message || 'Failed to update stage', 'danger')
    });
  }

  async clockInToStage(stage: WorkOrderStage): Promise<void> {
    this.timeService.clockIn(stage.id).subscribe({
      next: async () => {
        await this.showToast('Clocked in!', 'success');
        await this.router.navigate(['/tabs/timer']);
      },
      error: async (err) => this.showToast(err?.error?.message || 'Failed to clock in', 'danger')
    });
  }

  private async showToast(message: string, color: string): Promise<void> {
    const toast = await this.toastCtrl.create({ message, duration: 2000, color, position: 'top' });
    await toast.present();
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
