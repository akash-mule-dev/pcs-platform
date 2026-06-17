import { api } from './api.service';

export interface MProject {
  id: string;
  name: string;
  projectNumber?: string | null;
  clientName?: string | null;
  description?: string | null;
  processId?: string | null;
  createdAt?: string;
}

export interface MNode {
  id: string;
  projectId: string;
  parentId: string | null;
  nodeType: 'group' | 'assembly' | 'subassembly' | 'part';
  name: string;
  mark?: string | null;
  quantity: number;
  profile?: string | null;
  materialGrade?: string | null;
  modelId?: string | null;
  ifcGuid?: string | null;
  meshName?: string | null;
  lengthMm?: number | null;
  weightKg?: number | null;
  properties?: Record<string, unknown> | null;
}

export interface MStage { id: string; name: string; sequence: number; targetTimeSeconds: number }

export interface MQualityEntry {
  id: string;
  meshName: string;
  status: string; // pass | fail | warning
  inspector?: string | null;
  notes?: string | null;
  defectType?: string | null;
  severity?: string | null;
  measurementValue?: number | null;
  measurementUnit?: string | null;
  signoffStatus?: string;
  createdAt?: string;
}
export interface MRecordQuality {
  status: string;
  inspector?: string;
  notes?: string;
  defectType?: string;
  severity?: string;
  measurementValue?: number;
  measurementUnit?: string;
  toleranceMin?: number;
  toleranceMax?: number;
}
export const projectsService = {
  list: () => api.getList<MProject>('/projects'),
  getNodes: (projectId: string) => api.getList<MNode>(`/projects/${projectId}/nodes`),
  getNode: (projectId: string, nodeId: string) => api.get<MNode>(`/projects/${projectId}/nodes/${nodeId}`),
  getNodeMeshes: (projectId: string, nodeId: string) => api.get<string[]>(`/projects/${projectId}/nodes/${nodeId}/meshes`),
  getNodeQuality: (projectId: string, nodeId: string) =>
    api.get<MQualityEntry[]>(`/projects/${projectId}/nodes/${nodeId}/quality`),
  recordNodeQuality: (projectId: string, nodeId: string, body: MRecordQuality) =>
    api.post<MQualityEntry>(`/projects/${projectId}/nodes/${nodeId}/quality`, body),
};

// ── Production orders (per-customer/run instances of a project) ──
export interface MOrder {
  id: string; number: string; projectId: string; customerName?: string | null;
  quantity: number; processId?: string | null; status: string; dueDate?: string | null; createdAt?: string;
}
export interface MOrderStageRow { stageId: string; workOrderStageId: string; status: string; qtyDone: number; qtyTotal: number; sequence: number }
export interface MOrderBoardItem { nodeId: string; mark: string; nodeType: string; stages: MOrderStageRow[] }
export interface MOrderBoard { order: MOrder; stages: MStage[]; items: MOrderBoardItem[] }
export interface MOrderNodeStage { id: string; stageId: string; name: string; sequence: number; status: string; qtyDone: number; qtyTotal: number }
export interface MOrderNodeStages { orderId: string; workOrderId: string | null; nodeStatus: string; percentComplete: number; stages: MOrderNodeStage[] }
export interface MProcess { id: string; name: string }
export interface MCreateOrder { processId: string; customerName?: string; quantity?: number; dueDate?: string; notes?: string }

