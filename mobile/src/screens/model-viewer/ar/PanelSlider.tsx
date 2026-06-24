// A pure-RN slider (no native Slider module), shared by the Edges (line weight)
// and Measure (label size) panels.
//
// The thumb position lives in LOCAL state (`pos`) so dragging re-renders only
// this component — not the whole panel — which keeps the drag smooth. The parent
// is told the value only on RELEASE via `onComplete` (so an expensive commit,
// e.g. a wireframe rebuild, happens once, not per move). While not dragging,
// `pos` tracks the `value` prop (so preset taps / external changes move it).
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, PanResponder, LayoutChangeEvent } from 'react-native';

const THUMB = 22;

interface PanelSliderProps {
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  /** Track width in px (presets above usually set the visual width to match). */
  width: number;
  onComplete: (v: number) => void;
  /** Render the live readout label under the track (e.g. (v) => `${v.toFixed(2)}×`). */
  formatValue?: (v: number) => string;
}

export default function PanelSlider({
  value,
  min,
  max,
  disabled = false,
  width,
  onComplete,
  formatValue,
}: PanelSliderProps) {
  const [trackW, setTrackW] = useState(width);
  const [pos, setPos] = useState(value);
  const trackWRef = useRef(width);
  const draggingRef = useRef(false);
  const lastValueRef = useRef(value);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  // Follow external value changes only when the user isn't actively dragging.
  useEffect(() => {
    if (!draggingRef.current) setPos(value);
  }, [value]);

  const valueFromX = (locationX: number): number => {
    const w = trackWRef.current;
    if (w <= 0) return value;
    const f = Math.max(0, Math.min(1, locationX / w));
    return min + f * (max - min);
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        draggingRef.current = true;
        const v = valueFromX(e.nativeEvent.locationX);
        lastValueRef.current = v;
        setPos(v);
      },
      onPanResponderMove: (e) => {
        const v = valueFromX(e.nativeEvent.locationX);
        lastValueRef.current = v;
        setPos(v);
      },
      onPanResponderRelease: () => {
        draggingRef.current = false;
        onCompleteRef.current(lastValueRef.current);
      },
      onPanResponderTerminate: () => {
        draggingRef.current = false;
        onCompleteRef.current(lastValueRef.current);
      },
    }),
  ).current;

  const frac = Math.max(0, Math.min(1, (pos - min) / (max - min)));
  const fillW = trackW > 0 ? frac * trackW : 0;
  const thumbLeft = Math.max(0, Math.min(trackW - THUMB, fillW - THUMB / 2));

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    trackWRef.current = w;
    setTrackW(w);
  };

  return (
    <View style={[styles.wrap, disabled && styles.disabled]}>
      <View
        style={[styles.track, { width }]}
        onLayout={onLayout}
        {...(disabled ? {} : pan.panHandlers)}
      >
        <View style={styles.bar} />
        <View style={[styles.fill, { width: fillW }]} />
        <View style={[styles.thumb, { left: thumbLeft }]} />
      </View>
      {formatValue && <Text style={styles.readout}>{formatValue(pos)}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 6 },
  disabled: { opacity: 0.35 },
  track: { height: 36, justifyContent: 'center' },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  fill: {
    position: 'absolute',
    left: 0,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(14, 165, 233, 0.95)',
  },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: '#ffffff',
    borderWidth: 2,
    borderColor: 'rgba(14, 165, 233, 0.95)',
  },
  readout: { color: '#ffffff', fontSize: 14, fontWeight: '800' },
});
