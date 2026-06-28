// Recover the GLB-unit → METRE scale so the AR model renders at TRUE 1:1 size,
// matching the real fabricated assembly. The GLB carries the IFC's native units
// (often mm) and — depending on the converter — may be expressed in mm OR metres,
// so a fixed assumption ("÷1000") is unreliable. Instead we CALIBRATE against the
// fabrication data we already have: each part's real length (`length_mm`) versus
// its longest bounding-box edge (in GLB units). The median of (length_m / edge)
// over every part with a known length is metres-per-unit — robust to a few odd
// parts and unit-agnostic. This is the AR analogue of the web 3D viewer's
// `mmPerWorldUnit` auto-calibration.
import { MNode } from '../../../services/projects.service';
import { PartDimension } from './dimensionExtractor';

/**
 * @returns metres-per-GLB-unit (apply as the model's uniform scale for 1:1), or
 *          null when no part has a usable length (caller falls back to a fit-scale).
 */
export function metersPerUnit(parts: PartDimension[], nodes: MNode[]): number | null {
  if (!parts.length || !nodes.length) return null;

  // mesh-name (== ifc_guid) → real length in mm.
  const lenByName = new Map<string, number>();
  for (const n of nodes) {
    if (!n.lengthMm || n.lengthMm <= 0) continue;
    if (n.meshName) lenByName.set(n.meshName, n.lengthMm);
    if (n.ifcGuid) lenByName.set(n.ifcGuid, n.lengthMm);
  }
  if (lenByName.size === 0) return null;

  const ratios: number[] = [];
  for (const p of parts) {
    const lenMm = lenByName.get(p.name);
    if (!lenMm) continue;
    const longest = Math.max(p.size[0], p.size[1], p.size[2]);
    if (longest > 1e-6) ratios.push(lenMm / 1000 / longest); // metres per GLB unit
  }
  if (ratios.length === 0) return null;

  ratios.sort((a, b) => a - b);
  const mid = Math.floor(ratios.length / 2);
  const median = ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;
  return median > 0 && isFinite(median) ? median : null;
}

// Plausibility window for the calibrated overall size (longest dimension, metres).
// Outside this, the length data is suspect — the caller should fall back to the
// fixed fit-scale rather than render an absurd 1 km (or 1 cm) ghost.
const MIN_PLAUSIBLE_M = 0.02;
const MAX_PLAUSIBLE_M = 300;

/**
 * Metres-per-unit for 1:1, but only if the resulting overall model size is
 * plausible for a fabricated assembly; otherwise null (→ fit-scale fallback).
 */
export function realScaleMetersPerUnit(
  overallLongestUnits: number,
  parts: PartDimension[],
  nodes: MNode[],
): number | null {
  const mpu = metersPerUnit(parts, nodes);
  if (!mpu) return null;
  const sizeM = overallLongestUnits * mpu;
  if (!isFinite(sizeM) || sizeM < MIN_PLAUSIBLE_M || sizeM > MAX_PLAUSIBLE_M) return null;
  return mpu;
}

// ── Geometry-magnitude unit guess (independent of length data) ──────────────
// The IFC→GLB converter writes web-ifc's NATIVE coordinates with no baked
// fit-scale and no global node scale, so a part's size in GLB units IS its real
// size in the IFC's native length unit (mm or m — whichever the file used). The
// model's overall longest edge therefore tells us the scale: we test both unit
// interpretations and accept one ONLY when it is UNAMBIGUOUS — i.e. exactly one of
// "units are metres" / "units are millimetres" yields a plausible fabricated size
// (GEOM_LO_M..GEOM_HI_M). When BOTH readings are plausible (a value can be a large
// metre-unit structure OR a small mm-unit part — the genuinely ambiguous mid-band,
// reachable when an ISOLATED small part is opened) we return null and let the
// caller fall back to part-length calibration or the fixed fit-scale, rather than
// risk rendering 1000× wrong. This is the robust signal when part lengths are
// missing or corrupt — which the production data frequently is.
const GEOM_LO_M = 0.05; // 5 cm — smallest object worth a real-scale AR overlay
const GEOM_HI_M = 300; // matches MAX_PLAUSIBLE_M

export function magnitudeMetersPerUnit(overallLongestUnits: number): number | null {
  if (!isFinite(overallLongestUnits) || overallLongestUnits <= 0) return null;
  const asMetres = overallLongestUnits; // interpret GLB units as metres
  const asMm = overallLongestUnits * 0.001; // interpret GLB units as millimetres
  const metresOk = asMetres >= GEOM_LO_M && asMetres <= GEOM_HI_M;
  const mmOk = asMm >= GEOM_LO_M && asMm <= GEOM_HI_M;
  if (metresOk && !mmOk) return 1; // only the metre reading is plausible
  if (mmOk && !metresOk) return 0.001; // only the mm reading is plausible
  return null; // ambiguous (both plausible) or neither → caller refines / falls back
}

export type RealScaleSource = 'authoritative' | 'calibrated' | 'estimated' | 'none';
export interface RealScaleResult {
  /** metres-per-GLB-unit for a 1:1 render, or 0 when undeterminable (→ fit-scale). */
  mpu: number;
  source: RealScaleSource;
}

/**
 * Resolve the true metres-per-GLB-unit for a 1:1 AR render, robust to the
 * unreliable `length_mm` data seen in production. Strategy, most→least trusted:
 *
 *  1. **Geometry magnitude** (`magnitudeMetersPerUnit`) is the ground truth for
 *     SCALE — the GLB can't lie about how big it is in its own units; only the
 *     unit (mm vs m) is unknown, and the magnitude snap resolves that.
 *  2. **Part-length calibration** REFINES the magnitude when the two AGREE
 *     (within 2×) — precise when the data is good, and automatically discarded
 *     when it's garbage (e.g. sub-millimetre "lengths" that disagree wildly).
 *  3. If geometry magnitude is undeterminable, fall back to calibration alone
 *     (with its own plausibility guard), else give up (caller keeps the fit-scale).
 */
export function resolveRealScale(
  overallLongestUnits: number,
  parts: PartDimension[],
  nodes: MNode[],
): RealScaleResult {
  const mag = magnitudeMetersPerUnit(overallLongestUnits);
  const calib = metersPerUnit(parts, nodes);

  if (mag) {
    // Trust calibration only when it agrees with the geometry's magnitude — this
    // keeps the precise per-part scale when the data is sound and rejects it when
    // it's corrupt (the model's real extent can't be wrong).
    if (calib && calib / mag >= 0.5 && calib / mag <= 2) {
      return { mpu: calib, source: 'calibrated' };
    }
    return { mpu: mag, source: 'estimated' };
  }

  // No geometry-magnitude match (unusual unit or out-of-range model) — last
  // chance is calibration alone, guarded for a plausible overall size.
  if (calib) {
    const sizeM = overallLongestUnits * calib;
    if (isFinite(sizeM) && sizeM >= MIN_PLAUSIBLE_M && sizeM <= MAX_PLAUSIBLE_M) {
      return { mpu: calib, source: 'calibrated' };
    }
  }
  return { mpu: 0, source: 'none' };
}
