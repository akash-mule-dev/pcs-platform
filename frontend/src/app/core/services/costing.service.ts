import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiService } from './api.service';

export interface CostingSettings {
  defaultLaborRate: number;
  overheadPercent: number;
  currency: string;
  configured: boolean;
}

export interface CostTotals {
  materialCost: number;
  laborCost: number;
  machineCost: number;
  overheadCost: number;
  totalCost: number;
  laborSeconds?: number;
  laborHours?: number;
  machineSeconds?: number;
  machineHours?: number;
}

export interface CostVariance { amount: number; percent: number | null }

export interface OrderCost {
  orderId: string;
  number: string;
  customerName: string | null;
  quantity: number;
  status: string;
  projectId: string;
  currency: string;
  settings: CostingSettings;
  ratesConfigured: { workersWithRate: number; stagesWithRate: number };
  actual: CostTotals;
  estimate: CostTotals & { materialUnmappedLines: number; materialUnpricedNote: boolean };
  variance: { material: CostVariance; labor: CostVariance; machine: CostVariance; total: CostVariance };
  items: {
    workOrderId: string; orderNumber: string; mark: string; status: string;
    laborSeconds: number; laborHours: number; laborCost: number;
    machineHours: number; machineCost: number;
    materialCost: number; allocatedMaterialCost: number; estimatedMaterialCost: number; totalCost: number;
  }[];
  materials: { materialId: string; code: string; name: string; unitOfMeasure: string; quantity: number; cost: number }[];
  unattributedMaterialCost: number;
  allocatedMaterialTotal: number;
}

export interface CostingOrdersOverview {
  currency: string;
  settings: CostingSettings;
  kpis: { orders: number; laborCost: number; machineCost?: number; materialCost: number; overheadCost?: number; totalCost: number };
  orders: {
    orderId: string; number: string; customerName: string | null; quantity: number; status: string; createdAt: string;
    project: { id: string; name: string };
    laborHours: number; machineHours?: number; materialCost: number; laborCost: number; machineCost: number; overheadCost: number; totalCost: number;
  }[];
}

export interface ProjectCost {
  projectId: string;
  name: string;
  currency: string;
  settings: CostingSettings;
  perUnitMaterialEstimate?: number;
  actual: CostTotals;
  orders: {
    orderId: string; number: string; customerName: string | null; quantity: number; status: string; laborHours: number; machineHours?: number;
    materialCost: number; laborCost: number; machineCost: number; overheadCost: number; totalCost: number; estimatedMaterialCost: number;
  }[];
}

const unwrap = <T>() => map((res: any): T => (res && typeof res === 'object' && 'data' in res ? res.data : res));

/** Work-order costing: settings + cost roll-ups (work order / order / project / org-wide). */
@Injectable({ providedIn: 'root' })
export class CostingApiService {
  constructor(private api: ApiService) {}

  getSettings(): Observable<CostingSettings> {
    return this.api.get<any>('/costing/settings').pipe(unwrap<CostingSettings>());
  }
  updateSettings(body: { defaultLaborRate?: number; overheadPercent?: number; currency?: string }): Observable<CostingSettings> {
    return this.api.put<any>('/costing/settings', body).pipe(unwrap<CostingSettings>());
  }
  ordersOverview(): Observable<CostingOrdersOverview> {
    return this.api.get<any>('/costing/orders').pipe(unwrap<CostingOrdersOverview>());
  }
  orderCost(orderId: string): Observable<OrderCost> {
    return this.api.get<any>(`/costing/order/${orderId}`).pipe(unwrap<OrderCost>());
  }
  projectCost(projectId: string): Observable<ProjectCost> {
    return this.api.get<any>(`/costing/project/${projectId}`).pipe(unwrap<ProjectCost>());
  }
  workOrderCost(workOrderId: string): Observable<any> {
    return this.api.get<any>(`/costing/work-order/${workOrderId}`).pipe(unwrap());
  }
}
