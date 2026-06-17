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
  projectNumber?: string | null;
  clientName?: string | null;
  description?: string | null;
}

/** Response of POST import-ifc: the upload is stored; processing continues async. */
export interface ImportStarted {
  importFileId: string;
  originalName: string;
  status: ImportStatus;
  stage: ImportStage;
  progress: number;
}

export type ImportStatus = 'uploaded' | 'extracting' | 'converting' | 'completed' | 'failed';
export type ImportStage = 'uploaded' | 'queued' | 'extracting' | 'persisting' | 'converting' | 'completed' | 'failed';

/** One uploaded package + its live pipeline position (the monitoring row). */
export interface ImportFileRow {
  id: string;
  projectId: string;
  originalName: string;
  format: string;
  size: number | null;
  status: ImportStatus;
  stage: ImportStage;
  progress: number;
  nodeCount: number;
  modelId: string | null;
  conversionJobId: string | null;
  error: string | null;
  /** Durable storage pointer — present ⇒ the original package can be re-downloaded. */
  storageKey?: string | null;
  createdByName: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  createdAt: string;
  updatedAt: string;
}

/** One line of an import's pipeline history. */
export interface ImportEventRow {
  id: string;
  stage: ImportStage;
  status: ImportStatus;
  progress: number;
  message: string;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

export interface ImportDetail {
  file: ImportFileRow;
  events: ImportEventRow[];
  conversion: { id: string; status: string; progress: number; error: string | null; durationMs: number | null; trianglesAfter: number | null; outputSize: number | null } | null;
}

/** One live package on the org-wide monitor. */
export interface MonitorActiveRow extends ImportFileRow {
  projectName: string | null;
  /** Active packages of this org uploaded before this one ("N ahead of yours"). */
  ahead: number;
}

export interface ImportsMonitor {
  active: MonitorActiveRow[];
  kpis: {
    inProgress: number;
    queued: number;
    processing: number;
    completedToday: number;
    failedToday: number;
    completedTotal: number;
    failedTotal: number;
    totalPackages: number;
  };
}

export type HistoryRow = ImportFileRow & { projectName: string | null };
export interface ImportsHistoryPage { rows: HistoryRow[]; total: number; }

// ── Revision diff & impact ──
export interface RevisionDelta { field: string; from: unknown; to: unknown; }
export interface RevisionEntry { guid: string; mark: string | null; name: string; type: string; profile?: string | null; deltas?: RevisionDelta[]; }
export interface RevisionDiffData {
  initial: boolean;
  counts: { incoming: number; added: number; changed: number; missing: number; unchanged: number };
  added: RevisionEntry[];
  changed: RevisionEntry[];
  missing: RevisionEntry[];
  capped: boolean;
}
export interface RevisionImpactRow {
  kind: 'changed' | 'missing';
  guid: string; mark: string | null; name: string;
  deltas: RevisionDelta[] | null;
  severity: 'critical' | 'high' | 'medium' | 'none';
  shippedQty: number;
  workOrders: { orderNumber: string; productionOrder: string | null; status: string; unitsDone: number; unitsTotal: number }[];
}
export interface ImportRevision {
  diff: RevisionDiffData | null;
  impact: { summary: { pieces: number; critical: number; high: number; medium: number; none: number }; rows: RevisionImpactRow[] } | null;
}

// ── Earned value ──
export interface EarnedValueWeek {
  weekStart: string; producedKg: number; producedPieces: number; shippedKg: number; shippedPieces: number;
  cumulativeProducedKg: number; cumulativeShippedKg: number;
}
export interface EarnedValue {
  kpis: { designKg: number; scopeKg: number; scopePieces: number; producedKg: number; shippedKg: number; producedPct: number; shippedPct: number };
  series: EarnedValueWeek[];
}

// ── Node documents ──
export interface NodeDocument {
  id: string; nodeId: string | null; originalName: string; contentType: string; size: number;
  label: string | null; createdByName: string | null; createdAt: string;
}

/** One document of a package / project (snake_case raw row + matched mark). */
export interface PackageDocumentRow {
  id: string; node_id: string | null; import_file_id: string | null;
  original_name: string; content_type: string; size: number;
  label: string | null; created_by_name: string | null; created_at: string;
  node_mark: string | null; node_name: string | null;
}

/** File formats the import endpoint accepts (keep in sync with the backend). */
export const IMPORT_ACCEPT = '.ifc,.zip,.step,.stp,.iges,.igs,.glb,.gltf,.obj,.stl,.dae,.fbx,.3ds,.ply';
export const IMPORT_FORMATS_HINT = 'IFC / ZIP package (model + PDF drawings) / STEP, IGES / GLB, OBJ, STL';

// ── Traceability ──
export interface LotOption {
  id: string; lot_number: string; heat_number: string | null; supplier: string | null;
  cert_reference: string | null; remaining_quantity: number; material_code: string | null; material_name: string | null;
}
export interface NodeLotRow {
  id: string; quantity: number; note: string | null; created_by_name: string | null; created_at: string;
  lot_id: string; lot_number: string; heat_number: string | null; supplier: string | null; cert_reference: string | null;
  material_code: string | null; material_name: string | null;
}
export interface ShipmentTraceability {
  shipment: { id: string; shipment_number: string; status: string };
  items: { itemId: string; mark: string | null; name: string; quantity: number; covered: boolean;
    lots: { lotNumber: string; heatNumber: string | null; supplier: string | null; certReference: string | null; material: string | null }[] }[];
  summary: { items: number; covered: number; missing: number };
}

/** Live `import:progress` websocket payload (room: project:<id>). */
export interface ImportProgressEvent {
  importFileId: string;
  projectId: string;
  status: ImportStatus;
  stage: ImportStage;
  progress: number;
  originalName: string;
  nodeCount: number;
  modelId: string | null;
  conversionJobId: string | null;
  error: string | null;
  message: string | null;
  at: string;
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
  /** Quality stage held by the gate (open NCRs, unsigned failures, missing inspection). */
  gateBlocked: boolean;
  /** Human-readable reason the gate holds. */
  gateReason?: string | null;
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

