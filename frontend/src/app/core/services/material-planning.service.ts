import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiService } from './api.service';

export interface RequirementMaterial {
  id: string;
  code: string;
  name: string;
  unitOfMeasure: string;
  unitCost: number;
  onHand: number;
  lowStock: boolean;
}

export interface RequirementLine {
  key: string;
  profile: string | null;
  materialGrade: string | null;
  pieceCount: number;
  totalLengthMm: number;
  totalWeightKg: number;
  material: RequirementMaterial | null;
  uom: string;
  uomAssumed: boolean;
  requiredQty: number;
  estimatedCost: number | null;
  // order-level extras
  issuedQty?: number;
  issuedCost?: number;
  remainingQty?: number;
  shortfallQty?: number;
  status?: 'unmapped' | 'covered' | 'short' | 'issued';
}

export interface ProjectRequirements {
  projectId: string;
  perUnit: boolean;
  lines: RequirementLine[];
  totals: { lines: number; pieces: number; weightKg: number; estimatedCost: number; unmappedLines: number; unpricedLines: number };
}

export interface OrderRequirements {
  orderId: string;
  orderNumber: string;
  orderQuantity: number;
  orderStatus: string;
  projectId: string;
  lines: RequirementLine[];
  extras: { material: { id: string; code: string; name: string; unitOfMeasure: string; unitCost: number }; issuedQty: number; issuedCost: number }[];
  totals: {
    lines: number; pieces: number; weightKg: number; estimatedCost: number; issuedCost: number;
    unmappedLines: number; shortLines: number; fullyIssuedLines: number;
  };
}

const unwrap = <T>() => map((res: any): T => (res && typeof res === 'object' && 'data' in res ? res.data : res));

/** Raw-material planning: project BOM (per design unit) + per-order requirements/coverage. */
@Injectable({ providedIn: 'root' })
export class MaterialPlanningService {
  constructor(private api: ApiService) {}

  projectRequirements(projectId: string): Observable<ProjectRequirements> {
    return this.api.get<any>(`/projects/${projectId}/material-requirements`).pipe(unwrap<ProjectRequirements>());
  }

  /** Create material masters for unmapped BOM lines. */
  syncMaterials(projectId: string): Observable<{ created: { id: string; code: string; name: string }[]; skipped: number }> {
    return this.api.post<any>(`/projects/${projectId}/material-requirements/sync-materials`).pipe(unwrap());
  }

  orderRequirements(orderId: string): Observable<OrderRequirements> {
    return this.api.get<any>(`/orders/${orderId}/material-requirements`).pipe(unwrap<OrderRequirements>());
  }
}
