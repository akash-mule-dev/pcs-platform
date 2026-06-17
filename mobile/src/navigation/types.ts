import { NavigatorScreenParams } from '@react-navigation/native';

// ── Tab Navigator ──
export type TabParamList = {
  Dashboard: undefined;
  Projects: undefined;
  WorkOrders: undefined;
  Timer: undefined;
  More: undefined;
  Profile: undefined;
};

// ── 3D / AR viewer screens ──
// There is no standalone 3D/AR tab: these screens are registered in BOTH the
// Projects and Work Orders stacks so AR/3D inspection stays reachable in
// context (from an assembly or part) without leaving the current flow.
export type ViewerScreenParams = {
  ModelView: { modelId: string; modelName: string; fileUrl: string };
  ARView: { modelId: string; fileUrl: string; meshNames?: string[]; partLabel?: string };
  VRView: { modelId: string; modelName: string; fileUrl: string };
  QualityView: { modelId: string; modelName: string; fileUrl: string };
};

// ── Work Orders Stack (nested in tab) ──
// The hub lists every production work order; OrderBoard/AssemblyDetail are the
// audit dashboard screens (also registered in the Projects stack so both tabs
// reach the same experience). The legacy flat work-order list/detail stay reachable.
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
  // QC report fill page rendered in-app (WebView) instead of the device browser.
  QcReport: { reportId: string; title?: string };
} & ViewerScreenParams;

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
  // QC report fill page rendered in-app (WebView) instead of the device browser.
  QcReport: { reportId: string; title?: string };
} & ViewerScreenParams;

// ── Time Tracking Stack (nested in tab) ──
export type TimeTrackingStackParamList = {
  TimerMain: undefined;
  History: undefined;
};

// ── More Stack (nested in tab) ──
export type MoreStackParamList = {
  MoreMenu: undefined;
  MaterialList: undefined;
};

// ── Root Navigator ──
export type RootStackParamList = {
  Login: undefined;
  Main: NavigatorScreenParams<TabParamList>;
};
