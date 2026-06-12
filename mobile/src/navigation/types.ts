import { NavigatorScreenParams } from '@react-navigation/native';

// ── Tab Navigator ──
export type TabParamList = {
  Dashboard: undefined;
  Projects: undefined;
  WorkOrders: undefined;
  Timer: undefined;
  Models: undefined;
  More: undefined;
  Profile: undefined;
};

// ── Work Orders Stack (nested in tab) ──
// The hub lists every production work order; OrderBoard/AssemblyDetail are the
// audit dashboard screens (also registered in the Projects stack so both tabs
// reach the same experience). The legacy per-product list/detail stay reachable.
export type WorkOrdersStackParamList = {
  WorkOrderHub: undefined;
  Scan: undefined;
  OrderBoard: { orderId: string; projectId: string; orderNumber: string };
  AssemblyDetail: { orderId: string; projectId: string; nodeId: string; mark: string };
  PartViewer: {
    projectId: string;
    nodeId: string;
    modelId: string;
    title: string;
    profile?: string | null;
    materialGrade?: string | null;
    lengthMm?: number | null;
    weightKg?: number | null;
  };
  WorkOrderList: undefined;
  WorkOrderDetail: { workOrderId: string };
};

// ── Projects Stack (nested in tab) ──
export type ProjectsStackParamList = {
  ProjectList: undefined;
  Scan: undefined;
  ProjectDetail: { projectId: string; name: string };
  OrderBoard: { orderId: string; projectId: string; orderNumber: string };
  AssemblyDetail: { orderId: string; projectId: string; nodeId: string; mark: string };
  PartViewer: {
    projectId: string;
    nodeId: string;
    modelId: string;
    title: string;
    profile?: string | null;
    materialGrade?: string | null;
    lengthMm?: number | null;
    weightKg?: number | null;
  };
};

// ── Time Tracking Stack (nested in tab) ──
export type TimeTrackingStackParamList = {
  TimerMain: undefined;
  History: undefined;
};

// ── Models Stack (nested in tab) ──
export type ModelsStackParamList = {
  ModelList: undefined;
  ModelView: { modelId: string; modelName: string; fileUrl: string };
  ARView: { modelId: string; fileUrl: string; meshNames?: string[]; partLabel?: string };
  VRView: { modelId: string; modelName: string; fileUrl: string };
  QualityView: { modelId: string; modelName: string; fileUrl: string };
};

// ── More Stack (nested in tab) ──
export type MoreStackParamList = {
  MoreMenu: undefined;
  NcrList: undefined;
  NcrCreate: { projectId?: string; nodeId?: string; title?: string; description?: string; severity?: string; qualityDataId?: string } | undefined;
  NcrDetail: { id: string };
  EquipmentList: undefined;
  MaterialList: undefined;
  WorkforceList: undefined;
};

// ── Root Navigator ──
export type RootStackParamList = {
  Login: undefined;
  Main: NavigatorScreenParams<TabParamList>;
};
