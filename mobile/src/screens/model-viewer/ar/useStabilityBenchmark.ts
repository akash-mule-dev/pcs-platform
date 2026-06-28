// useStabilityBenchmark — records the markers-OFF vs markers-ON A/B on the iPad and
// reduces it to the headline "how much steadier" number via the unit-tested pure
// stability-benchmark module. The native view streams onPoseSample (the model's world
// pose + the nearest tracked marker) only while `sampling` is true, so the overhead is
// confined to an active recording. Policy + buffering only — the math is in
// stability-benchmark.ts.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PoseSample,
  RunMetrics,
  BenchmarkRun,
  BenchmarkComparison,
  BenchmarkExport,
  computeRunMetrics,
  compareRuns,
  buildBenchmarkExport,
} from './stability-benchmark';

export type BenchRun = 'off' | 'on';

/** Native onPoseSample payload (matrices are column-major 16). */
export interface PoseSampleEvent {
  t?: number;
  model: number[];
  refMarker?: number[];
  markerActive?: boolean;
  tracking?: string;
}

export interface StabilityBenchmark {
  recording: BenchRun | null;
  /** Drives the native `poseSampling` prop (only stream while recording). */
  sampling: boolean;
  elapsedMs: number;
  runMs: number;
  offMetrics: RunMetrics | null;
  onMetrics: RunMetrics | null;
  comparison: BenchmarkComparison | null;
  onPoseSample: (e: { nativeEvent: PoseSampleEvent }) => void;
  startRun: (which: BenchRun) => void;
  stop: () => void;
  reset: () => void;
  buildExport: (context?: Record<string, unknown>) => BenchmarkExport;
}

const RUN_MS = 12000; // a 12 s hold/walk per run — long enough for VIO drift to show

export function useStabilityBenchmark(): StabilityBenchmark {
  const recordingRef = useRef<BenchRun | null>(null);
  const bufferRef = useRef<PoseSample[]>([]);
  const startedAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [recording, setRecording] = useState<BenchRun | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [offRun, setOffRun] = useState<BenchmarkRun | null>(null);
  const [onRun, setOnRun] = useState<BenchmarkRun | null>(null);

  const clearTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const stop = useCallback(() => {
    clearTimer();
    const which = recordingRef.current;
    recordingRef.current = null;
    setRecording(null);
    if (!which) return;
    const samples = bufferRef.current.slice();
    const run: BenchmarkRun = { metrics: computeRunMetrics(samples), samples };
    if (which === 'off') setOffRun(run);
    else setOnRun(run);
  }, []);

  const startRun = useCallback(
    (which: BenchRun) => {
      clearTimer();
      bufferRef.current = [];
      recordingRef.current = which;
      startedAtRef.current = Date.now();
      setRecording(which);
      setElapsedMs(0);
      timerRef.current = setInterval(() => {
        const el = Date.now() - startedAtRef.current;
        setElapsedMs(el);
        if (el >= RUN_MS) stop();
      }, 150);
    },
    [stop],
  );

  const onPoseSample = useCallback((e: { nativeEvent: PoseSampleEvent }) => {
    if (!recordingRef.current) return;
    const ne = e?.nativeEvent;
    if (!ne || !Array.isArray(ne.model) || ne.model.length < 16) return;
    bufferRef.current.push({
      t: typeof ne.t === 'number' ? ne.t : Date.now(),
      model: ne.model,
      refMarker: Array.isArray(ne.refMarker) && ne.refMarker.length >= 16 ? ne.refMarker : undefined,
      markerActive: !!ne.markerActive,
      tracking: ne.tracking,
    });
  }, []);

  const reset = useCallback(() => {
    stop();
    bufferRef.current = [];
    setOffRun(null);
    setOnRun(null);
    setElapsedMs(0);
  }, [stop]);

  const comparison = useMemo(
    () => (offRun && onRun ? compareRuns(offRun.metrics, onRun.metrics) : null),
    [offRun, onRun],
  );

  const buildExport = useCallback(
    (context?: Record<string, unknown>) => buildBenchmarkExport({ off: offRun, on: onRun, context }),
    [offRun, onRun],
  );

  useEffect(() => () => clearTimer(), []);

  return {
    recording,
    sampling: recording !== null,
    elapsedMs,
    runMs: RUN_MS,
    offMetrics: offRun?.metrics ?? null,
    onMetrics: onRun?.metrics ?? null,
    comparison,
    onPoseSample,
    startRun,
    stop,
    reset,
    buildExport,
  };
}