  /**
   * Upload an IFC. Emits HttpEvents for live upload %; the response arrives as
   * soon as the file is stored — extraction/conversion continue asynchronously
   * (track them via imports()/importDetail() + the import:progress socket event).
   */
  importIfc(projectId: string, file: File): Observable<HttpEvent<ImportStarted>> {
    const fd = new FormData();
    fd.append('file', file);
    const req = new HttpRequest('POST', `${this.base}/${projectId}/import-ifc`, fd, {
      reportProgress: true,
    });
    return this.http.request<ImportStarted>(req);
  }

  // ── Import pipeline monitoring ──
  /** Every uploaded package with its live stage/progress + final status (newest first). */
  imports(projectId: string): Observable<ImportFileRow[]> {
    return this.http.get<ImportFileRow[]>(`${this.base}/${projectId}/imports`);
  }

  /** One import + its full pipeline event timeline. */
  importDetail(projectId: string, importId: string): Observable<ImportDetail> {
    return this.http.get<ImportDetail>(`${this.base}/${projectId}/imports/${importId}`);
  }

  /** Retry a failed import (conversion-only, or the full pipeline from the stored source). */
  retryImport(projectId: string, importId: string): Observable<ImportStarted> {
    return this.http.post<ImportStarted>(`${this.base}/${projectId}/imports/${importId}/retry`, {});
  }

  /** Re-download the ORIGINAL uploaded package/source file of an import (authed blob). */
  importSourceBlob(projectId: string, importId: string): Observable<Blob> {
    return this.http.get(`${this.base}/${projectId}/imports/${importId}/source`, { responseType: 'blob' });
  }

  /** Revision diff of an import (added/changed/missing) + production impact per piece. */
  importRevision(projectId: string, importId: string): Observable<ImportRevision> {
    return this.http.get<ImportRevision>(`${this.base}/${projectId}/imports/${importId}/revision`);
  }

