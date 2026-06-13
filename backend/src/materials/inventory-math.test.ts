/**
 * Unit tests for the pure inventory valuation math.
 * Run directly (no Nest/TypeORM needed):
 *   node --experimental-strip-types src/materials/inventory-math.test.ts
 */
import assert from 'node:assert/strict';
import {
  movingAverage,
  stockValue,
  isLowStock,
  movementEffect,
  consumptionCost,
  consumedQuantity,
  round2,
} from './inventory-math.ts';

let passed = 0;
function ok(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log('inventory-math');

ok('moving average blends on-hand with the receipt', () => {
  // 100 kg @ 2.00 + 100 kg @ 4.00 → 200 kg @ 3.00
  assert.equal(movingAverage(100, 2, 100, 4), 3);
  // 10 @ 5 + 30 @ 1 → 40 @ 2
  assert.equal(movingAverage(10, 5, 30, 1), 2);
});

ok('moving average rounds to cents', () => {
  assert.equal(movingAverage(3, 1, 1, 2), 1.25);
  assert.equal(movingAverage(1, 1, 2, 2), 1.67); // 5/3
});

ok('first receipt sets the average outright', () => {
  assert.equal(movingAverage(0, 0, 50, 7.5), 7.5);
  assert.equal(movingAverage(0, 99, 50, 7.5), 7.5); // stale avg with zero stock is replaced
  assert.equal(movingAverage(-5, 3, 10, 4), 4); // corrected/negative stock treated as empty
});

ok('zero-quantity receipt cannot move the average', () => {
  assert.equal(movingAverage(100, 2.5, 0, 99), 2.5);
});

ok('garbage inputs are clamped, not propagated', () => {
  assert.equal(movingAverage(NaN as any, NaN as any, 10, 3), 3);
  assert.equal(movingAverage(10, 2, 10, -5), 1); // negative cost clamps to 0 → (10*2+10*0)/20
});

ok('stock value', () => {
  assert.equal(stockValue(12.5, 4), 50);
  assert.equal(stockValue(0, 100), 0);
  assert.equal(stockValue(-3, 100), 0);
});

ok('low stock only when a reorder level is set', () => {
  assert.ok(isLowStock(5, 10));
  assert.ok(isLowStock(10, 10)); // at the level counts as low
  assert.ok(!isLowStock(11, 10));
  assert.ok(!isLowStock(0, 0)); // no level configured → never "low"
});

ok('movement effects', () => {
  assert.equal(movementEffect('receipt'), 'in');
  assert.equal(movementEffect('return'), 'in');
  assert.equal(movementEffect('issue'), 'out');
  assert.equal(movementEffect('scrap'), 'out');
  assert.equal(movementEffect('adjustment'), 'neutral');
  assert.equal(movementEffect('reserve'), 'neutral');
});

ok('consumption cost = issues + scrap − returns at stamped costs', () => {
  const cost = consumptionCost([
    { type: 'issue', quantity: 10, unitCost: 2 },     // +20
    { type: 'scrap', quantity: 2, unitCost: 2 },      // +4
    { type: 'return', quantity: 5, unitCost: 2 },     // −10
    { type: 'receipt', quantity: 100, unitCost: 9 },  // ignored
  ]);
  assert.equal(cost, 14);
});

ok('consumption cost falls back to the material cost for legacy rows', () => {
  assert.equal(consumptionCost([{ type: 'issue', quantity: 4, unitCost: null, fallbackUnitCost: 2.5 }]), 10);
});

ok('consumption cost never goes negative', () => {
  assert.equal(consumptionCost([{ type: 'return', quantity: 50, unitCost: 3 }]), 0);
});

ok('consumed quantity nets returns and floors at zero', () => {
  assert.equal(consumedQuantity([
    { type: 'issue', quantity: 10 },
    { type: 'scrap', quantity: 1.5 },
    { type: 'return', quantity: 2 },
  ]), 9.5);
  assert.equal(consumedQuantity([{ type: 'return', quantity: 2 }]), 0);
});

ok('round2 half-up at cents', () => {
  assert.equal(round2(1.005), 1.01);
  assert.equal(round2(2.674999), 2.67);
});

console.log(`\ninventory-math: ${passed} assertions passed`);
