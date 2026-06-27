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
