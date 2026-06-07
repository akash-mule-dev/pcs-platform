import { NavigatorScreenParams } from '@react-navigation/native';

// ── Tab Navigator ──
export type TabParamList = {
  Dashboard: undefined;
  WorkOrders: undefined;
  Timer: undefined;
  Models: undefined;
  More: undefined;
  Profile: undefined;
};

// ── Work Orders Stack (nested in tab) ──
export type WorkOrdersStackParamList = {
  WorkOrderList: undefined;
  WorkOrderDetail: { workOrderId: string };
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
  ARView: { modelId: string; fileUrl: string };
  VRView: { modelId: string; modelName: string; fileUrl: string };
  QualityView: { modelId: string; modelName: string; fileUrl: string };
};

// ── More Stack (nested in tab) ──
export type MoreStackParamList = {
  MoreMenu: undefined;
  NcrList: undefined;
  EquipmentList: undefined;
  MaterialList: undefined;
};

// ── Root Navigator ──
export type RootStackParamList = {
  Login: undefined;
  Main: NavigatorScreenParams<TabParamList>;
};
