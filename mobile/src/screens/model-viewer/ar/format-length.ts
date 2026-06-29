// Pure length formatting for AR measurement readouts — metric (mm/cm/m) or imperial
// (steel-shop feet-inches to 1/16"). Kept dependency-free (no GLB/RN imports) so it's
// unit-testable in isolation; dimensionExtractor re-exports these for existing callers.

/** Display unit system. Geometry stays in metres internally; this only changes
 *  how a length is FORMATTED for the inspector. */
export type UnitSystem = 'metric' | 'imperial';

function gcd(a: number, b: number): number {
  while (b) { [a, b] = [b, a % b]; }
  return a || 1;
}

/** Imperial, steel-shop convention: feet + inches with fractions to 1/16".
 *  e.g. 1.6 m → 5' 3", 0.0254 m → 1", 0.0127 m → 1/2", 0 → 0". */
function formatImperial(v: number): string {
  const sign = v < 0 ? '-' : '';
  const sixteenths = Math.round((Math.abs(v) / 0.0254) * 16); // total 1/16-inch units
  const feet = Math.floor(sixteenths / 192); // 12 in × 16
  const rem = sixteenths - feet * 192;
  const inches = Math.floor(rem / 16);
  const num16 = rem - inches * 16;
  let frac = '';
  if (num16 > 0) { const g = gcd(num16, 16); frac = `${num16 / g}/${16 / g}`; }
  let inchTok: string;
  if (inches > 0) inchTok = `${inches}${frac ? `-${frac}` : ''}"`;
  else if (frac) inchTok = `${frac}"`;
  else inchTok = `0"`;
  return feet > 0 ? `${sign}${feet}' ${inchTok}` : `${sign}${inchTok}`;
}

function formatMetric(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1) return `${v.toFixed(2)} m`;
  if (abs >= 0.01) return `${(v * 100).toFixed(1)} cm`;
  return `${(v * 1000).toFixed(0)} mm`;
}

/** Format a length given in METRES for display in the chosen unit system. */
export function formatLength(meters: number, system: UnitSystem = 'metric'): string {
  return system === 'imperial' ? formatImperial(meters) : formatMetric(meters);
}

/** Back-compat: metric formatting (kept so existing callers / the Viro path are unchanged). */
export function formatMeters(v: number): string {
  return formatMetric(v);
}
