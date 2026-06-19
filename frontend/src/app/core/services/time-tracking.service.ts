import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiService } from './api.service';

// ── Live / floor ───────────────────────────────────────────────────────────────

export interface ActiveSession {
  id: string;
  userId: string;
  workOrderStageId: string;
  startTime: string;
  elapsedSeconds: number;
  user: { firstName?: string; lastName?: string };
  station: { name: string } | null;
  workOrderStage: { stage: { name: string } | null; workOrder: { id: string; orderNumber: string } | null };
}

export interface FloorSession {
  id: string;
  userId: string;
  userName: string;
  stageName: string | null;
  workOrderId: string | null;
  orderNumber: string | null;
  mark: string | null;
  stationId: string | null;
  stationName: string | null;
  lineName: string | null;
  isSetup: boolean;
  isRework: boolean;
  startTime: string;
  elapsedSeconds: number;
}

export interface FloorStation {
  id: string;
  name: string;
  lineName: string | null;
  hasMachineRate: boolean;
  busy: boolean;
  session: { userName: string; stageName: string | null; orderNumber: string | null; mark: string | null; elapsedSeconds: number } | null;
}

export interface FloorStatus {
  generatedAt: string;
  kpis: { activeOperators: number; activeSessions: number; activeWorkOrders: number; stations: number; busyStations: number; idleStations: number };
  sessions: FloorSession[];
  stations: FloorStation[];
}

// ── Per-work-order summary ───────────────────────────────────────────────────────

export interface TimeStage {
  workOrderStageId: string;
  stageId: string;
  name: string;
  sequence: number;
  status: string;
  qtyDone: number;
  qtyTotal: number | null;
  targetTimeSeconds: number | null;
  loggedSeconds: number;
  setupSeconds: number;
  reworkSeconds: number;
  entries: number;
  laborCost: number;
  machineCost: number;
}

export interface TimeWorker {
  userId: string;
  name: string;
  seconds: number;
  hours: number;
  entries: number;
  cost: number;
}

export interface TimeEntryRow {
  id: string;
  userId: string;
  userName: string;
  workOrderStageId: string;
  stageName: string | null;
  sequence: number;
  stationId: string | null;
  stationName: string | null;
  startTime: string;
  endTime: string | null;
  durationSeconds: number | null;
  breakSeconds: number;
  idleSeconds: number;
  isSetup: boolean;
  isRework: boolean;
  laborRate: number | null;
  machineRate: number | null;
  inputMethod: string;
  notes: string | null;
}

export interface WorkOrderTimeSummary {
  workOrderId: string;
  orderNumber: string;
  mark: string;
  status: string;
  productionOrderId: string | null;
  assemblyNodeId: string | null;
  currency: string;
  defaultLaborRate: number;
  totals: { laborSeconds: number; laborHours: number; laborCost: number; machineSeconds: number; machineHours: number; machineCost: number; entries: number };
  stages: TimeStage[];
  workers: TimeWorker[];
  entries: TimeEntryRow[];
}

export interface OrderWoTime {
  workOrderId: string;
  orderNumber: string;
  mark: string;
  status: string;
  loggedSeconds: number;
  loggedHours: number;
  entries: number;
  workers: number;
  laborCost: number;
  machineCost: number;
}

export interface OrderTime {
  orderId: string;
  currency: string;
  totals: { laborSeconds: number; laborHours: number; laborCost: number; machineCost: number; entries: number };
  workOrders: OrderWoTime[];
}

// ── Write payloads ────────────────────────────────────────────────────────────────

export interface CreateTimeEntryPayload {
  userId: string;
  workOrderStageId: string;
  stationId?: string | null;
  startTime: string;
  endTime?: string;
  durationSeconds?: number;
  breakSeconds?: number;
  idleSeconds?: number;
  isSetup?: boolean;
  isRework?: boolean;
  notes?: string;
}

export type UpdateTimeEntryPayload = Partial<CreateTimeEntryPayload> & { workOrderStageId?: string };

export interface LookupStation { id: string; name: string; lineId: string | null; lineName: string | null }
export interface LookupUser { id: string; firstName?: string; lastName?: string; name: string }
export interface LookupWorkOrder { id: string; orderNumber: string; mark: string | null; status: string }

@Injectable({ providedIn: 'root' })
export class TimeTrackingService {
  private api = inject(ApiService);

  // Reads
  floor(): Observable<FloorStatus> { return this.api.get<FloorStatus>('/time-tracking/floor'); }
  active(): Observable<ActiveSession[]> { return this.api.getList<ActiveSession>('/time-tracking/active'); }
  history(params: Record<string, any>): Observable<any> { return this.api.get<any>('/time-tracking/history', params); }
  workOrderSummary(workOrderId: string): Observable<WorkOrderTimeSummary> { return this.api.get<WorkOrderTimeSummary>(`/time-tracking/work-order/${workOrderId}/summary`); }
  orderWorkOrders(orderId: string): Observable<OrderTime> { return this.api.get<OrderTime>(`/time-tracking/order/${orderId}/work-orders`); }

  // Writes
  clockIn(body: { workOrderStageId: string; stationId?: string | null; isSetup?: boolean; inputMethod?: string }) { return this.api.post('/time-tracking/clock-in', body); }
  clockOut(timeEntryId: string, notes?: string) { return this.api.post('/time-tracking/clock-out', { timeEntryId, notes }); }
  create(body: CreateTimeEntryPayload): Observable<TimeEntryRow> { return this.api.post<TimeEntryRow>('/time-tracking', body); }
  update(id: string, body: UpdateTimeEntryPayload): Observable<TimeEntryRow> { return this.api.patch<TimeEntryRow>(`/time-tracking/${id}`, body); }
  remove(id: string): Observable<{ id: string; deleted: true }> { return this.api.delete<{ id: string; deleted: true }>(`/time-tracking/${id}`); }

  // Lookups (for pickers / dialogs)
  listWorkOrders(params: Record<string, any> = {}): Observable<LookupWorkOrder[]> {
    return this.api.getList<any>('/work-orders', params).pipe(
      map((list) => list.map((w) => ({
        id: w.id,
        orderNumber: w.orderNumber,
        mark: w.assemblyNode?.mark || w.assemblyNode?.name || null,
        status: w.status,
      }))),
    );
  }

  listUsers(): Observable<LookupUser[]> {
    return this.api.getList<any>('/users').pipe(
      map((list) => list.map((u) => ({ id: u.id, firstName: u.firstName, lastName: u.lastName, name: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || 'User' }))),
    );
  }

  /** Flatten the org's lines → stations for station pickers. */
  listStations(): Observable<LookupStation[]> {
    return this.api.getList<any>('/lines').pipe(
      map((lines) => {
        const out: LookupStation[] = [];
        for (const ln of lines) {
          for (const st of (ln.stations ?? [])) out.push({ id: st.id, name: st.name, lineId: ln.id, lineName: ln.name });
        }
        return out;
      }),
    );
  }
}
