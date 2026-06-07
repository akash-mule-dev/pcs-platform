// Ported verbatim from glb-viewer (pure RN, no native deps).
import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import { TrackingMode, TRACKING_MODE_INFO } from './types';

interface TrackingModePickerProps {
  visible: boolean;
  fileName: string | null;
  onSelect: (mode: TrackingMode) => void;
  onCancel: () => void;
}

const MODES: TrackingMode[] = ['world', 'plane', 'image'];

const ACCENT: Record<TrackingMode, string> = {
  world: '#64748b',
  plane: '#3b82f6',
  image: '#10b981',
};

export default function TrackingModePicker({
  visible,
  fileName,
  onSelect,
  onCancel,
}: TrackingModePickerProps) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onCancel}
    >
      <View style={styles.backdrop}>
        <SafeAreaView style={styles.sheet}>
          <View style={styles.handle} />

          <Text style={styles.title}>Choose Tracking Mode</Text>
          {fileName && (
            <Text style={styles.fileName} numberOfLines={1}>
              {fileName}
            </Text>
          )}
          <Text style={styles.subtitle}>
            Pick how the model should stay anchored. Try each to compare accuracy.
          </Text>

          {MODES.map((mode) => {
            const info = TRACKING_MODE_INFO[mode];
            return (
              <TouchableOpacity
                key={mode}
                style={[styles.option, { borderColor: ACCENT[mode] }]}
                onPress={() => onSelect(mode)}
                activeOpacity={0.75}
              >
                <View
                  style={[styles.badge, { backgroundColor: ACCENT[mode] }]}
                >
                  <Text style={styles.badgeText}>{info.accuracy}</Text>
                </View>
                <View style={styles.optionBody}>
                  <Text style={styles.optionTitle}>{info.title}</Text>
                  <Text style={styles.optionSubtitle}>{info.subtitle}</Text>
                </View>
                <Text style={styles.chevron}>{'>'}</Text>
              </TouchableOpacity>
            );
          })}

          <TouchableOpacity style={styles.cancel} onPress={onCancel}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#1a1a2e',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 24,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#334155',
    marginBottom: 16,
  },
  title: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '700',
  },
  fileName: {
    color: '#3b82f6',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
  },
  subtitle: {
    color: '#8892b0',
    fontSize: 13,
    marginTop: 6,
    marginBottom: 16,
    lineHeight: 18,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16213e',
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  badge: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
    marginRight: 12,
    minWidth: 64,
    alignItems: 'center',
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  optionBody: {
    flex: 1,
  },
  optionTitle: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  optionSubtitle: {
    color: '#8892b0',
    fontSize: 12,
    marginTop: 2,
  },
  chevron: {
    color: '#8892b0',
    fontSize: 20,
    marginLeft: 6,
  },
  cancel: {
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 4,
  },
  cancelText: {
    color: '#8892b0',
    fontSize: 15,
    fontWeight: '600',
  },
});
