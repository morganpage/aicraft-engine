/**
 * Editor canvas rendering: the level, plus the overlays that make it editable.
 *
 * The level itself is drawn by the library's own `drawLdtkLevel`, so what the
 * editor shows is literally what a game would render — no editor-only
 * approximation that could disagree with the runtime.
 */

import {
  drawLdtkLevel,
  type LdtkEntityDef,
  type LdtkEntityInstance,
  type LdtkLevel,
  type LdtkTilesetBundle,
} from '../../../src/ldtk';
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
  entityLabel: 'rgba(255, 255, 255, 0.9)',
  entityLabelShadow: 'rgba(0, 0, 0, 0.75)',
  entityOutline: 'rgba(0, 0, 0, 0.65)',
  entitySelected: '#ffd24e',
  entityGhost: 'rgba(255, 210, 78, 0.45)',
} as const;

/**
 * One drawable entity, pre-resolved against the project's entity defs so the
 * renderer does not need to look anything up per frame. The editor builds these
 * once per render from the active Entities layer.
 */
export interface EntityDrawEntry {
  readonly entity: LdtkEntityInstance;
  /** Resolved def, for color/render-mode/size. `undefined` if unknown. */
  readonly def: LdtkEntityDef | undefined;
  /** True when this is the editor's current selection. */
  readonly selected: boolean;
}

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
  /**
   * Entities to draw as editor chrome over the tile art. The runtime renderer
   * skips Entities layers by design (entities spawn from translated data), so
   * the editor overlays them itself — a colored rect or display tile, an
   * identifier label, and a selection highlight.
   */
  readonly entities?: readonly EntityDrawEntry[];
  /**
   * Instance iids whose body fill the editor should NOT draw (outline, label,
   * and selection still render). Used by the animated-mob overlay so a mob the
   * overlay is blitting as a sprite does not also show its static rect beneath.
   */
  readonly skipEntityIids?: ReadonlySet<string>;
  /**
   * Where a pending entity placement would land, in level pixels. Drawn as a
   * ghost so the author sees the footprint before committing.
   */
  readonly entityGhost?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
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

    if (options.entities !== undefined && options.entities.length > 0) {
      drawEntities(context, options.entities, options.tilesets, view, options.skipEntityIids);
    }
    if (options.entityGhost !== undefined) drawEntityGhost(context, options.entityGhost);

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

/** Default entity color when the def or its color is unavailable. */
const ENTITY_FALLBACK_COLOR = '#7a8699';

/**
 * The top-left corner of an entity's rect in world pixels.
 *
 * LDtk stores `px` as the position of the entity's *pivot point*, not its
 * top-left: an entity with a bottom-centre pivot `[0.5, 1]` has its `px` at the
 * middle of its bottom edge. To draw the rect we back up from `px` by the
 * pivot's fraction of the size. Getting this wrong is exactly what makes
 * entities render too low (a `pivotY: 1` entity draws a full height beneath its
 * real position).
 */
function entityTopLeft(entity: Readonly<LdtkEntityInstance>): { x: number; y: number } {
  const pivotX = entity.__pivot[0] ?? 0;
  const pivotY = entity.__pivot[1] ?? 0;
  return {
    x: entity.px[0] - pivotX * entity.width,
    y: entity.px[1] - pivotY * entity.height,
  };
}

/**
 * Draw entities as editor chrome.
 *
 * Each entity is a translucent rect in its def color (or its display tile when
 * one is set and the tileset is loaded), plus an identifier label above and a
 * crisp outline. The selection gets a solid highlight stroke. Tile art already
 * drawn by `drawLdtkLevel` is left untouched; this only adds the entity layer
 * the runtime renderer omits.
 */
function drawEntities(
  context: CanvasRenderingContext2D,
  entries: readonly EntityDrawEntry[],
  tilesets: LdtkTilesetBundle,
  view: Readonly<{ x: number; y: number; width: number; height: number }>,
  skipEntityIids?: ReadonlySet<string>,
): void {
  const labelHeight = 11;
  context.save();
  try {
    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
    for (const entry of entries) {
      const { entity, def } = entry;
      // `px` is the pivot, not the corner — convert to the draw origin.
      const origin = entityTopLeft(entity);
      const x = origin.x;
      const y = origin.y;
      // Cull entities whose rect sits entirely outside the viewport — large
      // levels place hundreds of entities and drawing off-screen ones wastes a
      // frame budget.
      if (x + entity.width < view.x || y + entity.height < view.y) continue;
      if (x > view.x + view.width || y > view.y + view.height) continue;

      // The animated-mob overlay blits these as sprites; skip the static body
      // (rect fill or display tile) so it does not show through. The outline,
      // label, and selection highlight still draw, so the entity remains
      // selectable and labeled on the Entities layer.
      const bodySkipped = skipEntityIids !== undefined && skipEntityIids.has(entity.iid);

      // Display tile when the def provides one and the tileset is loaded.
      const tilesetUid = def?.tileRect?.tilesetUid ?? null;
      const tileImage = tilesetUid === null ? undefined : tilesets.get(tilesetUid)?.image;
      if (!bodySkipped && def?.tileRect !== null && def?.tileRect !== undefined && tileImage !== undefined) {
        context.globalAlpha = 0.96;
        try {
          context.drawImage(
            tileImage,
            def.tileRect.x, def.tileRect.y, def.tileRect.w, def.tileRect.h,
            x, y, entity.width, entity.height,
          );
        } catch {
          // A bad draw (e.g. zero-size image) should not abort the remaining
          // entities; fall through to the rect fill.
          context.fillStyle = def?.color ?? ENTITY_FALLBACK_COLOR;
          context.fillRect(x, y, entity.width, entity.height);
        }
      } else if (!bodySkipped) {
        context.globalAlpha = 0.7;
        context.fillStyle = def?.color ?? ENTITY_FALLBACK_COLOR;
        context.fillRect(x, y, entity.width, entity.height);
      }
      context.globalAlpha = 1;

      // Outline + label.
      context.lineWidth = 1;
      context.strokeStyle = EDITOR_PALETTE.entityOutline;
      context.strokeRect(x + 0.5, y + 0.5, entity.width - 1, entity.height - 1);

      if (entity.width >= 8 && entity.height >= 4) {
        context.font = '10px ui-monospace, monospace';
        const label = entity.__identifier;
        const baseline = Math.max(labelHeight, y - 2);
        context.fillStyle = EDITOR_PALETTE.entityLabelShadow;
        context.fillText(label, x + 1, baseline + 1);
        context.fillStyle = EDITOR_PALETTE.entityLabel;
        context.fillText(label, x, baseline);
      }

      if (entry.selected) {
        context.lineWidth = 2;
        context.strokeStyle = EDITOR_PALETTE.entitySelected;
        context.strokeRect(x - 1, y - 1, entity.width + 2, entity.height + 2);
      }
    }
  } finally {
    context.restore();
  }
}

/** Draw the footprint of a pending placement so it is visible before commit. */
function drawEntityGhost(
  context: CanvasRenderingContext2D,
  ghost: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
): void {
  context.save();
  try {
    context.fillStyle = EDITOR_PALETTE.entityGhost;
    context.fillRect(ghost.x, ghost.y, ghost.width, ghost.height);
    context.lineWidth = 1;
    context.strokeStyle = EDITOR_PALETTE.entitySelected;
    context.setLineDash([3, 3]);
    context.strokeRect(ghost.x + 0.5, ghost.y + 0.5, ghost.width - 1, ghost.height - 1);
    context.setLineDash([]);
  } finally {
    context.restore();
  }
}
