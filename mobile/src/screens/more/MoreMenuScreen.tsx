import React from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../theme/colors';
import { MoreStackParamList } from '../../navigation/types';
import { useAuth } from '../../context/AuthContext';
import { canView } from '../../config/permissions';

type Nav = NativeStackNavigationProp<MoreStackParamList, 'MoreMenu'>;

interface MenuItem {
  key: keyof MoreStackParamList;
  label: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  feature: string;
}

// Equipment and Workforce were intentionally dropped from mobile — they were
// read-only mirrors of web admin pages with no shop-floor action on a phone.
const ITEMS: MenuItem[] = [
  { key: 'MaterialList', label: 'Materials', subtitle: 'Inventory & parts master', icon: 'layers', feature: 'materials' },
];

// Always available to every signed-in user (no feature gate).
const ALWAYS: MenuItem[] = [
  { key: 'Notifications', label: 'Notifications', subtitle: 'Quality alerts, NCRs & overdue items', icon: 'notifications', feature: '' },
  { key: 'Storage', label: 'Offline 3D models', subtitle: 'Cached models for fast, offline viewing', icon: 'cube', feature: '' },
];

export function MoreMenuScreen() {
  const navigation = useNavigation<Nav>();
  const { user } = useAuth();
  const role = user?.role?.name || '';
  const items = [...ALWAYS, ...ITEMS.filter((i) => canView(i.feature, role))];

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.list}
      data={items}
      keyExtractor={(i) => i.key}
      renderItem={({ item }) => (
        <TouchableOpacity style={styles.row} onPress={() => navigation.navigate(item.key as never)}>
          <View style={styles.iconWrap}>
            <Ionicons name={item.icon} size={22} color={Colors.primary} />
          </View>
          <View style={styles.rowText}>
            <Text style={styles.label}>{item.label}</Text>
            <Text style={styles.subtitle}>{item.subtitle}</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={Colors.medium} />
        </TouchableOpacity>
      )}
      ListEmptyComponent={
        <View style={styles.center}>
          <Text style={styles.subtitle}>No additional modules are available for your role.</Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  list: { padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: 10,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#e8f0fe',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  rowText: { flex: 1 },
  label: { fontSize: 16, fontWeight: '700', color: Colors.text },
  subtitle: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
});
