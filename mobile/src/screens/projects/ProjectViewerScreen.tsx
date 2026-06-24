import React, { useLayoutEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { Colors } from '../../theme/colors';
import { ProjectsStackParamList } from '../../navigation/types';
import { ProjectAssemblies } from './ProjectAssemblies';

type Rt = RouteProp<ProjectsStackParamList, 'ProjectViewer'>;

/**
 * Project-wide 3D viewer — the assembly tree synced with the embedded 3D model
 * and a per-order production-status overlay. Reached directly from the project
 * list (the "3D" button) and the project header, so a project's geometry is one
 * tap away without first drilling into a work order.
 */
export function ProjectViewerScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<Rt>();
  const { projectId, name } = route.params;

  useLayoutEffect(() => {
    navigation.setOptions({ title: name ? `${name} · 3D` : '3D Viewer' });
  }, [navigation, name]);

  return (
    <View style={styles.container}>
      <ProjectAssemblies projectId={projectId} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
});
