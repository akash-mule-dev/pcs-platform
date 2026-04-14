import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import { TabParamList, WorkOrdersStackParamList, TimeTrackingStackParamList, ModelsStackParamList } from './types';
import { useAuth } from '../context/AuthContext';
import { canViewTab, TabKey } from '../config/permissions';

// Screens
import { DashboardScreen } from '../screens/dashboard/DashboardScreen';
import { WorkOrderListScreen } from '../screens/work-orders/WorkOrderListScreen';
import { WorkOrderDetailScreen } from '../screens/work-orders/WorkOrderDetailScreen';
import { TimerScreen } from '../screens/time-tracking/TimerScreen';
import { HistoryScreen } from '../screens/time-tracking/HistoryScreen';
import { ModelListScreen } from '../screens/model-viewer/ModelListScreen';
import { ModelViewScreen } from '../screens/model-viewer/ModelViewScreen';
import { ARViewScreen } from '../screens/model-viewer/ARViewScreen';
import { VRViewScreen } from '../screens/model-viewer/VRViewScreen';
import { QualityViewScreen } from '../screens/model-viewer/QualityViewScreen';
import { ProfileScreen } from '../screens/profile/ProfileScreen';

const Tab = createBottomTabNavigator<TabParamList>();

// ── Work Orders Stack ──
const WOStack = createNativeStackNavigator<WorkOrdersStackParamList>();
function WorkOrdersStack() {
  return (
    <WOStack.Navigator screenOptions={{ headerShown: true, headerTintColor: Colors.primary }}>
      <WOStack.Screen name="WorkOrderList" component={WorkOrderListScreen} options={{ title: 'Work Orders' }} />
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

// ── Tab config ──
const TAB_CONFIG: { name: TabKey; component: React.ComponentType<any>; title: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { name: 'Dashboard', component: DashboardScreen, title: 'Home', icon: 'home' },
  { name: 'WorkOrders', component: WorkOrdersStack, title: 'Orders', icon: 'clipboard' },
  { name: 'Timer', component: TimeTrackingStack, title: 'Timer', icon: 'timer' },
  { name: 'Models', component: ModelsStack, title: '3D/AR', icon: 'cube' },
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
