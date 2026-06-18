import { Vibration, Platform, ToastAndroid } from 'react-native';

/**
 * Lightweight, dependency-free ACTION feedback for the shop floor.
 *
 * A short haptic tick so a gloved operator FEELS that a tap registered, plus a
 * native Android Toast for the on-screen "it worked" confirmation. iOS has no
 * built-in toast, so it gets the haptic only — callers that need a guaranteed
 * on-screen message on iOS should pair this with a visual state change or Alert.
 *
 * Uses only React Native built-ins (Vibration / ToastAndroid) — no new native
 * dependency, so it doesn't trigger a ViroReact-pinned rebuild.
 */
export function notifySuccess(message?: string): void {
  try { Vibration.vibrate(15); } catch { /* haptics unavailable — non-fatal */ }
  if (message && Platform.OS === 'android') {
    try { ToastAndroid.show(message, ToastAndroid.SHORT); } catch { /* non-fatal */ }
  }
}

export function notifyError(message?: string): void {
  // A double-buzz reads as "something's wrong" without needing to look.
  try { Vibration.vibrate([0, 40, 70, 40]); } catch { /* non-fatal */ }
  if (message && Platform.OS === 'android') {
    try { ToastAndroid.show(message, ToastAndroid.LONG); } catch { /* non-fatal */ }
  }
}
