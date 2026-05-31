import React, { useEffect, useState } from 'react';
import { Text, StyleSheet, Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { offlineService } from '../services/offline.service';

/**
 * Global connectivity banner. Subscribes to the offline service and slides a
 * banner in from the top whenever the device loses its connection, so operators
 * always know when actions are being queued instead of sent.
 */
export function OfflineBanner() {
  const insets = useSafeAreaInsets();
  const [online, setOnline] = useState(offlineService.isOnline);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    const unsub = offlineService.subscribeOnline((isOnline) => {
      setOnline(isOnline);
      offlineService.getPendingCount().then(setPending).catch(() => setPending(0));
    });
    offlineService.getPendingCount().then(setPending).catch(() => setPending(0));
    return unsub;
  }, []);

  if (online) return null;

  return (
    <Animated.View style={[styles.banner, { paddingTop: insets.top + 8 }]}>
      <Text style={styles.text}>
        You are offline{pending > 0 ? ` — ${pending} action${pending > 1 ? 's' : ''} queued` : ''}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: '#b71c1c',
    paddingBottom: 8,
    paddingHorizontal: 16,
    zIndex: 1000,
  },
  text: { color: '#fff', fontSize: 13, fontWeight: '600', textAlign: 'center' },
});
