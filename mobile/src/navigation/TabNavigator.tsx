import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import { TabParamList, WorkOrdersStackParamList, TimeTrackingStackParamList, ModelsStackParamList, MoreStackParamList, ProjectsStackParamList } from './types';
import { useAuth } from '../context/AuthContext';
import { canViewTab, TabKey } from '../config/permissions';

// Screens
import { DashboardScreen } from '../screens/dashboard/DashboardScreen';
import { WorkOrderListScreen } from '../screens/work-orders/WorkOrderListScreen';
import { WorkOrderDetailScreen } from '../screens/work-orders/WorkOrderDetailScreen';
import { WorkOrderHubScreen } from '../screens/work-orders/WorkOrderHubScreen';
import { TimerScreen } from '../screens/time-tracking/TimerScreen';
import { HistoryScreen } from '../screens/time-tracking/HistoryScreen';
import { ModelListScreen } from '../screens/model-viewer/ModelListScreen';
import { ModelViewScreen } from '../screens/model-viewer/ModelViewScreen';
import { ARViewScreen } from '../screens/model-viewer/ARViewScreen';
import { VRViewScreen } from '../screens/model-viewer/VRViewScreen';
import { QualityViewScreen } from '../screens/model-viewer/QualityViewScreen';
import { ProfileScreen } from '../screens/profile/ProfileScreen';
import { MoreMenuScreen } from '../screens/more/MoreMenuScreen';
import { NcrListScreen } from '../screens/more/NcrListScreen';
import { EquipmentListScreen } from '../screens/more/EquipmentListScreen';
import { MaterialListScreen } from '../screens/more/MaterialListScreen';
import { NcrCreateScreen } from '../screens/more/NcrCreateScreen';
import { NcrDetailScreen } from '../screens/more/NcrDetailScreen';
import { WorkforceListScreen } from '../screens/more/WorkforceListScreen';
import { ProjectListScreen } from '../screens/projects/ProjectListScreen';
import { ProjectDetailScreen } from '../screens/projects/ProjectDetailScreen';
import { AssemblyDetailScreen } from '../screens/projects/AssemblyDetailScreen';
import { PartViewerScreen } from '../screens/projects/PartViewerScreen';
import { OrderBoardScreen } from '../screens/projects/OrderBoardScreen';

const Tab = createBottomTabNavigator<TabParamList>();

// ── Work Orders Stack ──
// Hub (all production orders) → audit dashboard → assembly → 3D. The legacy
// per-product list/detail remain reachable from the hub header.
const WOStack = createNativeStackNavigator<WorkOrdersStackParamList>();
function WorkOrdersStack() {
  return (
    <WOStack.Navigator screenOptions={{ headerShown: true, headerTintColor: Colors.primary }}>
      <WOStack.Screen name="WorkOrderHub" component={WorkOrderHubScreen} options={{ title: 'Work Orders' }} />
      <WOStack.Screen name="OrderBoard" component={OrderBoardScreen} options={{ title: 'Work Order' }} />
      <WOStack.Screen name="AssemblyDetail" component={AssemblyDetailScreen} options={{ title: 'Assembly' }} />
      <WOStack.Screen name="PartViewer" component={PartViewerScreen} options={{ title: '3D Viewer' }} />
      <WOStack.Screen name="WorkOrderList" component={WorkOrderListScreen} options={{ title: 'Product Orders' }} />
      <WOStack.Screen name="WorkOrderDetail" component={WorkOrderDetailScreen} options={{ title: 'Work Order' }} />
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

// ── Models Stack ──
const MStack = createNativeStackNavigator<ModelsStackParamList>();
function ModelsStack() {
  return (
    <MStack.Navigator screenOptions={{ headerShown: true, headerTintColor: Colors.primary }}>
      <MStack.Screen name="ModelList" component={ModelListScreen} options={{ title: '3D Models' }} />
      <MStack.Screen name="ModelView" component={ModelViewScreen} options={{ title: '3D Viewer' }} />
      <MStack.Screen name="ARView" component={ARViewScreen} options={{ title: 'AR View' }} />
      <MStack.Screen name="VRView" component={VRViewScreen} options={{ title: 'VR View', headerShown: false }} />
      <MStack.Screen name="QualityView" component={QualityViewScreen} options={{ title: 'Quality Inspection' }} />
    </MStack.Navigator>
  );
}

// ── More Stack ──
const MoreStack = createNativeStackNavigator<MoreStackParamList>();
function MoreStackNav() {
  return (
    <MoreStack.Navigator screenOptions={{ headerShown: true, headerTintColor: Colors.primary }}>
      <MoreStack.Screen name="MoreMenu" component={MoreMenuScreen} options={{ title: 'More' }} />
      <MoreStack.Screen name="NcrList" component={NcrListScreen} options={{ title: 'Quality / NCRs' }} />
      <MoreStack.Screen name="NcrCreate" component={NcrCreateScreen} options={{ title: 'Raise NCR' }} />
      <MoreStack.Screen name="NcrDetail" component={NcrDetailScreen} options={{ title: 'NCR' }} />
      <MoreStack.Screen name="EquipmentList" component={EquipmentListScreen} options={{ title: 'Equipment' }} />
      <MoreStack.Screen name="MaterialList" component={MaterialListScreen} options={{ title: 'Materials' }} />
      <MoreStack.Screen name="WorkforceList" component={WorkforceListScreen} options={{ title: 'Workforce' }} />
    </MoreStack.Navigator>
  );
}

// ── Projects Stack ──
const PStack = createNativeStackNavigator<ProjectsStackParamList>();
function ProjectsStack() {
  return (
    <PStack.Navigator screenOptions={{ headerShown: true, headerTintColor: Colors.primary }}>
      <PStack.Screen name="ProjectList" component={ProjectListScreen} options={{ title: 'Projects' }} />
      <PStack.Screen name="ProjectDetail" component={ProjectDetailScreen} options={{ title: 'Project' }} />
      <PStack.Screen name="OrderBoard" component={OrderBoardScreen} options={{ title: 'Work Order' }} />
      <PStack.Screen name="AssemblyDetail" component={AssemblyDetailScreen} options={{ title: 'Assembly' }} />
      <PStack.Screen name="PartViewer" component={PartViewerScreen} options={{ title: '3D Viewer' }} />
    </PStack.Navigator>
  );
}

// ── Tab config ──
const TAB_CONFIG: { name: TabKey; component: React.ComponentType<any>; title: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { name: 'Dashboard', component: DashboardScreen, title: 'Home', icon: 'home' },
  { name: 'Projects', component: ProjectsStack, title: 'Projects', icon: 'folder' },
  { name: 'WorkOrders', component: WorkOrdersStack, title: 'Orders', icon: 'clipboard' },
  { name: 'Timer', component: TimeTrackingStack, title: 'Timer', icon: 'timer' },
  { name: 'Models', component: ModelsStack, title: '3D/AR', icon: 'cube' },
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
