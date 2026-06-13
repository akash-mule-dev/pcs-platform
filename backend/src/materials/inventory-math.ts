/**
 * Pure, dependency-free inventory valuation math (no NestJS/TypeORM imports —
 * unit-testable in isolation, mirroring quantity-math.ts / progress-math.ts).
 *
 * Valuation model: MOVING AVERAGE.
 *  - A receipt that carries a unit cost re-averages the material's unit cost
 *    over the quantity already on hand.
 *  - Issues / scrap consume at the current average and stamp it on the ledger
 *    row, so historical consumption keeps its true cost even when prices move.
 */

export function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/**
 * New moving-average unit cost after receiving `receiptQty` at `receiptCost`.
 *  - Existing on-hand at `currentAvg` is blended with the receipt.
 *  - Non-positive/absent on-hand (fresh or corrected stock) → the receipt cost.
 *  - A zero-quantity receipt cannot move the average.
 */
export function movingAverage(
  onHand: number,
  currentAvg: number,
  receiptQty: number,
  receiptCost: number,
): number {
  const oh = Math.max(0, onHand || 0);
  const qty = Math.max(0, receiptQty || 0);
  const avg = Math.max(0, currentAvg || 0);
  const cost = Math.max(0, receiptCost || 0);
  if (qty <= 0) return round2(avg);
  if (oh <= 0) return round2(cost);
  return round2((oh * avg + qty * cost) / (oh + qty));
}

/** Value of a stock position at a unit cost. */
export function stockValue(onHand: number, unitCost: number): number {
  return round2(Math.max(0, onHand || 0) * Math.max(0, unitCost || 0));
}

/** Below (or at) the reorder level — only meaningful when a level is set. */
export function isLowStock(onHand: number, reorderLevel: number): boolean {
  const level = Number(reorderLevel) || 0;
  if (level <= 0) return false;
  return (Number(onHand) || 0) <= level;
}

export type MovementEffect = 'in' | 'out' | 'neutral';

/** How a ledger row of the given type moves on-hand quantity. */
export function movementEffect(type: string): MovementEffect {
  switch (type) {
    case 'receipt':
    case 'return':
      return 'in';
    case 'issue':
    case 'scrap':
      return 'out';
    default:
      return 'neutral'; // adjustment (signed via note), reserve, release
  }
}

export interface ConsumptionMovement {
  type: string; // issue | scrap | return | ...
  quantity: number;
  unitCost: number | null; // stamped at movement time
  fallbackUnitCost?: number; // material's current avg for legacy rows
}

/**
 * Net material consumption COST from ledger rows (issues + scrap − returns),
 * valuing each row at its stamped cost (fallback for pre-costing legacy rows).
 */
export function consumptionCost(movements: ConsumptionMovement[]): number {
  let total = 0;
  for (const m of movements) {
    const qty = Math.max(0, Number(m.quantity) || 0);
    const unit = m.unitCost != null && Number(m.unitCost) >= 0 ? Number(m.unitCost) : Math.max(0, Number(m.fallbackUnitCost) || 0);
    const cost = qty * unit;
    if (m.type === 'issue' || m.type === 'scrap') total += cost;
    else if (m.type === 'return') total -= cost;
  }
  return round2(Math.max(0, total));
}

/** Net consumed QUANTITY from ledger rows (issues + scrap − returns), floored at 0. */
export function consumedQuantity(movements: Array<{ type: string; quantity: number }>): number {
  let total = 0;
  for (const m of movements) {
    const qty = Math.max(0, Number(m.quantity) || 0);
    if (m.type === 'issue' || m.type === 'scrap') total += qty;
    else if (m.type === 'return') total -= qty;
  }
  return Math.max(0, Math.round(total * 1000) / 1000);
}
