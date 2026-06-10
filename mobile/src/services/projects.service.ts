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
  productionStatus: string;
  currentStageId?: string | null;
  percentComplete: number;
  modelId?: string | null;
  ifcGuid?: string | null;
  meshName?: string | null;
  lengthMm?: number | null;
  weightKg?: number | null;
  properties?: Record<string, unknown> | null;
}

export interface MStage { id: string; name: string; sequence: number; targetTimeSeconds: number }
export interface MNodeStage { id: string | null; stageId: string; name: string; sequence: number; status: string }
export interface MNodeStages { workOrderId: string | null; nodeStatus: string; percentComplete: number; stages: MNodeStage[] }

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

// Kanban / per-stage board: each item carries its INDEPENDENT status at every stage.
export interface MStageBoardStage { stageId: string; workOrderStageId: string; status: string; sequence: number }
export interface MStageBoardItem { nodeId: string; mark: string; nodeType: string; productionStatus: string; percentComplete: number; stages: MStageBoardStage[] }
export interface MStageBoard { stages: MStage[]; items: MStageBoardItem[] }

export const projectsService = {
  list: () => api.getList<MProject>('/projects'),
  getNodes: (projectId: string) => api.getList<MNode>(`/projects/${projectId}/nodes`),
  getNode: (projectId: string, nodeId: string) => api.get<MNode>(`/projects/${projectId}/nodes/${nodeId}`),
  getNodeMeshes: (projectId: string, nodeId: string) => api.get<string[]>(`/projects/${projectId}/nodes/${nodeId}/meshes`),
  getStages: (projectId: string) => api.get<MStage[]>(`/projects/${projectId}/stages`),
  getNodeStages: (projectId: string, nodeId: string) =>
    api.get<MNodeStages>(`/projects/${projectId}/nodes/${nodeId}/stages`),
  setNodeStage: (projectId: string, nodeId: string, workOrderStageId: string, status: string) =>
    api.patch<{ ok: true }>(`/projects/${projectId}/nodes/${nodeId}/stages/${workOrderStageId}`, { status }),
  getNodeQuality: (projectId: string, nodeId: string) =>
    api.get<MQualityEntry[]>(`/projects/${projectId}/nodes/${nodeId}/quality`),
  recordNodeQuality: (projectId: string, nodeId: string, body: MRecordQuality) =>
    api.post<MQualityEntry>(`/projects/${projectId}/nodes/${nodeId}/quality`, body),
  raiseNodeNcr: (projectId: string, nodeId: string, body: MRaiseNcr) =>
    api.post<MNcrRef>(`/projects/${projectId}/nodes/${nodeId}/ncr`, body),
  getStageBoard: (projectId: string) => api.get<MStageBoard>(`/projects/${projectId}/stage-board`),
};

/** Production-status colors/labels for assembly chips. */
export const ProdStatusColors: Record<string, string> = {
  not_started: '#9ca3af',
  in_progress: '#f9a825',
  ready_to_ship: '#2e7d32',
  shipped: '#1565c0',
  on_hold: '#c62828',
};
export const ProdStatusLabels: Record<string, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  ready_to_ship: 'Ready to ship',
  shipped: 'Shipped',
  on_hold: 'On hold',
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
