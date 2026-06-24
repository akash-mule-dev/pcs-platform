// Capture a screenshot of the live AR view (the overlay composited on the real
// camera feed) via Viro's navigator. Returns a local file:// uri or null.
//
// Viro's _takeScreenshot(fileName, saveToCameraRoll) resolves to
// { success, url } where url is the saved image path.

interface SnapshotResult {
  uri: string;
}

function genName(): string {
  const rand =
    typeof crypto !== 'undefined' && (crypto as any).randomUUID
      ? (crypto as any).randomUUID()
      : `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  return `ar_evidence_${rand}`;
}

/**
 * @param navigatorRef ref to the ViroARSceneNavigator instance
 * @param saveToCameraRoll also persist to the device gallery (default false)
 */
export async function captureSnapshot(
  navigatorRef: { current: any },
  saveToCameraRoll = false,
): Promise<SnapshotResult | null> {
  const nav = navigatorRef.current;
  const take = nav?._takeScreenshot ?? nav?.arSceneNavigator?.takeScreenshot;
  if (typeof take !== 'function') return null;

  try {
    const result = await take.call(nav, genName(), saveToCameraRoll);
    // Viro returns { success, url }. Some versions return just a path string.
    const url: string | undefined =
      typeof result === 'string' ? result : result?.url;
    if (!url) return null;
    const uri = url.startsWith('file://') ? url : `file://${url}`;
    return { uri };
  } catch {
    return null;
  }
}
