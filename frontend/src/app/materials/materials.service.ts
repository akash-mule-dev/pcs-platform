import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiService } from '../core/services/api.service';

export interface MaterialSummaryRow {
  id: string;
  code: string;
  name: string;
  type: string;
  unitOfMeasure: string;
  specification: string | null;
  profile: string | null;
  materialGrade: string | null;
  unitCost: number;
  reorderLevel: number;
  isActive: boolean;
  onHand: number;
  reserved: number;
  value: number;
  lowStock: boolean;
}

export interface InventorySummary {
  materials: MaterialSummaryRow[];
  totals: { materials: number; totalValue: number; lowStock: number };
}

export interface StockMovementRow {
  id: string;
  type: 'receipt' | 'issue' | 'scrap' | 'adjustment' | 'reserve' | 'release' | 'return';
  quantity: number;
  unitCost: number | null;
  location: string;
  workOrderId: string | null;
  productionOrderId: string | null;
  reference: string | null;
  note: string | null;
  createdAt: string;
  material?: { id: string; code: string; name: string; unitOfMeasure: string };
}

/** Unwrap the backend's `{ data: T }` envelope (also tolerates raw payloads). */
const unwrap = <T>() => map((res: any): T => (res && typeof res === 'object' && 'data' in res ? res.data : res));

/** API layer for materials, stock and goods movements (moving-average valuation). */
@Injectable({ providedIn: 'root' })
export class MaterialsApiService {
  constructor(private api: ApiService) {}

  // Materials master
  listMaterials(): Observable<any> { return this.api.get('/materials'); }
  createMaterial(body: any): Observable<any> { return this.api.post('/materials', body); }
  updateMaterial(id: string, body: any): Observable<any> { return this.api.patch(`/materials/${id}`, body); }
  deleteMaterial(id: string): Observable<any> { return this.api.delete(`/materials/${id}`); }

  // Inventory
  getSummary(): Observable<InventorySummary> { return this.api.get<any>('/inventory/summary').pipe(unwrap<InventorySummary>()); }
  getStock(): Observable<any> { return this.api.get('/inventory/stock'); }
  getMovements(filter?: { materialId?: string; productionOrderId?: string; workOrderId?: string }): Observable<StockMovementRow[]> {
    return this.api.get<any>('/inventory/movements', filter as any).pipe(unwrap<StockMovementRow[]>());
  }
  receive(body: { materialId: string; quantity: number; unitCost?: number; reference?: string; note?: string }): Observable<any> {
    return this.api.post('/inventory/receive', body);
  }
  issue(body: { materialId: string; quantity: number; productionOrderId?: string; workOrderId?: string; note?: string }): Observable<any> {
    return this.api.post('/inventory/issue', body);
  }
  returnStock(body: { materialId: string; quantity: number; productionOrderId?: string; workOrderId?: string; note?: string }): Observable<any> {
    return this.api.post('/inventory/return', body);
  }
  scrap(body: { materialId: string; quantity: number; productionOrderId?: string; workOrderId?: string; note?: string }): Observable<any> {
    return this.api.post('/inventory/scrap', body);
  }
  adjust(body: { materialId: string; quantityOnHand: number; note?: string }): Observable<any> {
    return this.api.post('/inventory/adjust', body);
  }
}
