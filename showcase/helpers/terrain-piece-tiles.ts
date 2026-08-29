/**
 * Procedural stone tile sheet + rule set for the terrain-piece showcase.
 *
 * No PNG. The sheet is painted at runtime from a seeded RNG, which keeps the
 * section honest about what it is demonstrating: the *capping mechanism*, not
 * a particular artist's tile art. Swap in an authored sheet and nothing about
 * the piece pipeline changes.
 *
 * ## The 16-rule edge-mask set
 *
 * Each rule fully specifies its four orthogonal neighbours and wildcards the
 * diagonals, so the sixteen rules are mutually exclusive and rule order is
 * irrelevant. Rule index *is* the edge mask:
 *
 * ```text
 * bit 1 → N solid    bit 2 → E solid    bit 4 → S solid    bit 8 → W solid
 * ```
 *
 * A tile draws a bevelled cap on every face whose bit is clear. That is the
 * whole capping mechanism: when a pit opens, the cells at the new boundary lose
 * their E (or W) neighbour, drop to a different mask, and pick up a cap. When it
 * closes they regain the neighbour and the seam disappears — no state machine,
 * just a different neighbourhood.
 *
 * @module
 */

import { mulberry32 } from '../../src/rng';
import type { TerrainArtRuleSet, TerrainKindDefinition } from '../../src/terrain-art/types';
import type { TerrainTilesetSource } from '../../src/terrain-art/import-tileset';

export const DEMO_TILE = 16;
const SHEET_COLS = 8;
const SHEET_ROWS = 2;

/** Edge-mask bits. */
export const EDGE_N = 1;
export const EDGE_E = 2;
export const EDGE_S = 4;
export const EDGE_W = 8;

/** Warm stone palette — deliberately close to the flat fill so the ONLY visible
 *  difference between the two panels is edge treatment, not hue. */
export const STONE_BASE = '#6b6357';
const STONE_DEEP = '#4a453c';
const STONE_LIGHT = '#8f8574';
const STONE_RIM = '#a89b85';
const STONE_SHADOW = '#39352e';

/** One solid kind, matching the tile value the demo rasterizes with. */
export const DEMO_KINDS: readonly TerrainKindDefinition[] = Object.freeze([
  Object.freeze({
    id: 'stone',
    label: 'Stone',
    tileValue: 1,
    collision: 'solid' as const,
    materialId: 'stone',
    connectGroup: 'stone',
    renderPriority: 0,
  }),
]);

/**
 * Sixteen rules, one per edge mask. Slots are `[NW,N,NE,W,C,E,SW,S,SE]`;
 * `-1` is wildcard, so only the centre and the four orthogonals are pinned.
 */
export const DEMO_RULE_SET: TerrainArtRuleSet = Object.freeze({
  rules: Object.freeze(
    Array.from({ length: 16 }, (_unused, mask) => ({
      pattern: Object.freeze([
        -1, (mask & EDGE_N) ? 1 : 0, -1,
        (mask & EDGE_W) ? 1 : 0, 1, (mask & EDGE_E) ? 1 : 0,
        -1, (mask & EDGE_S) ? 1 : 0, -1,
      ]),
      tile: Object.freeze({ col: mask % SHEET_COLS, row: Math.floor(mask / SHEET_COLS) }),
    })),
  ),
});

/** Paint one tile for `mask` into `ctx` at `(ox, oy)`. */
function paintTile(ctx: CanvasRenderingContext2D, ox: number, oy: number, mask: number): void {
  const T = DEMO_TILE;
  ctx.fillStyle = STONE_BASE;
  ctx.fillRect(ox, oy, T, T);

  // Deterministic speckle — seeded by mask so the sheet is identical every run.
  const rng = mulberry32(0x5eed + mask);
  for (let i = 0; i < 14; i++) {
    const x = ox + Math.floor(rng() * T);
    const y = oy + Math.floor(rng() * T);
    ctx.fillStyle = rng() > 0.5 ? STONE_DEEP : STONE_LIGHT;
    ctx.globalAlpha = 0.28;
    ctx.fillRect(x, y, 1, 1);
  }
  ctx.globalAlpha = 1;

  // An exposed face gets a bright rim and an inward shadow; a bonded face gets
  // nothing at all, so two bonded tiles meet with no visible join.
  const cap = (
    rimX: number, rimY: number, rimW: number, rimH: number,
    shX: number, shY: number, shW: number, shH: number,
  ): void => {
    ctx.fillStyle = STONE_SHADOW;
    ctx.fillRect(shX, shY, shW, shH);
    ctx.fillStyle = STONE_RIM;
    ctx.fillRect(rimX, rimY, rimW, rimH);
  };

  if (!(mask & EDGE_N)) cap(ox, oy, T, 2, ox, oy + 2, T, 1);
  if (!(mask & EDGE_S)) cap(ox, oy + T - 2, T, 2, ox, oy + T - 3, T, 1);
  if (!(mask & EDGE_W)) cap(ox, oy, 2, T, ox + 2, oy, 1, T);
  if (!(mask & EDGE_E)) cap(ox + T - 2, oy, 2, T, ox + T - 3, oy, 1, T);

  // Corner nub where two exposed faces meet — stops a capped corner reading as
  // two unrelated strips.
  ctx.fillStyle = STONE_RIM;
  if (!(mask & EDGE_N) && !(mask & EDGE_W)) ctx.fillRect(ox, oy, 3, 3);
  if (!(mask & EDGE_N) && !(mask & EDGE_E)) ctx.fillRect(ox + T - 3, oy, 3, 3);
  if (!(mask & EDGE_S) && !(mask & EDGE_W)) ctx.fillRect(ox, oy + T - 3, 3, 3);
  if (!(mask & EDGE_S) && !(mask & EDGE_E)) ctx.fillRect(ox + T - 3, oy + T - 3, 3, 3);
}

/**
 * Paint the 8×2 sheet and return it as a `TerrainTilesetSource`.
 *
 * Requires a canvas host — returns `null` when none is available, so the caller
 * keeps its own fallback rather than throwing during section init.
 */
export function createDemoTilesetSource(): TerrainTilesetSource | null {
  try {
    const width = SHEET_COLS * DEMO_TILE;
    const height = SHEET_ROWS * DEMO_TILE;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return null;
    ctx.imageSmoothingEnabled = false;
    for (let mask = 0; mask < 16; mask++) {
      paintTile(ctx, (mask % SHEET_COLS) * DEMO_TILE, Math.floor(mask / SHEET_COLS) * DEMO_TILE, mask);
    }
    return {
      pixels: ctx.getImageData(0, 0, width, height).data,
      width,
      height,
      tileSize: DEMO_TILE,
    };
  } catch {
    return null;
  }
}

/** Upload RGBA bytes to a canvas usable as a `CanvasImageSource`. */
export function pixelsToCanvasImage(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): CanvasImageSource | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return null;
    const data = ctx.createImageData(width, height);
    data.data.set(pixels);
    ctx.putImageData(data, 0, 0);
    return canvas;
  } catch {
    return null;
  }
}