// ── Audit dashboard (everything about one work order in one call) ──
export type MShipStatus = 'in_production' | 'blocked_ncr' | 'ready' | 'allocated' | 'shipped';
export interface MAuditStageRow {
  wosId: string; stageId: string; name: string; sequence: number;
  status: string; qtyDone: number; qtyTotal: number;
  startedAt: string | null; completedAt: string | null; statusUpdatedAt: string | null;
  assignedUser: { id: string; name: string } | null;
  station: { id: string; name: string } | null;
  timeSeconds: number; timeEntries: number;
  /** Quality stage that cannot complete while the assembly has open NCRs. */
  gateBlocked: boolean;
}
export interface MAuditItem {
  nodeId: string | null; workOrderId: string; workOrderNumber: string;
  mark: string; name: string | null; nodeType: string;
  profile: string | null; materialGrade: string | null; lengthMm: number | null; weightKg: number | null;
  quantity: number; status: 'not_started' | 'in_progress' | 'completed'; percent: number;
  unitsDone: number; unitsTotal: number; openNcrs: number; totalTimeSeconds: number;
  lastActivityAt: string | null;
  shipStatus: MShipStatus; shipReadyQty: number; shippedQty: number; allocatedQty: number;
  stages: MAuditStageRow[];
}
export interface MOrderAudit {
  order: MOrder & { notes?: string | null };
  project: { id: string; name: string; number: string | null } | null;
  stages: { id: string; name: string; sequence: number }[];
  totals: {
    items: number; itemsDone: number; unitsDone: number; unitsTotal: number; percent: number;
    totalTimeSeconds: number; openNcrs: number; readyToShip: number; shippedItems: number;
  };
  items: MAuditItem[];
}
export interface MStageEvent {
  id: string; action: string; fromStatus: string | null; toStatus: string | null;
  fromQty: number | null; toQty: number | null; stageName: string | null;
  source: string; user: string | null; at: string;
  nodeId?: string | null; mark?: string | null;
}
export interface MNodeAudit {
  nodeId: string; workOrderId: string; workOrderNumber: string;
  status: string; percentComplete: number; unitsDone: number; unitsTotal: number;
  shipStatus: MShipStatus; shipReadyQty: number; shippedQty: number; allocatedQty: number;
  stages: MAuditStageRow[];
  events: MStageEvent[];
  timeEntries: {
    id: string; user: string | null; stageName: string | null; stationName: string | null;
    startTime: string; endTime: string | null; durationSeconds: number | null;
    isRework: boolean; notes: string | null; inputMethod: string | null;
  }[];
  ncrs: { id: string; number: string; title: string; status: string; severity: string; createdAt: string }[];
}
export interface MBulkResult { requested: number; updated: number; failed: { nodeId: string; mark: string; message: string }[] }
export interface MDashboardOrder {
  id: string; number: string; customerName: string | null; quantity: number;
  status: string; dueDate: string | null; createdAt: string;
  project: { id: string; name: string; number: string | null };
  items: number; itemsDone: number; unitsDone: number; unitsTotal: number; percent: number;
  openNcrs: number; late: boolean;
}
export interface MOrdersDashboard {
  kpis: { orders: number; planned: number; inProgress: number; completed: number; late: number; openNcrs: number; unitsDone: number; unitsTotal: number };
  orders: MDashboardOrder[];
}

export const ordersService = {
  listByProject: (projectId: string) => api.getList<MOrder>(`/projects/${projectId}/orders`),
  create: (projectId: string, body: MCreateOrder) => api.post<MOrder>(`/projects/${projectId}/orders`, body),
  get: (orderId: string) => api.get<MOrder>(`/orders/${orderId}`),
  board: (orderId: string) => api.get<MOrderBoard>(`/orders/${orderId}/stage-board`),
  nodeStages: (orderId: string, nodeId: string) => api.get<MOrderNodeStages>(`/orders/${orderId}/nodes/${nodeId}/stages`),
  setStage: (orderId: string, workOrderStageId: string, body: { qtyDone?: number; status?: string }) =>
    api.patch<MOrderNodeStage>(`/orders/${orderId}/stages/${workOrderStageId}`, { ...body, source: 'mobile' }),
  processes: () => api.getList<MProcess>('/processes'),
  // Audit dashboard (assemblies + per-stage trail) + batch updates
  dashboard: () => api.get<MOrdersDashboard>('/orders/dashboard'),
  audit: (orderId: string) => api.get<MOrderAudit>(`/orders/${orderId}/audit`),
  nodeAudit: (orderId: string, nodeId: string) => api.get<MNodeAudit>(`/orders/${orderId}/nodes/${nodeId}/audit`),
  events: (orderId: string, limit = 100) => api.getList<MStageEvent>(`/orders/${orderId}/events`, { limit }),
  /** QR scan resolver: which work orders build this assembly. */
  resolveNode: (nodeId: string) =>
    api.get<{
      node: { id: string; mark: string; name: string; nodeType: string; projectId: string };
      project: { id: string; name: string; number: string | null } | null;
      orders: { id: string; number: string; status: string; customerName: string | null; quantity: number; createdAt: string }[];
    }>(`/nodes/${nodeId}/orders`),
  bulkUpdate: (orderId: string, body: { stageId: string; nodeIds: string[]; qtyDone?: number; status?: string }) =>
    api.patch<MBulkResult>(`/orders/${orderId}/stages/bulk`, { ...body, source: 'mobile' }),
};

export const OrderStatusColors: Record<string, string> = {
  planned: '#9ca3af', in_progress: '#f9a825', completed: '#2e7d32', cancelled: '#c62828',
};
export const OrderStatusLabels: Record<string, string> = {
  planned: 'Planned', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled',
};

// ── QC report templates + reports (reports are FILLED on the web portal:
//    the app creates a blank one, then opens /qr/:id?token=<jwt> in the browser) ──
export interface MTemplate { id: string; name: string; type: string }
export interface MQualityReport { id: string; number: string; status: string; templateName?: string }
export const qcReportsService = {
  templates: () => api.getList<MTemplate>('/templates'),
  listByOrder: (productionOrderId: string) =>
    api.getList<MQualityReport>(`/quality-reports?productionOrderId=${encodeURIComponent(productionOrderId)}`),
  create: (body: { templateId: string; productionOrderId: string; assemblyNodeId?: string }) =>
    api.post<MQualityReport>('/quality-reports', body),
};
