import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../core/services/api.service';

/** API layer for Equipment + Maintenance (Phase 3). */
@Injectable({ providedIn: 'root' })
export class EquipmentApiService {
  constructor(private api: ApiService) {}

  // Equipment
  list(): Observable<any> { return this.api.get('/equipment'); }
  create(b: any): Observable<any> { return this.api.post('/equipment', b); }
  update(id: string, b: any): Observable<any> { return this.api.patch(`/equipment/${id}`, b); }
  setStatus(id: string, status: string): Observable<any> { return this.api.patch(`/equipment/${id}/status`, { status }); }
  openDowntime(id: string, b: any): Observable<any> { return this.api.post(`/equipment/${id}/downtime`, b); }
  closeDowntime(id: string, b: any = {}): Observable<any> { return this.api.post(`/equipment/${id}/downtime/close`, b); }
  effectiveness(params?: any): Observable<any> { return this.api.get('/equipment/effectiveness', params); }

  // Maintenance
  listPlans(): Observable<any> { return this.api.get('/maintenance/plans'); }
  createPlan(b: any): Observable<any> { return this.api.post('/maintenance/plans', b); }
  due(): Observable<any> { return this.api.get('/maintenance/due'); }
  listOrders(status?: string): Observable<any> { return this.api.get('/maintenance/orders', status ? { status } : undefined); }
  createOrder(b: any): Observable<any> { return this.api.post('/maintenance/orders', b); }
  updateOrder(id: string, b: any): Observable<any> { return this.api.patch(`/maintenance/orders/${id}`, b); }
}
