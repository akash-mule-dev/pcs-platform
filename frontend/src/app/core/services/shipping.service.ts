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
  productionOrderId: string | null;
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
  productionOrderId: string;
  shipmentNumber: string;
  destination?: string;
  carrier?: string;
  plannedDate?: string;
  notes?: string;
}

/** A production-complete assembly of one work order, with its ship allocation. */
export interface ShipReadyRow {
  nodeId: string;
  mark: string | null;
  name: string | null;
  profile: string | null;
  weightKg: number | null;
  completedQty: number;
  shippedQty: number;
  allocatedQty: number;
  availableQty: number;
  openNcr: number;
  blocked: boolean;
}

@Injectable({ providedIn: 'root' })
export class ShippingService {
  private readonly base = `${environment.apiUrl}/shipments`;

  constructor(private http: HttpClient) {}

  /** Loads for one work order (production order). */
  listByOrder(orderId: string): Observable<Shipment[]> {
    return this.http.get<Shipment[]>(this.base, { params: { orderId } });
  }

  listByProject(projectId: string): Observable<Shipment[]> {
    return this.http.get<Shipment[]>(this.base, { params: { projectId } });
  }

  /** Ship board for one work order: each assembly's complete/shipped/allocated/available units. */
  shipBoard(orderId: string): Observable<ShipReadyRow[]> {
    return this.http.get<ShipReadyRow[]>(`${this.base}/board`, { params: { orderId } });
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

  /** Delivery note / packing slip data (rendered as a printable view → browser PDF). */
  deliveryNote(shipmentId: string, heats = true): Observable<DeliveryNote> {
    return this.http.get<DeliveryNote>(`${this.base}/${shipmentId}/delivery-note`, { params: { heats: String(heats) } });
  }

  /** QC sign-off dossier for a shipment (delivery header + MTR + inspections + NCRs + releasability). */
  qcPackage(shipmentId: string): Observable<QcPackage> {
    return this.http.get<QcPackage>(`${this.base}/${shipmentId}/qc-package`);
  }
}

export interface DeliveryNoteItem {
  mark: string | null; name: string | null; nodeType: string | null;
  profile: string | null; materialGrade: string | null;
  quantity: number; unitWeightKg: number | null; lineWeightKg: number | null;
  heats: { heatNumber: string | null; lotNumber: string; certReference: string | null }[];
}
export interface DeliveryNote {
  organization: { name: string };
  project: { id: string; name: string | null; number: string | null; client: string | null };
  order: { id: string | null; number: string | null; customerName: string | null };
  shipment: { id: string; number: string; status: string; destination: string | null; carrier: string | null; plannedDate: string | null; shippedAt: string | null; notes: string | null };
  items: DeliveryNoteItem[];
  totals: { lines: number; pieces: number; weightKg: number };
  generatedAt: string;
}

export interface QcDossierInspection {
  id: string; node_mark: string | null; mesh_name: string | null; status: string | null; signoff_status: string | null;
  severity: string | null; defect_type: string | null; measurement_value: number | null; measurement_unit: string | null;
  tolerance_min: number | null; tolerance_max: number | null; inspector: string | null; created_at: string;
}
export interface QcDossierReport {
  id: string; number: string; template_name: string; template_type: string | null; status: string; ncr_status: string | null;
  disposition: string | null; disposition_notes: string | null; root_cause: string | null; corrective_action: string | null;
  concession_reason: string | null; resolved_at: string | null; created_at: string; node_mark: string | null;
}
export interface QcPackage extends DeliveryNote {
  qc: {
    inspections: QcDossierInspection[];
    ncrs: QcDossierReport[];
    reports: QcDossierReport[];
    scopeNodeCount: number;
    releasability: { openNcrs: number; unsignedFailures: number; itemsMissingMtr: number; releasable: boolean };
  };
}
