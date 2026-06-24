import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

export type StationType = 'laser' | 'saw' | 'drill' | 'fit_up' | 'weld' | 'blast' | 'paint' | 'qc' | 'other';
export type StationStatus = 'available' | 'running' | 'idle' | 'setup' | 'down' | 'maintenance' | 'offline';

export const STATION_TYPES: StationType[] = ['laser', 'saw', 'drill', 'fit_up', 'weld', 'blast', 'paint', 'qc', 'other'];
export const STATION_STATUSES: StationStatus[] = ['available', 'running', 'idle', 'setup', 'down', 'maintenance', 'offline'];

/** A row of the org-wide station directory. */
export interface StationRow {
  id: string;
  name: string;
  code: string | null;
  type: StationType;
  status: StationStatus;
  isActive: boolean;
  lineId: string;
  lineName: string | null;
  machineRate: number | null; // null when the caller can't see cost
  hasMachineRate: boolean;
  availableHoursPerDay: number | null;
  busy: boolean;
  occupant: string | null;
  equipmentCount: number;
}

export interface StationUtilRow {
  stationId: string;
  name: string;
  code: string | null;
  attendedSeconds: number;
  attendedHours: number;
  setupHours: number;
  runHours: number;
  reworkHours: number;
  idleHours: number;
  machineSeconds: number;
  machineHours: number;
  machineCost: number;
  entries: number;
  operators: number;
  availableHours: number | null;
  utilizationPct: number | null;
}

export interface UtilizationResponse {
  from: string;
  to: string;
  windowDays: number;
  withCost: boolean;
  totals: { attendedSeconds: number; attendedHours: number; setupHours: number; runHours: number; reworkHours: number; machineCost: number; entries: number };
  stations: StationUtilRow[];
}

export interface StationOccupancySession {
  id: string;
  userId: string;
  userName: string;
  stageName: string | null;
  workOrderId: string | null;
  orderNumber: string | null;
  productionOrderId: string | null;
  mark: string | null;
  isSetup: boolean;
  isRework: boolean;
  startTime: string;
  elapsedSeconds: number;
}

export interface StationQueueItem {
  workOrderStageId: string;
  status: string;
  qtyDone: number;
  qtyTotal: number | null;
  stageName: string | null;
  sequence: number;
  workOrderId: string;
  orderNumber: string;
  workOrderStatus: string;
  productionOrderId: string | null;
  mark: string | null;
}

export interface StationEquipment {
  id: string;
  code: string;
  name: string;
  type: string;
  status: string;
  isActive: boolean;
  hourlyRate: number | null;
}

export interface StationDetail {
  station: {
    id: string;
    name: string;
    code: string | null;
    description: string | null;
    type: StationType;
    status: StationStatus;
    isActive: boolean;
    lineId: string;
    lineName: string | null;
    machineRate: number | null;
    hasMachineRate: boolean;
    availableHoursPerDay: number | null;
    createdAt: string;
    updatedAt: string;
  };
  equipment: StationEquipment[];
  occupancy: { busy: boolean; sessions: StationOccupancySession[] };
  queue: { counts: { pending: number; inProgress: number }; items: StationQueueItem[] };
}

export interface Line {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  stations?: { id: string; name: string }[];
}

export interface CreateStationPayload {
  name: string;
  lineId: string;
  code?: string;
  description?: string;
  type?: StationType;
  status?: StationStatus;
  machineRate?: number;
  availableHoursPerDay?: number;
}
export type UpdateStationPayload = Partial<CreateStationPayload> & { isActive?: boolean };

@Injectable({ providedIn: 'root' })
export class StationsService {
  private api = inject(ApiService);

  // ── Stations ──────────────────────────────────────────────────────────────
  list(filters: Record<string, any> = {}): Observable<StationRow[]> {
    return this.api.getList<StationRow>('/stations', filters);
  }
  utilization(params: { from?: string; to?: string } = {}): Observable<UtilizationResponse> {
    return this.api.get<UtilizationResponse>('/stations/utilization', params);
  }
  stationUtilization(id: string, params: { from?: string; to?: string } = {}): Observable<UtilizationResponse> {
    return this.api.get<UtilizationResponse>(`/stations/${id}/utilization`, params);
  }
  detail(id: string): Observable<StationDetail> {
    return this.api.get<StationDetail>(`/stations/${id}`);
  }
  create(body: CreateStationPayload): Observable<any> {
    return this.api.post('/stations', body);
  }
  update(id: string, body: UpdateStationPayload): Observable<any> {
    return this.api.patch(`/stations/${id}`, body);
  }
  setStatus(id: string, status: StationStatus): Observable<any> {
    return this.api.patch(`/stations/${id}/status`, { status });
  }
  remove(id: string): Observable<any> {
    return this.api.delete(`/stations/${id}`);
  }

  // ── Lines ─────────────────────────────────────────────────────────────────
  listLines(): Observable<Line[]> {
    return this.api.getList<Line>('/lines', { limit: 200 });
  }
  createLine(body: { name: string; description?: string }): Observable<any> {
    return this.api.post('/lines', body);
  }
  updateLine(id: string, body: { name?: string; description?: string; isActive?: boolean }): Observable<any> {
    return this.api.patch(`/lines/${id}`, body);
  }
  removeLine(id: string): Observable<any> {
    return this.api.delete(`/lines/${id}`);
  }
}
