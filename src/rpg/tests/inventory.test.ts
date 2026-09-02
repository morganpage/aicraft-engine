import { describe, it, expect } from 'vitest';
import { grantItem, consumeItem, getItemCount } from '../inventory';

describe('inventory operations', () => {
  it('grants items and merges counts, keeping entries sorted', () => {
    let inventory = grantItem([], 'potion', 2);
    inventory = grantItem(inventory, 'capture-orb', 5);
    inventory = grantItem(inventory, 'potion', 1);
    expect(inventory).toEqual([
      { itemId: 'capture-orb', quantity: 5 },
      { itemId: 'potion', quantity: 3 },
    ]);
    expect(getItemCount(inventory, 'potion')).toBe(3);
    expect(getItemCount(inventory, 'nothing')).toBe(0);
  });
  it('consumes items and removes zero-count entries', () => {
    let inventory = grantItem([], 'potion', 2);
    inventory = consumeItem(inventory, 'potion', 2);
    expect(inventory).toEqual([]);
    expect(getItemCount(inventory, 'potion')).toBe(0);
  });
  it('never goes negative: over-consuming is a no-op', () => {
    const inventory = grantItem([], 'potion', 1);
    expect(consumeItem(inventory, 'potion', 2)).toEqual(inventory);
  });
  it('ignores non-positive and non-finite quantities', () => {
    const inventory = grantItem([], 'potion', 1);
    expect(grantItem(inventory, 'potion', 0)).toEqual(inventory);
    expect(grantItem(inventory, 'potion', Number.NaN)).toEqual(inventory);
    expect(consumeItem(inventory, 'potion', 0)).toEqual(inventory);
    expect(grantItem([], 'potion', 1.7)).toEqual([{ itemId: 'potion', quantity: 1 }]);
  });
});
