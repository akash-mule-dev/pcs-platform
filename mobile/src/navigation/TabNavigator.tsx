import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import { TabParamList, WorkOrdersStackParamList, TimeTrackingStackParamList, MoreStackParamList, ProjectsStackParamList } from './types';
import { useAuth } from '../context/AuthContext';
import { canViewTab, TabKey } from '../config/permissions';

// Screens
import { DashboardScreen } from '../screens/dashboard/DashboardScreen';
import { WorkOrderListScreen } from '../screens/work-orders/WorkOrderListScreen';
import { WorkOrderDetailScreen } from '../screens/work-orders/WorkOrderDetailScreen';
import { WorkOrderHubScreen } from '../screens/work-orders/WorkOrderHubScreen';
import { ScanScreen } from '../screens/work-orders/ScanScreen';
import { TimerScreen } from '../screens/time-tracking/TimerScreen';
import { HistoryScreen } from '../screens/time-tracking/HistoryScreen';
import { ModelViewScreen } from '../screens/model-viewer/ModelViewScreen';
import { ARViewScreen } from '../screens/model-viewer/ARViewScreen';
import { VRViewScreen } from '../screens/model-viewer/VRViewScreen';
import { QualityViewScreen } from '../screens/model-viewer/QualityViewScreen';
import { ProfileScreen } from '../screens/profile/ProfileScreen';
import { MoreMenuScreen } from '../screens/more/MoreMenuScreen';
import { MaterialListScreen } from '../screens/more/MaterialListScreen';
import { NotificationsScreen } from '../screens/more/NotificationsScreen';
import { ProjectListScreen } from '../screens/projects/ProjectListScreen';
import { ProjectDetailScreen } from '../screens/projects/ProjectDetailScreen';
import { ProjectViewerScreen } from '../screens/projects/ProjectViewerScreen';
import { AssemblyDetailScreen } from '../screens/projects/AssemblyDetailScreen';
import { PartViewerScreen } from '../screens/projects/PartViewerScreen';
import { OrderBoardScreen } from '../screens/projects/OrderBoardScreen';
import { QcReportScreen } from '../screens/projects/QcReportScreen';
import { QcReportFillScreen } from '../screens/projects/QcReportFillScreen';

const Tab = createBottomTabNavigator<TabParamList>();

// ── Work Orders Stack ──
// Hub (all production orders) → audit dashboard → assembly → 3D. The legacy
// flat work-order list/detail remain reachable from the hub header.
const WOStack = createNativeStackNavigator<WorkOrdersStackParamList>();
function WorkOrdersStack() {
  return (
    <WOStack.Navigator screenOptions={{ headerShown: true, headerTintColor: Colors.primary }}>
      <WOStack.Screen name="WorkOrderHub" component={WorkOrderHubScreen} options={{ title: 'Work Orders' }} />
      <WOStack.Screen name="Scan" component={ScanScreen} options={{ title: 'Scan label' }} />
      <WOStack.Screen name="OrderBoard" component={OrderBoardScreen} options={{ title: 'Work Order' }} />
      <WOStack.Screen name="AssemblyDetail" component={AssemblyDetailScreen} options={{ title: 'Assembly' }} />
      <WOStack.Screen name="PartViewer" component={PartViewerScreen} options={{ title: '3D Viewer' }} />
      <WOStack.Screen name="WorkOrderList" component={WorkOrderListScreen} options={{ title: 'All Work Orders' }} />
      <WOStack.Screen name="WorkOrderDetail" component={WorkOrderDetailScreen} options={{ title: 'Work Order' }} />
      <WOStack.Screen name="ModelView" component={ModelViewScreen} options={{ title: '3D Model' }} />
      <WOStack.Screen name="ARView" component={ARViewScreen} options={{ title: 'AR View' }} />
      <WOStack.Screen name="VRView" component={VRViewScreen} options={{ title: 'VR View', headerShown: false }} />
      <WOStack.Screen name="QualityView" component={QualityViewScreen} options={{ title: 'Quality Inspection' }} />
      <WOStack.Screen name="QcReportFill" component={QcReportFillScreen} options={{ title: 'QC Report' }} />
      <WOStack.Screen name="QcReport" component={QcReportScreen} options={{ title: 'QC Report' }} />
    </WOStack.Navigator>
  );
}

