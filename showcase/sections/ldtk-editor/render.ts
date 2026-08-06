/**
 * Editor canvas rendering: the level, plus the overlays that make it editable.
 *
 * The level itself is drawn by the library's own `drawLdtkLevel`, so what the
 * editor shows is literally what a game would render — no editor-only
 * approximation that could disagree with the runtime.
 */

import { drawLdtkLevel, type LdtkLevel, type LdtkTilesetBundle } from '../../../src/ldtk';
import type { Viewport } from './viewport';

/** Colors for editor chrome. Kept together so nothing hard-codes a hex. */
export const EDITOR_PALETTE = {
  background: '#12161c',
  outOfBounds: '#0b0e12',
  levelBorder: '#3d4a5c',
  grid: 'rgba(255, 255, 255, 0.07)',
  gridStrong: 'rgba(255, 255, 255, 0.16)',
  cursor: 'rgba(255, 255, 255, 0.85)',
  preview: 'rgba(120, 200, 255, 0.55)',
  intGridAlpha: 0.55,
} as const;

/** Everything a frame needs. */
export interface RenderSceneOptions {
  readonly level: LdtkLevel;
  readonly tilesets: LdtkTilesetBundle;
  readonly viewport: Viewport;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  /** Draw the cell grid. */
  readonly showGrid: boolean;
  /**
   * IntGrid values to tint over the art, with their display colors. Lets an
   * author see collision they are painting even where the art hides it.
   */
  readonly intGridOverlay?: {
    readonly csv: readonly number[];
    readonly cols: number;
    readonly rows: number;
    readonly gridSize: number;
    readonly colorOf: (value: number) => string | undefined;
  };
  /** Cells the pending gesture would affect. */
  readonly previewCells?: readonly { readonly cx: number; readonly cy: number }[];
  /** Cell under the pointer. */
  readonly cursorCell?: { readonly cx: number; readonly cy: number };
  /** Cell size for cursor/preview drawing. */
  readonly gridSize: number;
}

/**
 * Draw one editor frame.
 *
 * Never throws: a malformed level or a missing tileset degrades to empty space
 * rather than tearing down the render loop.
 */
export function renderEditorScene(
  context: CanvasRenderingContext2D,
  options: Readonly<RenderSceneOptions>,
): void {
  const { viewport, canvasWidth, canvasHeight, level } = options;

  context.imageSmoothingEnabled = false;
  context.fillStyle = EDITOR_PALETTE.outOfBounds;
  context.fillRect(0, 0, canvasWidth, canvasHeight);

  context.save();
  try {
    context.scale(viewport.scale, viewport.scale);
    context.translate(-viewport.x, -viewport.y);

    // The level's own extent, so out-of-bounds reads as outside the level
    // rather than as empty level.
    context.fillStyle = EDITOR_PALETTE.background;
    context.fillRect(0, 0, level.pxWid, level.pxHei);

    const view = {
      x: viewport.x,
      y: viewport.y,
      width: canvasWidth / viewport.scale,
      height: canvasHeight / viewport.scale,
    };
    drawLdtkLevel(context, level, { tilesets: options.tilesets, view });

    if (options.intGridOverlay !== undefined) drawIntGridOverlay(context, options.intGridOverlay);
    if (options.showGrid) drawGrid(context, level, options.gridSize, viewport, view);

    drawPreview(context, options);

    context.lineWidth = 1 / viewport.scale;
    context.strokeStyle = EDITOR_PALETTE.levelBorder;
    context.strokeRect(0.5 / viewport.scale, 0.5 / viewport.scale, level.pxWid, level.pxHei);
  } catch {
    // A draw failure must not kill the loop; the next frame retries.
  } finally {
    context.restore();
  }
}

/** Tint cells by their IntGrid value. */
function drawIntGridOverlay(
  context: CanvasRenderingContext2D,
  overlay: NonNullable<RenderSceneOptions['intGridOverlay']>,
): void {
  const previous = context.globalAlpha;
  context.globalAlpha = EDITOR_PALETTE.intGridAlpha;
  for (let cy = 0; cy < overlay.rows; cy++) {
    for (let cx = 0; cx < overlay.cols; cx++) {
      const value = overlay.csv[cx + cy * overlay.cols] ?? 0;
      if (value === 0) continue;
      const color = overlay.colorOf(value);
      if (color === undefined) continue;
      context.fillStyle = color;
      context.fillRect(cx * overlay.gridSize, cy * overlay.gridSize, overlay.gridSize, overlay.gridSize);
    }
  }
  context.globalAlpha = previous;
}

/**
 * Draw the cell grid, but only where it would be legible.
 *
 * Below roughly four screen pixels per cell the lines merge into a haze that
 * obscures the art, so the grid drops out rather than becoming noise.
 */
function drawGrid(
  context: CanvasRenderingContext2D,
  level: LdtkLevel,
  gridSize: number,
  viewport: Viewport,
  view: Readonly<{ x: number; y: number; width: number; height: number }>,
): void {
  if (gridSize <= 0) return;
  if (gridSize * viewport.scale < 4) return;

  const left = Math.max(0, Math.floor(view.x / gridSize) * gridSize);
  const top = Math.max(0, Math.floor(view.y / gridSize) * gridSize);
  const right = Math.min(level.pxWid, view.x + view.width);
  const bottom = Math.min(level.pxHei, view.y + view.height);

  context.lineWidth = 1 / viewport.scale;
  context.beginPath();
  for (let x = left; x <= right; x += gridSize) {
    context.moveTo(x, Math.max(0, view.y));
    context.lineTo(x, bottom);
  }
  for (let y = top; y <= bottom; y += gridSize) {
    context.moveTo(Math.max(0, view.x), y);
    context.lineTo(right, y);
  }
  context.strokeStyle = EDITOR_PALETTE.grid;
  context.stroke();
}

/** Outline the cells a gesture would affect, plus the cursor cell. */
function drawPreview(
  context: CanvasRenderingContext2D,
  options: Readonly<RenderSceneOptions>,
): void {
  const size = options.gridSize;
  if (size <= 0) return;
  const lineWidth = 1 / options.viewport.scale;

  const preview = options.previewCells;
  if (preview !== undefined && preview.length > 0) {
    context.fillStyle = EDITOR_PALETTE.preview;
    for (const cell of preview) {
      context.fillRect(cell.cx * size, cell.cy * size, size, size);
    }
  }

  const cursor = options.cursorCell;
  if (cursor !== undefined) {
    context.lineWidth = lineWidth;
    context.strokeStyle = EDITOR_PALETTE.cursor;
    context.strokeRect(
      cursor.cx * size + lineWidth / 2,
      cursor.cy * size + lineWidth / 2,
      size - lineWidth,
      size - lineWidth,
    );
  }
}
