// ── Auth ──
export interface User {
  id: string;
  email: string | null;
  mobileNo: string;
  firstName: string;
  lastName: string;
  employeeId: string;
  role: { id: string; name: string };
  isActive: boolean;
}

export interface LoginResponse {
  accessToken: string;
  user: User;
}

// ── Work Orders ──
export interface WorkOrderStage {
  id: string;
  workOrderId: string;
  stageId: string;
  stage?: {
    id: string;
    name: string;
    sequence: number;
    targetTimeSeconds: number;
    description: string;
  };
  assignedUserId: string | null;
  stationId: string | null;
  status: 'pending' | 'in_progress' | 'completed' | 'skipped';
  startedAt: string | null;
  completedAt: string | null;
  actualTimeSeconds: number | null;
}

export interface WorkOrder {
  id: string;
  orderNumber: string;
  product?: { id: string; name: string };
  process?: { id: string; name: string };
  line?: { id: string; name: string } | null;
  quantity: number;
  completedQuantity: number;
  status: 'draft' | 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  dueDate: string | null;
  startedAt: string | null;
  completedAt: string | null;
  stages?: WorkOrderStage[];
}

// ── Time Tracking ──
export interface TimeEntry {
  id: string;
  userId: string;
  user?: { id: string; firstName: string; lastName: string };
  workOrderStageId: string;
  workOrderStage?: {
    id: string;
    status: string;
    workOrder?: { id: string; orderNumber: string };
    stage?: {
      id: string;
      name: string;
      targetTimeSeconds: number;
      sequence: number;
    };
  };
  stationId: string | null;
  startTime: string;
  endTime: string | null;
  durationSeconds: number | null;
  breakSeconds: number;
  idleSeconds: number;
  inputMethod: string;
  isRework: boolean;
  notes: string | null;
  createdAt: string;
}

// ── Offline ──
export interface PendingAction {
  id: string;
  type: 'clock-in' | 'clock-out';
  payload: any;
  timestamp: number;
}

// ── 3D Models ──
export interface Model3D {
  id: string;
  name: string;
  description: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  modelType: string;
  assemblyInstructions: string | null;
  productId: string | null;
  product?: { id: string; name: string };
  createdAt: string;
}

export interface LoadProgress {
  loaded: number;
  total: number;
  percent: number;
}

// ── Quality ──
export interface QualityEntry {
  id: string;
  modelId: string;
  meshName: string;
  status: 'pass' | 'fail' | 'warning';
  inspectorId: string;
  inspector?: { id: string; firstName: string; lastName: string };
  defectType: string | null;
  severity: 'low' | 'medium' | 'high' | 'critical' | null;
  measurement: number | null;
  toleranceMin: number | null;
  toleranceMax: number | null;
  notes: string | null;
  createdAt: string;
}

// ── Dashboard ──
export interface DashboardSummary {
  totalWorkOrders: number;
  activeOperators: number;
  completedStages: number;
  averageEfficiency: number;
  statusDistribution: Record<string, number>;
}
