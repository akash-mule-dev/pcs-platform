import { Component, OnInit } from '@angular/core';
import { WorkOrderService, WorkOrder } from '../../core/services/work-order.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-work-order-list',
  templateUrl: './work-order-list.page.html',
  styleUrls: ['./work-order-list.page.scss'],
  standalone: false
})
export class WorkOrderListPage implements OnInit {
  workOrders: WorkOrder[] = [];

  constructor(private woService: WorkOrderService, private router: Router) {}

  ngOnInit(): void { this.load(); }

  load(event?: { target: { complete: () => void } }): void {
    this.woService.getAll().subscribe({
      next: orders => { this.workOrders = orders; if (event) event.target.complete(); },
      error: () => { if (event) event.target.complete(); }
    });
  }

  openDetail(wo: WorkOrder): void {
    this.router.navigate(['/tabs/work-orders', wo.id]);
  }

  priorityColor(p: string): string {
    const m: Record<string, string> = { low: 'success', medium: 'warning', high: 'tertiary', urgent: 'danger' };
    return m[p] || 'medium';
  }
}
