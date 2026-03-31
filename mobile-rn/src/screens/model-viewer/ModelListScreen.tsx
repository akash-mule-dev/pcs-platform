import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../theme/colors';
import { Model3D } from '../../types';
import { api } from '../../services/api.service';
import { environment } from '../../config/environment';
import { ModelsStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<ModelsStackParamList, 'ModelList'>;

const FILTERS = ['All', 'Assembly', 'Quality'] as const;
type FilterType = (typeof FILTERS)[number];

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ModelListScreen() {
  const navigation = useNavigation<Nav>();
  const [models, setModels] = useState<Model3D[]>([]);
  const [filter, setFilter] = useState<FilterType>('All');
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadModels = useCallback(async () => {
    try {
      const data = await api.get<Model3D[]>('/models');
      setModels(Array.isArray(data) ? data : []);
    } catch {
      // fail silently
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadModels();
    setRefreshing(false);
  };

  const filtered = models.filter((m) => {
    if (filter === 'All') return true;
    if (filter === 'Assembly') return !!m.assemblyInstructions;
    if (filter === 'Quality') return m.modelType === 'quality';
    return true;
  });

  const getFileUrl = (model: Model3D) =>
    `${environment.apiUrl}/models/${model.id}/file`;

  const showActions = (model: Model3D) => {
    const fileUrl = getFileUrl(model);
    Alert.alert(model.name, 'Choose an action', [
      {
        text: 'View 3D',
        onPress: () =>
          navigation.navigate('ModelView', {
            modelId: model.id,
            modelName: model.name,
            fileUrl,
          }),
      },
      {
        text: 'AR View',
        onPress: () =>
          navigation.navigate('ARView', { modelId: model.id, fileUrl }),
      },
      {
        text: 'Quality Inspection',
        onPress: () =>
          navigation.navigate('QualityView', {
            modelId: model.id,
            modelName: model.name,
            fileUrl,
          }),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const renderItem = ({ item }: { item: Model3D }) => (
    <TouchableOpacity style={styles.card} onPress={() => showActions(item)}>
      <View style={styles.iconWrap}>
        <Ionicons name="cube-outline" size={32} color={Colors.primary} />
      </View>
      <View style={styles.cardInfo}>
        <Text style={styles.cardName}>{item.name}</Text>
        <Text style={styles.cardDetail}>
          {item.modelType?.toUpperCase() || 'GLB'} &middot;{' '}
          {formatFileSize(item.fileSize)}
        </Text>
        {item.description ? (
          <Text style={styles.cardDesc} numberOfLines={1}>
            {item.description}
          </Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={20} color={Colors.medium} />
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <Text style={styles.loadingText}>Loading models...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Filter bar */}
      <View style={styles.filterRow}>
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.filterChip, filter === f && styles.filterChipActive]}
            onPress={() => setFilter(f)}
          >
            <Text
              style={[
                styles.filterText,
                filter === f && styles.filterTextActive,
              ]}
            >
              {f}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
        }
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={styles.emptyText}>No models found</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  list: {
    padding: 16,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  loadingText: {
    color: Colors.textSecondary,
    fontSize: 16,
  },
  emptyText: {
    color: Colors.textSecondary,
    fontSize: 16,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  filterChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  filterText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.text,
  },
  filterTextActive: {
    color: Colors.white,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 10,
    backgroundColor: `${Colors.primary}15`,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  cardInfo: {
    flex: 1,
  },
  cardName: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
  },
  cardDetail: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  cardDesc: {
    fontSize: 12,
    color: Colors.medium,
    marginTop: 2,
  },
});
