import React, { useCallback, useLayoutEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Colors } from '../../theme/colors';
import { ProjectsStackParamList } from '../../navigation/types';
import { projectsService, MProject } from '../../services/projects.service';
import { can } from '../../config/permissions';

type Nav = NativeStackNavigationProp<ProjectsStackParamList, 'ProjectList'>;

export function ProjectListScreen() {
  const navigation = useNavigation<Nav>();
  const [projects, setProjects] = useState<MProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const canCreate = can('projects.create');

  const load = useCallback(async (force = false) => {
    try {
      setProjects(await projectsService.list(force));
    } catch {
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Cache-first: instant from local storage if already loaded. useFocusEffect
  // fires on the initial focus too, so it also covers first mount — and picks up
  // a project just created on the New-project screen when we return to the list.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={styles.headRow}>
          <TouchableOpacity
            style={styles.headIcon}
            onPress={() => navigation.navigate('PackageMonitor')}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="pulse-outline" size={22} color={Colors.primary} />
          </TouchableOpacity>
          {canCreate && (
            <TouchableOpacity
              style={styles.headIcon}
              onPress={() => navigation.navigate('ProjectCreate')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="add-circle" size={26} color={Colors.primary} />
            </TouchableOpacity>
          )}
        </View>
      ),
    });
  }, [navigation, canCreate]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load(true); // pull-to-refresh bypasses the cache
    setRefreshing(false);
  };

  const renderItem = ({ item }: { item: MProject }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => navigation.navigate('ProjectDetail', { projectId: item.id, name: item.name })}
    >
      <Ionicons name="folder-outline" size={22} color={Colors.primary} style={styles.icon} />
      <View style={styles.body}>
        <Text style={styles.name}>{item.name}</Text>
        {(item.projectNumber || item.clientName) && (
          <Text style={styles.sub}>
            {item.projectNumber ? `Job ${item.projectNumber}` : ''}
            {item.projectNumber && item.clientName ? ' · ' : ''}
            {item.clientName ?? ''}
          </Text>
        )}
      </View>
      {/* Jump straight into the project's 3D model + status overlay. */}
      <TouchableOpacity
        style={styles.viewBtn}
        onPress={() => navigation.navigate('ProjectViewer', { projectId: item.id, name: item.name })}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Ionicons name="cube-outline" size={16} color={Colors.primary} />
        <Text style={styles.viewBtnTxt}>3D</Text>
      </TouchableOpacity>
      <Ionicons name="chevron-forward" size={20} color={Colors.medium} />
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Loading projects…</Text>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.list}
      data={projects}
      keyExtractor={(i) => i.id}
      renderItem={renderItem}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
      ListEmptyComponent={
        <View style={styles.center}>
          <Ionicons name="folder-open-outline" size={40} color={Colors.medium} />
          <Text style={styles.muted}>No projects yet.</Text>
          {canCreate && (
            <TouchableOpacity style={styles.cta} onPress={() => navigation.navigate('ProjectCreate')}>
              <Ionicons name="add" size={18} color={Colors.white} />
              <Text style={styles.ctaTxt}>Create a project</Text>
            </TouchableOpacity>
          )}
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  list: { padding: 12 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  icon: { marginRight: 12 },
  body: { flex: 1 },
  viewBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: Colors.primary, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 5, marginRight: 8 },
  viewBtnTxt: { color: Colors.primary, fontWeight: '700', fontSize: 12 },
  name: { fontSize: 15, fontWeight: '600', color: Colors.text },
  sub: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 },
  muted: { color: Colors.textSecondary },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  headIcon: { padding: 2 },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.primary, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 11, marginTop: 4 },
  ctaTxt: { color: Colors.white, fontWeight: '700', fontSize: 15 },
});
