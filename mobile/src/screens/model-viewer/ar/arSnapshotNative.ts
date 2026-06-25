// Capture a screenshot of the native RealityKit (LiDAR) AR view as evidence.
//
// The Viro path uses Viro's navigator screenshot (arSnapshot.ts); the native
// engine instead exposes a `capture()` view-function that returns a base64 PNG
// of the live ARView (overlay composited on the camera feed). We write those
// bytes to a cache file:// uri so the QA evidence-upload path (which expects a
// uri) is identical across both engines.
import * as FileSystem from 'expo-file-system';

interface SnapshotResult {
  uri: string;
}

function genName(): string {
  const rand =
    typeof crypto !== 'undefined' && (crypto as any).randomUUID
      ? (crypto as any).randomUUID()
      : `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  return `ar_evidence_${rand}.png`;
}

/**
 * @param arRef ref to the <PcsLidarArView> native component (its prototype carries
 *              the native `capture` view-function).
 */
export async function captureNativeSnapshot(arRef: {
  current: any;
}): Promise<SnapshotResult | null> {
  const view = arRef.current;
  if (!view || typeof view.capture !== 'function') return null;
  try {
    const base64: string | null = await view.capture();
    if (!base64) return null;
    const dir = `${FileSystem.cacheDirectory}pcs-ar-evidence/`;
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
    const uri = `${dir}${genName()}`;
    await FileSystem.writeAsStringAsync(uri, base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return { uri };
  } catch {
    return null;
  }
}
