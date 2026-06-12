import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../core/services/api.service';

/** Thin API layer for the Materials / Inventory backend (Phase 2). */
@Injectable({ providedIn: 'root' })
export class MaterialsApiService {
  constructor(private api: ApiService) {}

  // Materials
  listMaterials(): Observable<any> { return this.api.get('/materials'); }
  createMaterial(body: any): Observable<any> { return this.api.post('/materials', body); }
  updateMaterial(id: string, body: any): Observable<any> { return this.api.patch(`/materials/${id}`, body); }
  deleteMaterial(id: string): Observable<any> { return this.api.delete(`/materials/${id}`); }

  // Inventory
  getStock(): Observable<any> { return this.api.get('/inventory/stock'); }
  getMovements(materialId?: string): Observable<any> {
    return this.api.get('/inventory/movements', materialId ? { materialId } : undefined);
  }
  receive(body: any): Observable<any> { return this.api.post('/inventory/receive', body); }
  issue(body: any): Observable<any> { return this.api.post('/inventory/issue', body); }
  adjust(body: any): Observable<any> { return this.api.post('/inventory/adjust', body); }
}
