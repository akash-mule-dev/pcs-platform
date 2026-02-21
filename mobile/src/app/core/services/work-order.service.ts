import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

export interface WorkOrderStage {
  id: string;
  workOrderId: string;
  stageId: string;
  stage?: { id: string; name: string; sequence: number; targetTimeSeconds: number; description: string };
  assignedUserId: string | null;
  stationId: string | null;
  status: 'pending' | 'in_progress' | 'completed' | 'skipped';
  startedAt: string | null;
  completedAt: string | null;
  actualTimeSeconds: number | null;
}

export interface WorkOrder {
  id: string;
  orderNumber: string;
  product?: { id: string; name: string; sku: string };
  process?: { id: string; name: string };
  line?: { id: string; name: string } | null;
  quantity: number;
  completedQuantity: number;
  status: 'draft' | 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  dueDate: string | null;
  startedAt: string | null;
  completedAt: string | null;
  stages?: WorkOrderStage[];
}

@Injectable({ providedIn: 'root' })
export class WorkOrderService {
  constructor(private api: ApiService) {}

  getAll(params: Record<string, string | number> = {}): Observable<WorkOrder[]> {
    return this.api.get<WorkOrder[]>('/work-orders', params);
  }

  getById(id: string): Observable<WorkOrder> {
    return this.api.get<WorkOrder>(`/work-orders/${id}`);
  }
}
