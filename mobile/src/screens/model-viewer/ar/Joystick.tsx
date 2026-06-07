// Ported verbatim from glb-viewer (pure RN PanResponder, no native deps).
import React, { useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  PanResponder,
  Animated,
  GestureResponderEvent,
} from 'react-native';

interface JoystickProps {
  size?: number;
  // Fires on each touch position change with the current normalized
  // deflection {x, y} ∈ [-1, 1]. Fires once with {0, 0} on release.
  onChange: (vector: { x: number; y: number }) => void;
  disabled?: boolean;
}

export default function Joystick({
  size = 140,
  onChange,
  disabled = false,
}: JoystickProps) {
  const radius = size / 2;
  const thumbSize = size * 0.36;
  const thumbRadius = thumbSize / 2;
  const maxDistance = radius - thumbRadius - 4;

  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const applyTouch = (locationX: number, locationY: number) => {
    let dx = locationX - radius;
    let dy = locationY - radius;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance > maxDistance) {
      const s = maxDistance / distance;
      dx *= s;
      dy *= s;
    }
    pan.setValue({ x: dx, y: dy });
    onChangeRef.current({ x: dx / maxDistance, y: dy / maxDistance });
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponderCapture: () => !disabled,
        onMoveShouldSetPanResponderCapture: () => !disabled,
        onStartShouldSetPanResponder: () => !disabled,
        onMoveShouldSetPanResponder: () => !disabled,
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
        onPanResponderGrant: (e: GestureResponderEvent) => {
          applyTouch(e.nativeEvent.locationX, e.nativeEvent.locationY);
        },
        onPanResponderMove: (e: GestureResponderEvent) => {
          applyTouch(e.nativeEvent.locationX, e.nativeEvent.locationY);
        },
        onPanResponderRelease: () => {
          Animated.spring(pan, {
            toValue: { x: 0, y: 0 },
            useNativeDriver: false,
            friction: 6,
            tension: 80,
          }).start();
          onChangeRef.current({ x: 0, y: 0 });
        },
        onPanResponderTerminate: () => {
          pan.setValue({ x: 0, y: 0 });
          onChangeRef.current({ x: 0, y: 0 });
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [disabled, size]
  );

  return (
    <View
      {...panResponder.panHandlers}
      style={[
        styles.pad,
        { width: size, height: size, borderRadius: radius },
        disabled && styles.padDisabled,
      ]}
    >
      <Text style={[styles.label, styles.labelUp]}>UP</Text>
      <Text style={[styles.label, styles.labelDown]}>DOWN</Text>
      <Text style={[styles.label, styles.labelLeft]}>LEFT</Text>
      <Text style={[styles.label, styles.labelRight]}>RIGHT</Text>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.thumb,
          {
            width: thumbSize,
            height: thumbSize,
            borderRadius: thumbRadius,
            transform: pan.getTranslateTransform(),
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  pad: {
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.15)',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 4,
  },
  padDisabled: {
    opacity: 0.4,
  },
  thumb: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.35)',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 3,
    elevation: 3,
  },
  label: {
    position: 'absolute',
    color: '#0f172a',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
  labelUp: { top: -18 },
  labelDown: { bottom: -18 },
  labelLeft: { left: -34 },
  labelRight: { right: -38 },
});
