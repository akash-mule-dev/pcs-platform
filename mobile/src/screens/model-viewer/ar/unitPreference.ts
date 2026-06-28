// Persisted display-unit preference for AR measurements (metric ↔ imperial). This
// is a UI-only choice — geometry, scale, and logged QA records stay in metres/mm.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { UnitSystem } from './dimensionExtractor';

const KEY = 'ar-measurement-unit-system';

export async function loadUnitSystem(): Promise<UnitSystem> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    return v === 'imperial' ? 'imperial' : 'metric';
  } catch {
    return 'metric';
  }
}

export async function saveUnitSystem(system: UnitSystem): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, system);
  } catch {
    /* preference is best-effort; ignore storage failures */
  }
}