  /** Progress billing: weekly produced + shipped tonnage with cumulative earned %. */
  earnedValue(projectId: string, orderId?: string): Observable<EarnedValue> {
    const qs = orderId ? `?orderId=${orderId}` : '';
    return this.http.get<EarnedValue>(`${this.base}/${projectId}/earned-value${qs}`);
  }

  // ── Node documents (shop drawings) ──
  nodeDocuments(projectId: string, nodeId: string): Observable<NodeDocument[]> {
    return this.http.get<NodeDocument[]>(`${this.base}/${projectId}/nodes/${nodeId}/documents`);
  }
  uploadNodeDocument(projectId: string, nodeId: string, file: File, label?: string): Observable<NodeDocument> {
    const fd = new FormData();
    fd.append('file', file);
    if (label) fd.append('label', label);
    return this.http.post<NodeDocument>(`${this.base}/${projectId}/nodes/${nodeId}/documents`, fd);
  }
  nodeDocumentBlob(projectId: string, docId: string): Observable<Blob> {
    return this.http.get(`${this.base}/${projectId}/documents/${docId}/file`, { responseType: 'blob' });
  }
  /** All project documents, or one package's contents (importId), with matched marks. */
  projectDocuments(projectId: string, importId?: string): Observable<PackageDocumentRow[]> {
    const qs = importId ? `?importId=${importId}` : '';
    return this.http.get<PackageDocumentRow[]>(`${this.base}/${projectId}/documents${qs}`);
  }
  deleteNodeDocument(projectId: string, docId: string): Observable<{ ok: true }> {
    return this.http.delete<{ ok: true }>(`${this.base}/${projectId}/documents/${docId}`);
  }

  // ── Heat-number traceability ──
  availableLots(projectId: string, q?: string): Observable<LotOption[]> {
    const qs = q ? `?q=${encodeURIComponent(q)}` : '';
    return this.http.get<LotOption[]>(`${this.base}/${projectId}/lots${qs}`);
  }
  nodeLots(projectId: string, nodeId: string): Observable<NodeLotRow[]> {
    return this.http.get<NodeLotRow[]>(`${this.base}/${projectId}/nodes/${nodeId}/lots`);
  }
  assignLot(projectId: string, nodeId: string, body: { materialLotId: string; quantity?: number; note?: string }): Observable<unknown> {
    return this.http.post(`${this.base}/${projectId}/nodes/${nodeId}/lots`, body);
  }
  unassignLot(projectId: string, assignmentId: string): Observable<{ ok: true }> {
    return this.http.delete<{ ok: true }>(`${this.base}/${projectId}/lot-assignments/${assignmentId}`);
  }
  shipmentTraceability(projectId: string, shipmentId: string): Observable<ShipmentTraceability> {
    return this.http.get<ShipmentTraceability>(`${this.base}/${projectId}/shipments/${shipmentId}/traceability`);
  }

  /** Org-wide live pipeline: active packages with queue position + KPI counts. */
  importsMonitor(): Observable<ImportsMonitor> {
    return this.http.get<ImportsMonitor>(`${environment.apiUrl}/imports/monitor`);
  }

  /** Org-wide upload history (filter by projects, sort by upload time, paged). */
  importsHistory(opts: { projectIds?: string[]; sort?: 'asc' | 'desc'; limit?: number; offset?: number } = {}): Observable<ImportsHistoryPage> {
    const p = new URLSearchParams();
    if (opts.projectIds?.length) p.set('projects', opts.projectIds.join(','));
    if (opts.sort) p.set('sort', opts.sort);
    if (opts.limit != null) p.set('limit', String(opts.limit));
    if (opts.offset != null) p.set('offset', String(opts.offset));
    const qs = p.toString();
    return this.http.get<ImportsHistoryPage>(`${environment.apiUrl}/imports/history${qs ? '?' + qs : ''}`);
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
