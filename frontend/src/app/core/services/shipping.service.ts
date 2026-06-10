import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export type ShipmentStatus = 'planned' | 'loaded' | 'shipped' | 'delivered' | 'cancelled';

export interface ShipmentItem {
  id: string;
  shipmentId: string;
  assemblyNodeId: string;
  quantity: number;
  assemblyNode?: { id: string; name: string; mark: string | null; weightKg: number | null } | null;
}

export interface Shipment {
  id: string;
  projectId: string;
  shipmentNumber: string;
  status: ShipmentStatus;
  destination: string | null;
  carrier: string | null;
  plannedDate: string | null;
  shippedAt: string | null;
  notes: string | null;
  items: ShipmentItem[];
  createdAt: string;
}

export interface CreateShipment {
  projectId: string;
  shipmentNumber: string;
  destination?: string;
  carrier?: string;
  plannedDate?: string;
  notes?: string;
}

@Injectable({ providedIn: 'root' })
export class ShippingService {
  private readonly base = `${environment.apiUrl}/shipments`;

  constructor(private http: HttpClient) {}

  listByProject(projectId: string): Observable<Shipment[]> {
    return this.http.get<Shipment[]>(this.base, { params: { projectId } });
  }

  create(dto: CreateShipment): Observable<Shipment> {
    return this.http.post<Shipment>(this.base, dto);
  }

  addItem(shipmentId: string, assemblyNodeId: string, quantity: number): Observable<ShipmentItem> {
    return this.http.post<ShipmentItem>(`${this.base}/${shipmentId}/items`, { assemblyNodeId, quantity });
  }

  removeItem(shipmentId: string, itemId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${shipmentId}/items/${itemId}`);
  }

  setStatus(shipmentId: string, status: ShipmentStatus): Observable<Shipment> {
    return this.http.patch<Shipment>(`${this.base}/${shipmentId}/status`, { status });
  }

  remove(shipmentId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${shipmentId}`);
  }
}
