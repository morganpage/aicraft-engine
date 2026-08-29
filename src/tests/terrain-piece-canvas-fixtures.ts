/**
 * Canvas-backed fixtures for the TE.2 prototype.
 *
 * Builds a synthetic 4-tile sheet where each tile is one flat, distinct colour,
 * then packs it through the real `buildTerrainArtRuleAtlas` and uploads it to a
 * node-canvas image. Flat colours mean a baked piece can be asserted
 * **pixel-exactly** — "cell 0 is green" is a far stronger claim than "some
 * tiles were drawn".
 *
 * `canvas` is already a devDependency and is never imported from `src/`; this
 * file lives under `src/tests/`, which never enters `dist`.
 *
 * @module
 */

import { createCanvas, createImageData } from 'canvas';
import { buildTerrainArtRuleAtlas, type TerrainArtRuleAtlas } from '../terrain-art/rule-atlas';
import type { TerrainTilesetSource } from '../terrain-art/import-tileset';
import { STRIP_RULE_SET } from './terrain-piece-fixtures';
import type { TerrainPieceCanvas } from '../terrain-art/piece-render';

export const TILE = 16;

/** RGB per rule index, aligned with `RULE_NAMES` in `fixtures.ts`. */
export const TILE_COLORS = [
  [255, 0, 0],     // 0 single    — red
  [0, 255, 0],     // 1 left-end  — green
  [0, 0, 255],     // 2 right-end — blue
  [255, 255, 255], // 3 middle    — white
] as const;

/** A 4×1 sheet of flat colour tiles: `[single, left-end, right-end, middle]`. */
export function createStripTilesetSource(): TerrainTilesetSource {
  const width = TILE * TILE_COLORS.length;
  const height = TILE;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = TILE_COLORS[Math.floor(x / TILE)] ?? [0, 0, 0];
      const i = (y * width + x) * 4;
      pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b; pixels[i + 3] = 255;
    }
  }
  return { pixels, width, height, tileSize: TILE };
}

/** Upload RGBA bytes to a node-canvas image usable as a `CanvasImageSource`. */
export function pixelsToImage(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): CanvasImageSource {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  // Copy into a fresh buffer — node-canvas's ImageData takes ownership.
  context.putImageData(createImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
  return canvas as unknown as CanvasImageSource;
}

/** The strip atlas plus its drawable image — what `bakeTerrainPiece` needs. */
export function createStripAtlas(): { atlas: TerrainArtRuleAtlas; image: CanvasImageSource } {
  const atlas = buildTerrainArtRuleAtlas(createStripTilesetSource(), STRIP_RULE_SET.rules);
  return { atlas, image: pixelsToImage(atlas.pixels, atlas.width, atlas.height) };
}

/** node-canvas factory, in the shape `bakeTerrainPiece` expects. */
export const nodeCanvasFactory = (width: number, height: number): TerrainPieceCanvas =>
  createCanvas(width, height) as unknown as TerrainPieceCanvas;

/** Read one pixel as `[r,g,b,a]` from a baked piece. */
export function pixelAt(canvas: TerrainPieceCanvas, x: number, y: number): number[] {
  const context = canvas.getContext('2d');
  if (context === null) return [0, 0, 0, 0];
  return Array.from(context.getImageData(x, y, 1, 1).data);
}

/** All bytes of a baked canvas — for byte-identity comparisons. */
export function canvasBytes(canvas: TerrainPieceCanvas): Uint8ClampedArray {
  const context = canvas.getContext('2d');
  if (context === null) return new Uint8ClampedArray(0);
  return context.getImageData(0, 0, canvas.width, canvas.height).data;
}

/** A blank destination canvas to draw clipped pieces onto. */
export function createTargetCanvas(width: number, height: number): TerrainPieceCanvas {
  return createCanvas(width, height) as unknown as TerrainPieceCanvas;
}

export interface OpaqueBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly empty: boolean;
}

/**
 * Bounding box of every non-transparent pixel. This is how "visible extent" is
 * measured: not from the numbers the helper was handed, but from what actually
 * landed on the destination canvas.
 */
export function opaqueBounds(canvas: TerrainPieceCanvas): OpaqueBounds {
  const context = canvas.getContext('2d');
  if (context === null) return { x: 0, y: 0, width: 0, height: 0, empty: true };
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      if ((data[(y * canvas.width + x) * 4 + 3] ?? 0) === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (minX === Infinity) return { x: 0, y: 0, width: 0, height: 0, empty: true };
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1, empty: false };
}
