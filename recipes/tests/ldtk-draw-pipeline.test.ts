import { describe, expect, it, vi } from 'vitest';
import type { LdtkLevel, LdtkSurfaceCanvas } from 'aicraft-engine';
import { createLdtkRoomPainter } from '../ldtk-draw-pipeline';

// An empty LDtk level: no layers, so every draw path is a no-op traversal
// and the test exercises cache bookkeeping, not tile rasterization.
const level = {
  identifier: 'Level_0',
  iid: 'level-0-iid',
  uid: 0,
  pxWid: 320,
  pxHei: 240,
  worldX: 0,
  worldY: 0,
  worldDepth: 0,
  fieldInstances: [],
  layerInstances: [],
  __neighbours: [],
} as unknown as Readonly<LdtkLevel>;

const ctx = {
  save: vi.fn(),
  restore: vi.fn(),
  translate: vi.fn(),
  drawImage: vi.fn(),
} as unknown as CanvasRenderingContext2D;

// Truthy 2d context — the cache refuses to bake when getContext('2d') is
// null (src/ldtk/surface.ts guards it), so an empty object stub suffices:
// an empty level's drawLdtkLevel traversal makes no further calls on it.
function stubCanvas(): LdtkSurfaceCanvas {
  return {
    width: 0,
    height: 0,
    getContext: () => ({}) as unknown as CanvasRenderingContext2D,
  };
}

describe('createLdtkRoomPainter', () => {
  it('with no canvas host (Node), draw falls back to the direct path and never throws', () => {
    const painter = createLdtkRoomPainter(new Map());
    expect(() => painter.draw(ctx, level, { worldOffset: { x: 10, y: 0 } })).not.toThrow();
    expect(painter.has(level.iid)).toBe(false);
  });

  it('bakes lazily on first draw and invalidates per level', () => {
    const createCanvas = vi.fn(() => stubCanvas());
    const painter = createLdtkRoomPainter(new Map(), { createCanvas });

    expect(painter.has(level.iid)).toBe(false);
    painter.draw(ctx, level);
    painter.draw(ctx, level);
    expect(painter.has(level.iid)).toBe(true);
    // One bake, one blit per frame: two draws → one canvas created, two blits.
    expect(createCanvas).toHaveBeenCalledTimes(1);
    expect(ctx.drawImage).toHaveBeenCalledTimes(2);

    painter.invalidate(level.iid);
    expect(painter.has(level.iid)).toBe(false);
  });

  it('invalidateAll drops every baked surface', () => {
    const painter = createLdtkRoomPainter(new Map(), { createCanvas: () => stubCanvas() });
    painter.draw(ctx, level);
    painter.invalidateAll();
    expect(painter.has(level.iid)).toBe(false);
  });
});