// ── Time Tracking Stack ──
const TTStack = createNativeStackNavigator<TimeTrackingStackParamList>();
function TimeTrackingStack() {
  return (
    <TTStack.Navigator screenOptions={{ headerShown: true, headerTintColor: Colors.primary }}>
      <TTStack.Screen name="TimerMain" component={TimerScreen} options={{ title: 'Timer' }} />
      <TTStack.Screen name="History" component={HistoryScreen} options={{ title: 'History' }} />
    </TTStack.Navigator>
  );
}

// ── More Stack ──
const MoreStack = createNativeStackNavigator<MoreStackParamList>();
function MoreStackNav() {
  return (
    <MoreStack.Navigator screenOptions={{ headerShown: true, headerTintColor: Colors.primary }}>
      <MoreStack.Screen name="MoreMenu" component={MoreMenuScreen} options={{ title: 'More' }} />
      <MoreStack.Screen name="MaterialList" component={MaterialListScreen} options={{ title: 'Materials' }} />
      <MoreStack.Screen name="Notifications" component={NotificationsScreen} options={{ title: 'Notifications' }} />
    </MoreStack.Navigator>
  );
}

// ── Projects Stack ──
const PStack = createNativeStackNavigator<ProjectsStackParamList>();
function ProjectsStack() {
  return (
    <PStack.Navigator screenOptions={{ headerShown: true, headerTintColor: Colors.primary }}>
      <PStack.Screen name="ProjectList" component={ProjectListScreen} options={{ title: 'Projects' }} />
      <PStack.Screen name="Scan" component={ScanScreen} options={{ title: 'Scan label' }} />
      <PStack.Screen name="ProjectDetail" component={ProjectDetailScreen} options={{ title: 'Project' }} />
      <PStack.Screen name="ProjectViewer" component={ProjectViewerScreen} options={{ title: '3D Viewer' }} />
      <PStack.Screen name="OrderBoard" component={OrderBoardScreen} options={{ title: 'Work Order' }} />
      <PStack.Screen name="AssemblyDetail" component={AssemblyDetailScreen} options={{ title: 'Assembly' }} />
      <PStack.Screen name="PartViewer" component={PartViewerScreen} options={{ title: '3D Viewer' }} />
      <PStack.Screen name="ModelView" component={ModelViewScreen} options={{ title: '3D Model' }} />
      <PStack.Screen name="ARView" component={ARViewScreen} options={{ title: 'AR View' }} />
      <PStack.Screen name="VRView" component={VRViewScreen} options={{ title: 'VR View', headerShown: false }} />
      <PStack.Screen name="QualityView" component={QualityViewScreen} options={{ title: 'Quality Inspection' }} />
      <PStack.Screen name="QcReportFill" component={QcReportFillScreen} options={{ title: 'QC Report' }} />
      <PStack.Screen name="QcReport" component={QcReportScreen} options={{ title: 'QC Report' }} />
    </PStack.Navigator>
  );
}

// ── Tab config ──
// NOTE: there is intentionally no standalone 3D/AR tab — the viewer screens
// (ModelView/ARView/VRView/QualityView) are registered inside the Projects and
// Work Orders stacks and opened in context from assemblies/parts.
const TAB_CONFIG: { name: TabKey; component: React.ComponentType<any>; title: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { name: 'Dashboard', component: DashboardScreen, title: 'Home', icon: 'home' },
  { name: 'Projects', component: ProjectsStack, title: 'Projects', icon: 'folder' },
  { name: 'WorkOrders', component: WorkOrdersStack, title: 'Orders', icon: 'clipboard' },
  { name: 'Timer', component: TimeTrackingStack, title: 'Timer', icon: 'timer' },
  { name: 'More', component: MoreStackNav, title: 'More', icon: 'grid' },
  { name: 'Profile', component: ProfileScreen, title: 'Profile', icon: 'person' },
];

// ── Main Tab Navigator ──
export function TabNavigator() {
  const { user } = useAuth();
  const userRole = user?.role?.name || '';

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.medium,
        tabBarStyle: { paddingBottom: 4, height: 60 },
        tabBarIcon: ({ color, size }) => {
          const tab = TAB_CONFIG.find(t => t.name === route.name);
          return <Ionicons name={tab?.icon || 'home'} size={size} color={color} />;
        },
      })}
    >
      {TAB_CONFIG.filter(tab => canViewTab(tab.name, userRole)).map(tab => (
        <Tab.Screen
          key={tab.name}
          name={tab.name}
          component={tab.component}
          options={{ title: tab.title }}
        />
      ))}
    </Tab.Navigator>
  );
}
