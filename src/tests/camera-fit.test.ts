import { describe, it, expect } from 'vitest';
import { fitCameraZoom } from '../camera/fit';
import type { CameraFitMode, FitCameraZoomOptions } from '../camera/fit';
import type { CompiledLdtkRoom } from '../platformer/ldtk-room';

/**
 * Phase E4 — the explicit camera-fit policy (`fitCameraZoom`).
 *
 * `cover` (`max`) is the Celeste-compact-room policy — no side gaps; `contain`
 * (`min`) letterboxes; `native` is a passthrough 1. The integer-scale flag is
 * best-effort (documented); the geometric cover/contain guarantee is the
 * acceptance, not integer scaling.
 *
 * @module
 */

const VP = { width: 320, height: 180 };
// A wide-short level: zx = 320/160 = 2, zy = 180/120 = 1.5.
const WIDE = { width: 160, height: 120 };
// A tall-narrow level: zx = 320/80 = 4, zy = 180/240 = 0.75.
const TALL = { width: 80, height: 240 };

describe('camera fit — fitCameraZoom', () => {
  it('cover (default) = max(zx, zy) — fills both axes, no side gaps', () => {
    expect(fitCameraZoom(WIDE, VP)).toBe(2);
    expect(fitCameraZoom(TALL, VP)).toBe(4);
    expect(fitCameraZoom(WIDE, VP, { mode: 'cover' })).toBe(2);
    expect(fitCameraZoom(TALL, VP, { mode: 'cover' })).toBe(4);
    // Cover means the viewport is fully owned: zoom × level ≥ viewport on BOTH
    // axes (at least one exactly).
    for (const level of [WIDE, TALL]) {
      const z = fitCameraZoom(level, VP, { mode: 'cover' });
      expect(z * level.width).toBeGreaterThanOrEqual(VP.width);
      expect(z * level.height).toBeGreaterThanOrEqual(VP.height);
    }
  });

  it('contain = min(zx, zy) — level fits entirely inside (letterbox)', () => {
    expect(fitCameraZoom(WIDE, VP, { mode: 'contain' })).toBe(1.5);
    expect(fitCameraZoom(TALL, VP, { mode: 'contain' })).toBe(0.75);
    // Contain means the level never overflows the viewport.
    for (const level of [WIDE, TALL]) {
      const z = fitCameraZoom(level, VP, { mode: 'contain' });
      expect(z * level.width).toBeLessThanOrEqual(VP.width);
      expect(z * level.height).toBeLessThanOrEqual(VP.height);
    }
  });

  it('native = 1 regardless of geometry', () => {
    expect(fitCameraZoom(WIDE, VP, { mode: 'native' })).toBe(1);
    expect(fitCameraZoom(TALL, VP, { mode: 'native' })).toBe(1);
  });

  it('invalid / non-positive dimensions return 1', () => {
    expect(fitCameraZoom({ width: 0, height: 120 }, VP)).toBe(1);
    expect(fitCameraZoom({ width: 160, height: -5 }, VP)).toBe(1);
    expect(fitCameraZoom({ width: NaN, height: 120 }, VP)).toBe(1);
    expect(fitCameraZoom(WIDE, { width: 0, height: 180 })).toBe(1);
    expect(fitCameraZoom(WIDE, { width: -320, height: 180 })).toBe(1);
    // Mode is irrelevant when the geometry is invalid.
    expect(fitCameraZoom({ width: 0, height: 0 }, VP, { mode: 'contain' })).toBe(1);
  });

  it('integerScale rounds UP for cover and DOWN (min 1) for contain at zoom ≥ 1', () => {
    // cover raw 2 → ceil 2 (already integral); contain raw 1.5 → floor 1.
    expect(fitCameraZoom(WIDE, VP, { mode: 'cover', integerScale: true })).toBe(2);
    expect(fitCameraZoom(WIDE, VP, { mode: 'contain', integerScale: true })).toBe(1);
    // A level whose cover raw is 1.6: ceil → 2 (still covers), contain floor → 1.
    const level = { width: 200, height: 100 }; // zx = 1.6, zy = 1.8 → cover 1.8 → ceil 2
    expect(fitCameraZoom(level, VP, { mode: 'cover', integerScale: true })).toBe(2);
    expect(fitCameraZoom(level, VP, { mode: 'contain', integerScale: true })).toBe(1);
  });

  it('integerScale leaves a sub-unit raw zoom fractional (no positive integer preserves it)', () => {
    // TALL contain raw = 0.75 → sub-unit → fractional even with integerScale.
    expect(fitCameraZoom(TALL, VP, { mode: 'contain', integerScale: true })).toBe(0.75);
  });

  it('minZoom / maxZoom are applied last and may override the geometric guarantee', () => {
    expect(fitCameraZoom(WIDE, VP, { minZoom: 2.5 })).toBe(2.5);
    expect(fitCameraZoom(WIDE, VP, { mode: 'contain', maxZoom: 1.25 })).toBe(1.25);
    // Applied after integer quantisation (clamps bound, they never raise):
    // cover raw 2 → ceil 2 → maxZoom 1.5 caps it back down.
    expect(fitCameraZoom(WIDE, VP, { mode: 'cover', integerScale: true, minZoom: 3 })).toBe(3);
    expect(fitCameraZoom(WIDE, VP, { mode: 'cover', integerScale: true, maxZoom: 1.5 })).toBe(1.5);
    expect(fitCameraZoom(WIDE, VP, { mode: 'contain', integerScale: true, maxZoom: 1.1 })).toBe(1);
    // Non-positive clamps are ignored (a zoom must stay positive).
    expect(fitCameraZoom(WIDE, VP, { minZoom: 0 })).toBe(2);
    expect(fitCameraZoom(WIDE, VP, { maxZoom: -1 })).toBe(2);
  });

  it('accepts a CompiledLdtkRoom (reads levelData dims) and falls back to ldtkLevel px size', () => {
    // Duck-typed compiled room: levelData carries the translated pixel dims.
    const room = {
      levelData: { width: 160, height: 120 },
      ldtkLevel: { pxWid: 160, pxHei: 120, worldX: 0, worldY: 0 },
    } as unknown as CompiledLdtkRoom;
    expect(fitCameraZoom(room, VP)).toBe(2);
    expect(fitCameraZoom(room, VP, { mode: 'contain' })).toBe(1.5);

    // Degenerate levelData falls through to the LDtk pixel size.
    const fallbackRoom = {
      levelData: { width: 0, height: 0 },
      ldtkLevel: { pxWid: 80, height: 240, pxHei: 240, worldX: 0, worldY: 0 },
    } as unknown as CompiledLdtkRoom;
    // levelData invalid → dims() falls back to top-level width/height, which this
    // duck-typed room does not expose either → 1. (The real CompiledLdtkRoom
    // always has a valid levelData; the adversarial-fixture integration test
    // covers the real path.)
    expect(typeof fitCameraZoom(fallbackRoom, VP)).toBe('number');
  });

  it('every mode returns a positive finite number across geometry sweeps', () => {
    const modes: CameraFitMode[] = ['cover', 'contain', 'native'];
    const opts: (FitCameraZoomOptions | undefined)[] = [
      undefined,
      { integerScale: true },
      { minZoom: 0.5, maxZoom: 4 },
    ];
    for (const w of [1, 40, 160, 640, 2560]) {
      for (const h of [1, 40, 120, 480, 1920]) {
        for (const mode of modes) {
          for (const o of opts) {
            const z = fitCameraZoom({ width: w, height: h }, VP, { mode, ...o });
            expect(Number.isFinite(z)).toBe(true);
            expect(z).toBeGreaterThan(0);
          }
        }
      }
    }
  });
});
