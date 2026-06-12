import { Injectable } from '@angular/core';
import { HttpClient, HttpEvent, HttpRequest } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

export type NodeType = 'group' | 'assembly' | 'subassembly' | 'part';

/** Pure design container — lifecycle status / due dates live on each work order. */
export interface Project {
  id: string;
  name: string;
  projectNumber: string | null;
  clientName: string | null;
  description: string | null;
  processId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AssemblyNode {
  id: string;
  projectId: string;
  parentId: string | null;
  nodeType: NodeType;
  name: string;
  mark: string | null;
  quantity: number;
  ifcGuid: string | null;
  ifcClass: string | null;
  sourceFormat: string | null;
  profile: string | null;
  materialGrade: string | null;
  lengthMm: number | null;
  weightKg: number | null;
  modelId: string | null;
  meshName: string | null;
  depth: number;
  sortIndex: number;
  properties: Record<string, unknown> | null;
}

export interface ProjectMetrics {
  nodeCount: number;
  partCount: number;
  assemblyCount: number;
  tonnage: { totalKg: number };
}
export type ProjectSummary = Project & { metrics: ProjectMetrics };

export interface CreateProject {
  name: string;
  processId?: string | null;
  projectNumber?: string | null;
  clientName?: string | null;
  description?: string | null;
}

export interface ImportResult {
  importFileId: string;
  nodeCount: number;
  counts: Record<string, number>;
}

/** Design summary — what the project IS. Production progress lives per order. */
export interface ProjectProgress {
  nodes: { total: number; group: number; assembly: number; subassembly: number; part: number };
  tonnage: { totalKg: number };
  workOrders: number;
}

/** Count-based progress for one work order (production run). */
export interface OrderStageFunnel { stageId: string; name: string; sequence: number; done: number; total: number; percent: number; }
export interface OrderProgress {
  orderId: string;
  status: 'not_started' | 'in_progress' | 'completed';
  percentComplete: number;
  unitsDone: number;
  unitsTotal: number;
  assemblies: number;
  stages: OrderStageFunnel[];
}

export type QaStatus = 'pass' | 'fail' | 'warning';
export type QaSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface QualityEntry {
  id: string;
  modelId: string;
  meshName: string;
  regionLabel: string | null;
  status: QaStatus;
  inspector: string | null;
  inspectionDate: string | null;
  notes: string | null;
  defectType: string | null;
  severity: QaSeverity | null;
  measurementValue: number | null;
  measurementUnit: string | null;
  toleranceMin: number | null;
  toleranceMax: number | null;
  signoffStatus: 'pending' | 'approved' | 'rejected';
  assemblyNodeId: string | null;
  projectId: string | null;
  createdAt: string;
}

export interface RecordQuality {
  status: QaStatus;
  inspector?: string;
  notes?: string;
  defectType?: string;
  severity?: QaSeverity;
  measurementValue?: number;
  measurementUnit?: string;
  toleranceMin?: number;
  toleranceMax?: number;
  regionLabel?: string;
}

export interface RaiseNcr {
  title?: string;
  description?: string;
  severity?: QaSeverity;
  qualityDataId?: string;
}

export interface NcrRef { id: string; number: string; title: string; status: string; severity: string; }

export interface NodeQualityStatus {
  status: QaStatus | null;
  pass: number; fail: number; warning: number; total: number;
  openNcr: number;
  lastInspectedAt: string | null;
}
export interface ProjectQualitySummary {
  nodes: Record<string, NodeQualityStatus>;
  totals: { inspected: number; failed: number; openNcr: number };
}

export type OrderStatus = 'planned' | 'in_progress' | 'completed' | 'cancelled';
export interface ProductionOrder {
  id: string; number: string; projectId: string; customerName: string | null;
  quantity: number; processId: string | null; status: OrderStatus; dueDate: string | null; createdAt: string;
}
export interface OrderStageRow { stageId: string; workOrderStageId: string; status: string; qtyDone: number; qtyTotal: number; sequence: number; }
export interface OrderBoardItem { nodeId: string; mark: string; nodeType: string; stages: OrderStageRow[]; }
export interface OrderBoard { order: ProductionOrder; stages: { id: string; name: string; sequence: number }[]; items: OrderBoardItem[]; }
export interface CreateOrder { processId: string; customerName?: string; quantity?: number; dueDate?: string; notes?: string; }

// ── Org-wide work-orders dashboard ──
export interface DashboardOrderRow {
  id: string; number: string; customerName: string | null; quantity: number;
  status: OrderStatus; dueDate: string | null; createdAt: string;
  project: { id: string; name: string; number: string | null };
  items: number; itemsDone: number; unitsDone: number; unitsTotal: number; percent: number;
  openNcrs: number; late: boolean;
}
export interface OrdersDashboard {
  kpis: {
    orders: number; planned: number; inProgress: number; completed: number; cancelled: number;
    late: number; openNcrs: number; unitsDone: number; unitsTotal: number; itemsInProduction: number;
  };
  funnel: { name: string; sequence: number; done: number; total: number; percent: number }[];
  orders: DashboardOrderRow[];
}

// ── Per-order audit dashboard (assemblies left, stage trail right) ──
export type ShipStatus = 'in_production' | 'blocked_ncr' | 'ready' | 'allocated' | 'shipped';
export interface AuditStageRow {
  wosId: string; stageId: string; name: string; sequence: number;
  status: string; qtyDone: number; qtyTotal: number;
  startedAt: string | null; completedAt: string | null; statusUpdatedAt: string | null;
  assignedUser: { id: string; name: string } | null;
  station: { id: string; name: string } | null;
  timeSeconds: number; timeEntries: number;
  /** Quality stage that cannot complete while the assembly has open NCRs. */
  gateBlocked: boolean;
}
export interface AuditItem {
  nodeId: string | null; workOrderId: string; workOrderNumber: string;
  mark: string; name: string | null; nodeType: string;
  profile: string | null; materialGrade: string | null; lengthMm: number | null; weightKg: number | null;
  quantity: number; status: 'not_started' | 'in_progress' | 'completed'; percent: number;
  unitsDone: number; unitsTotal: number; openNcrs: number; totalTimeSeconds: number;
  lastActivityAt: string | null;
  shipStatus: ShipStatus; shipReadyQty: number; shippedQty: number; allocatedQty: number;
  stages: AuditStageRow[];
}
export interface OrderAudit {
  order: ProductionOrder & { notes?: string | null };
  project: { id: string; name: string; number: string | null } | null;
  stages: { id: string; name: string; sequence: number }[];
  totals: {
    items: number; itemsDone: number; unitsDone: number; unitsTotal: number; percent: number;
    totalTimeSeconds: number; openNcrs: number; readyToShip: number; shippedItems: number;
  };
  items: AuditItem[];
}
export interface StageEventRow {
  id: string; action: string; fromStatus: string | null; toStatus: string | null;
  fromQty: number | null; toQty: number | null; stageName: string | null;
  source: string; user: string | null; at: string;
  nodeId?: string | null; mark?: string | null;
}
export interface NodeAuditDetail {
  nodeId: string; workOrderId: string; workOrderNumber: string;
  status: string; percentComplete: number; unitsDone: number; unitsTotal: number;
  shipStatus: ShipStatus; shipReadyQty: number; shippedQty: number; allocatedQty: number;
  stages: AuditStageRow[];
  events: StageEventRow[];
  timeEntries: {
    id: string; user: string | null; stageName: string | null; stationName: string | null;
    startTime: string; endTime: string | null; durationSeconds: number | null;
    isRework: boolean; notes: string | null; inputMethod: string | null;
  }[];
  ncrs: { id: string; number: string; title: string; status: string; severity: string; createdAt: string }[];
}
export interface BulkStageUpdate { stageId: string; nodeIds: string[]; qtyDone?: number; status?: string; }
export interface BulkStageResult { requested: number; updated: number; failed: { nodeId: string; mark: string; message: string }[]; }

@Injectable({ providedIn: 'root' })
export class ProjectsService {
  private readonly base = `${environment.apiUrl}/projects`;

