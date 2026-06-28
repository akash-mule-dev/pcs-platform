import React, { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, TextInput, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Colors } from '../../theme/colors';
import { ProjectsStackParamList } from '../../navigation/types';
import { projectsService, MProject } from '../../services/projects.service';
import { can } from '../../config/permissions';
import { fmtDate } from './monitor-format';

type Nav = NativeStackNavigationProp<ProjectsStackParamList, 'ProjectList'>;
type Sort = 'newest' | 'oldest' | 'updated' | 'name';
const NO_CREATOR = 'Unknown';

const SORTS: { key: Sort; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'newest', label: 'Newest', icon: 'arrow-down' },
  { key: 'oldest', label: 'Oldest', icon: 'arrow-up' },
  { key: 'updated', label: 'Updated', icon: 'create-outline' },
  { key: 'name', label: 'A–Z', icon: 'text' },
];

const creatorOf = (p: MProject) => p.createdByName?.trim() || NO_CREATOR;
const ts = (iso?: string) => (iso ? Date.parse(iso) : 0);
/** True once a project has been edited after creation (so we show a Modified line). */
const edited = (p: MProject) => !!p.updatedAt && !!p.createdAt && ts(p.updatedAt) - ts(p.createdAt) > 2000;

export function ProjectListScreen() {
  const navigation = useNavigation<Nav>();
  const [projects, setProjects] = useState<MProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const canCreate = can('projects.create');

  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('newest');
  const [creator, setCreator] = useState<string | null>(null); // null = all creators

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

  // Distinct creators across the (unfiltered) portfolio — feeds the "Created by" chips.
  const creators = useMemo(() => {
    const set = new Set<string>();
    projects.forEach((p) => set.add(creatorOf(p)));
    return [...set].sort((a, b) =>
      a === NO_CREATOR ? 1 : b === NO_CREATOR ? -1 : a.localeCompare(b),
    );
  }, [projects]);

  // Search + creator filter + sort applied to the list.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = projects.filter((p) => {
      if (creator && creatorOf(p) !== creator) return false;
      if (!q) return true;
      return [p.name, p.projectNumber, p.clientName, p.createdByName].some(
        (v) => v?.toLowerCase().includes(q),
      );
    });
    const sorted = [...list];
    sorted.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'updated') return ts(b.updatedAt) - ts(a.updatedAt);
      return sort === 'oldest' ? ts(a.createdAt) - ts(b.createdAt) : ts(b.createdAt) - ts(a.createdAt);
    });
    return sorted;
  }, [projects, query, creator, sort]);

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
        <View style={styles.metaRow}>
          <Ionicons name="calendar-outline" size={12} color={Colors.textSecondary} />
          <Text style={styles.meta} numberOfLines={1}>
            {fmtDate(item.createdAt)}
            {item.createdByName ? `  ·  ${item.createdByName}` : ''}
          </Text>
        </View>
        {edited(item) && (
          <View style={styles.metaRow}>
            <Ionicons name="create-outline" size={12} color={Colors.textSecondary} />
            <Text style={styles.meta} numberOfLines={1}>
              Updated {fmtDate(item.updatedAt)}
              {item.updatedByName ? `  ·  ${item.updatedByName}` : ''}
            </Text>
          </View>
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

  const hasProjects = projects.length > 0;

  return (
    <View style={styles.container}>
      {hasProjects && (
        <View style={styles.controls}>
          <View style={styles.searchRow}>
            <Ionicons name="search" size={18} color={Colors.textSecondary} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search name, job, client or creator"
              placeholderTextColor={Colors.textSecondary}
              value={query}
              onChangeText={setQuery}
              returnKeyType="search"
              clearButtonMode="while-editing"
            />
            {query.length > 0 && (
              <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close-circle" size={18} color={Colors.medium} />
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.sortRow}>
            <Text style={styles.sortLbl}>Sort</Text>
            {SORTS.map((s) => {
              const on = sort === s.key;
              return (
                <TouchableOpacity key={s.key} style={[styles.chip, on && styles.chipOn]} onPress={() => setSort(s.key)}>
                  <Ionicons name={s.icon} size={12} color={on ? Colors.white : Colors.textSecondary} />
                  <Text style={[styles.chipTxt, on && styles.chipTxtOn]}>{s.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {creators.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.creatorRow}>
              <TouchableOpacity style={[styles.chip, !creator && styles.chipOn]} onPress={() => setCreator(null)}>
                <Ionicons name="people-outline" size={12} color={!creator ? Colors.white : Colors.textSecondary} />
                <Text style={[styles.chipTxt, !creator && styles.chipTxtOn]}>All</Text>
              </TouchableOpacity>
              {creators.map((c) => {
                const on = creator === c;
                return (
                  <TouchableOpacity key={c} style={[styles.chip, on && styles.chipOn]} onPress={() => setCreator(on ? null : c)}>
                    <Ionicons name="person-outline" size={12} color={on ? Colors.white : Colors.textSecondary} />
                    <Text style={[styles.chipTxt, on && styles.chipTxtOn]} numberOfLines={1}>{c}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        </View>
      )}

      <FlatList
        style={styles.list}
        contentContainerStyle={styles.listContent}
        data={visible}
        keyExtractor={(i) => i.id}
        renderItem={renderItem}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        ListEmptyComponent={
          <View style={styles.center}>
            {hasProjects ? (
              <>
                <Ionicons name="filter-outline" size={36} color={Colors.medium} />
                <Text style={styles.muted}>No projects match your search.</Text>
                <TouchableOpacity onPress={() => { setQuery(''); setCreator(null); }}>
                  <Text style={styles.clearLink}>Clear filters</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Ionicons name="folder-open-outline" size={40} color={Colors.medium} />
                <Text style={styles.muted}>No projects yet.</Text>
                {canCreate && (
                  <TouchableOpacity style={styles.cta} onPress={() => navigation.navigate('ProjectCreate')}>
                    <Ionicons name="add" size={18} color={Colors.white} />
                    <Text style={styles.ctaTxt}>Create a project</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  controls: { backgroundColor: Colors.card, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: Colors.border, gap: 10 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.background, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 10, paddingVertical: 8 },
  searchInput: { flex: 1, fontSize: 15, color: Colors.text, padding: 0 },
  sortRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sortLbl: { fontSize: 12, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 },
  creatorRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 12 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: Colors.border, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: Colors.white, maxWidth: 180 },
  chipOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipTxt: { color: Colors.textSecondary, fontWeight: '600', fontSize: 12 },
  chipTxtOn: { color: Colors.white },
  list: { flex: 1 },
  listContent: { padding: 12 },
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
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  meta: { fontSize: 12, color: Colors.textSecondary, flexShrink: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 },
  muted: { color: Colors.textSecondary },
  clearLink: { color: Colors.primary, fontWeight: '700', marginTop: 4 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  headIcon: { padding: 2 },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.primary, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 11, marginTop: 4 },
  ctaTxt: { color: Colors.white, fontWeight: '700', fontSize: 15 },
});
