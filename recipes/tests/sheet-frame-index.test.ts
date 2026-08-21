import { describe, expect, it } from 'vitest';
import { createSpriteAnimState, type CompiledAnim } from 'aicraft-engine';
import { currentSheetFrameIndex, currentSheetFrameIndexAt } from '../sheet-frame-index';

// Deliberately NON-identity slots: sheet cells [7, 3, 11] via slots [0, 1, 2].
// An identity clip ([0, 1, 2]) hides slot/cell confusion — this one exposes it.
const clip: CompiledAnim = {
  name: 'reordered',
  frameIndices: [7, 3, 11],
  durations: [100, 100, 100],
  direction: 'forward',
  loop: true,
};

describe('currentSheetFrameIndex', () => {
  it('returns the SHEET CELL the slot points at, not the slot itself', () => {
    expect(currentSheetFrameIndex({ elapsedMs: 0 }, clip)).toBe(7);
    expect(currentSheetFrameIndex({ elapsedMs: 150 }, clip)).toBe(3);
    expect(currentSheetFrameIndex({ elapsedMs: 250 }, clip)).toBe(11);
  });

  it('wraps by sheet cells through the clip mapping', () => {
    // 350 ms wraps to slot 0 (cycle 300) — cell 7 again, not slot arithmetic.
    expect(currentSheetFrameIndex({ elapsedMs: 350 }, clip)).toBe(7);
  });

  it('returns undefined for an empty clip', () => {
    const empty: CompiledAnim = {
      name: 'empty',
      frameIndices: [],
      durations: [],
      direction: 'forward',
      loop: true,
    };
    expect(currentSheetFrameIndex(createSpriteAnimState(), empty)).toBeUndefined();
    expect(currentSheetFrameIndexAt(0, empty)).toBeUndefined();
  });

  it('the At variant mirrors the state variant for an explicit time', () => {
    expect(currentSheetFrameIndexAt(150, clip)).toBe(3);
  });
});