  constructor(private http: HttpClient) {}

  list(): Observable<Project[]> {
    return this.http.get<Project[]>(this.base);
  }

  /** Portfolio list: each project plus its production rollup, in one request. */
  summary(): Observable<ProjectSummary[]> {
    return this.http.get<ProjectSummary[]>(`${this.base}/summary`);
  }

  get(id: string): Observable<Project> {
    return this.http.get<Project>(`${this.base}/${id}`);
  }

  create(dto: CreateProject): Observable<Project> {
    return this.http.post<Project>(this.base, dto);
  }

  update(id: string, dto: Partial<CreateProject>): Observable<Project> {
    return this.http.patch<Project>(`${this.base}/${id}`, dto);
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`);
  }

  /** Flat list of a project's assembly nodes, ordered for tree rendering. */
  nodes(id: string): Observable<AssemblyNode[]> {
    return this.http.get<AssemblyNode[]>(`${this.base}/${id}/nodes`);
  }

  /** Upload an IFC file and extract its assembly tree; emits HttpEvents for progress. */
  importIfc(projectId: string, file: File): Observable<HttpEvent<ImportResult>> {
    const fd = new FormData();
    fd.append('file', file);
    const req = new HttpRequest('POST', `${this.base}/${projectId}/import-ifc`, fd, {
      reportProgress: true,
    });
    return this.http.request<ImportResult>(req);
  }

  /** Processes available for work-order routing (tolerant of array or paged responses). */
  listProcesses(): Observable<{ id: string; name: string }[]> {
    return this.http.get<any>(`${environment.apiUrl}/processes`).pipe(
      map((r) => (Array.isArray(r) ? r : (r?.data ?? r?.items ?? []))),
    );
  }

  /** Get-or-create the org's "Standard Fabrication" process (Cut → Fit → Weld → QC → Paint). */
  ensureStandardProcess(): Observable<{ id: string; name: string }> {
    return this.http.post<{ id: string; name: string }>(`${environment.apiUrl}/processes/standard`, {});
  }

  /** Link any queued-conversion GLBs back to the project tree; reports how many are still converting. */
  resolveModels(projectId: string): Observable<{ linked: number; pending: number; failed: number }> {
    return this.http.post<{ linked: number; pending: number; failed: number }>(`${this.base}/${projectId}/resolve-models`, {});
  }

  getProgress(projectId: string): Observable<ProjectProgress> {
    return this.http.get<ProjectProgress>(`${this.base}/${projectId}/progress`);
  }

  /** GLB node (mesh) names to isolate for a node + its descendants. */
  nodeMeshes(projectId: string, nodeId: string): Observable<string[]> {
    return this.http.get<string[]>(`${this.base}/${projectId}/nodes/${nodeId}/meshes`);
  }

  /**
   * URL of an isolated GLB containing ONLY this node's geometry (its part, or
   * every part under an assembly). Public, like the model-file route, so it can
   * be fed straight to the 3D viewer's `modelUrl`. Falls back to the full model
   * server-side when the node has no isolatable geometry.
   */
  nodeGlbUrl(projectId: string, nodeId: string): string {
    return `${this.base}/${projectId}/nodes/${nodeId}/glb`;
  }

  // ── Quality ──
  /** A node's quality inspections (newest first). */
  nodeQuality(projectId: string, nodeId: string): Observable<QualityEntry[]> {
    return this.http.get<QualityEntry[]>(`${this.base}/${projectId}/nodes/${nodeId}/quality`);
  }

  /** Record a quality check on a node (server auto-fails out-of-tolerance measurements). */
  recordQuality(projectId: string, nodeId: string, body: RecordQuality): Observable<QualityEntry> {
    return this.http.post<QualityEntry>(`${this.base}/${projectId}/nodes/${nodeId}/quality`, body);
  }

  /** Raise an NCR pre-filled from a node (links node/project/work-order/quality record). */
  raiseNodeNcr(projectId: string, nodeId: string, body: RaiseNcr): Observable<NcrRef> {
    return this.http.post<NcrRef>(`${this.base}/${projectId}/nodes/${nodeId}/ncr`, body);
  }

  /** Per-node quality status + open-NCR map for the project (badges + ship gate). */
  qualitySummary(projectId: string): Observable<ProjectQualitySummary> {
    return this.http.get<ProjectQualitySummary>(`${this.base}/${projectId}/quality-summary`);
  }

  // ── Production orders (per-customer/run instances; their own process + quantity) ──
  /** Org-wide dashboard: KPIs + stage funnel + every order with progress, in one call. */
  ordersDashboard(): Observable<OrdersDashboard> {
    return this.http.get<OrdersDashboard>(`${environment.apiUrl}/orders/dashboard`);
  }
  listOrders(projectId: string): Observable<ProductionOrder[]> {
    return this.http.get<ProductionOrder[]>(`${this.base}/${projectId}/orders`);
  }
  createOrder(projectId: string, body: CreateOrder): Observable<ProductionOrder> {
    return this.http.post<ProductionOrder>(`${this.base}/${projectId}/orders`, body);
  }
  getOrder(orderId: string): Observable<ProductionOrder> {
    return this.http.get<ProductionOrder>(`${environment.apiUrl}/orders/${orderId}`);
  }
  orderBoard(orderId: string): Observable<OrderBoard> {
    return this.http.get<OrderBoard>(`${environment.apiUrl}/orders/${orderId}/stage-board`);
  }
  /** Count-based progress for one work order: overall % + per-stage funnel. */
  orderProgress(orderId: string): Observable<OrderProgress> {
    return this.http.get<OrderProgress>(`${environment.apiUrl}/orders/${orderId}/progress`);
  }
  /** Update a stage: qtyDone stepper, or status for qty=1 / skip. */
  setOrderStage(orderId: string, wosId: string, body: { qtyDone?: number; status?: string }): Observable<unknown> {
    return this.http.patch(`${environment.apiUrl}/orders/${orderId}/stages/${wosId}`, { ...body, source: 'web' });
  }

  // ── Per-order audit dashboard ──
  /** Everything the audit dashboard needs in one call: assemblies + per-stage trail. */
  orderAudit(orderId: string): Observable<OrderAudit> {
    return this.http.get<OrderAudit>(`${environment.apiUrl}/orders/${orderId}/audit`);
  }
  /** Lazy per-assembly trail: time entries + NCRs. */
  orderNodeAudit(orderId: string, nodeId: string): Observable<NodeAuditDetail> {
    return this.http.get<NodeAuditDetail>(`${environment.apiUrl}/orders/${orderId}/nodes/${nodeId}/audit`);
  }
  /** Batch update: one stage change applied to many assemblies. */
  bulkUpdateOrderStage(orderId: string, body: BulkStageUpdate): Observable<BulkStageResult> {
    return this.http.patch<BulkStageResult>(`${environment.apiUrl}/orders/${orderId}/stages/bulk`, { ...body, source: 'web' });
  }
  /** Order-wide stage-change history (newest first). */
  orderEvents(orderId: string, limit = 100): Observable<StageEventRow[]> {
    return this.http.get<StageEventRow[]>(`${environment.apiUrl}/orders/${orderId}/events?limit=${limit}`);
  }
}
