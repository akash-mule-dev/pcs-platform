import { api } from './api.service';

export interface MProject {
  id: string;
  name: string;
  projectNumber?: string | null;
  clientName?: string | null;
  description?: string | null;
  status: string;
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
export interface MRaiseNcr { title?: string; description?: string; severity?: string; qualityDataId?: string }
export interface MNcrRef { id: string; number: string; title: string; status: string; severity: string }

export const projectsService = {
  list: () => api.getList<MProject>('/projects'),
  getNodes: (projectId: string) => api.getList<MNode>(`/projects/${projectId}/nodes`),
  getNode: (projectId: string, nodeId: string) => api.get<MNode>(`/projects/${projectId}/nodes/${nodeId}`),
  getNodeMeshes: (projectId: string, nodeId: string) => api.get<string[]>(`/projects/${projectId}/nodes/${nodeId}/meshes`),
  getNodeQuality: (projectId: string, nodeId: string) =>
    api.get<MQualityEntry[]>(`/projects/${projectId}/nodes/${nodeId}/quality`),
  recordNodeQuality: (projectId: string, nodeId: string, body: MRecordQuality) =>
    api.post<MQualityEntry>(`/projects/${projectId}/nodes/${nodeId}/quality`, body),
  raiseNodeNcr: (projectId: string, nodeId: string, body: MRaiseNcr) =>
    api.post<MNcrRef>(`/projects/${projectId}/nodes/${nodeId}/ncr`, body),
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

export const ordersService = {
  listByProject: (projectId: string) => api.getList<MOrder>(`/projects/${projectId}/orders`),
  create: (projectId: string, body: MCreateOrder) => api.post<MOrder>(`/projects/${projectId}/orders`, body),
  get: (orderId: string) => api.get<MOrder>(`/orders/${orderId}`),
  board: (orderId: string) => api.get<MOrderBoard>(`/orders/${orderId}/stage-board`),
  nodeStages: (orderId: string, nodeId: string) => api.get<MOrderNodeStages>(`/orders/${orderId}/nodes/${nodeId}/stages`),
  setStage: (orderId: string, workOrderStageId: string, body: { qtyDone?: number; status?: string }) =>
    api.patch<MOrderNodeStage>(`/orders/${orderId}/stages/${workOrderStageId}`, body),
  processes: () => api.getList<MProcess>('/processes'),
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
