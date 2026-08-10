/**
 * Platformer renderer helpers (renderer-adjacent layer).
 *
 * Sensible-default drawing functions for `LevelEntity` (dispatched per
 * `kind`) and for an actor's `ActorCore` (single outlined rect). Touches
 * only the `CanvasRenderingContext2D` passed in by the caller — no global
 * state, no DOM reads. Per-kind override hooks let the consumer take over
 * drawing for any subset of kinds without forking the whole dispatcher.
 *
 * The renderer is intentionally minimalist: flat fills, 1px outlines, dashed
 * outlines for non-solid entities. Consumers with skeletal rigs should
 * ignore `drawActor` and use `drawRig` from `../animation/skin` instead.
 *
 * @module
 */

import type { LevelEntity, EntityKind } from '../level/types';
import type { ActorCore } from './types';
import { outlineRect, DEFAULT_OUTLINE_COLOR } from '../primitives/outline-rect';

/**
 * Color palette for the default per-kind renderer. All hex strings. Override
 * individual entries by passing a partial palette to `drawLevelEntity` /
 * `drawActor`; the override is spread over {@link DEFAULT_ENTITY_PALETTE}.
 */
export interface EntityPalette {
  /** Spawn-point marker color. */
  readonly spawn?: string;
  /** Exit marker color. */
  readonly exit?: string;
  /** Fully-solid static platform color. */
  readonly platform?: string;
  /** One-way passthrough platform color. */
  readonly passthrough?: string;
  /** Discrete trap color. */
  readonly trap?: string;
  /** Hazard (lava, spikes) color. */
  readonly hazard?: string;
  /** Decoration / prop color. */
  readonly decoration?: string;
  /** Trigger zone color. */
  readonly trigger?: string;
  /** Moving-platform color. */
  readonly movingPlatform?: string;
  /** Enemy color. */
  readonly enemy?: string;
  /** Coin collectible color (gold). */
  readonly collectibleCoin?: string;
  /** Gem collectible color (blue). */
  readonly collectibleGem?: string;
  /** Key collectible color (silver). */
  readonly collectibleKey?: string;
  /** Default player body color. */
  readonly player?: string;
}

/**
 * Default entity palette. Tuned for high-contrast, color-blind-friendly
 * silhouette reads against the typical near-black outline (`#1d1128`).
 *
 * - `spawn`: bright green (`#7aff7a`) — friendly start marker.
 * - `exit`: warm yellow (`#ffe066`) — goal / reach-the-end.
 * - `platform`: earthy brown (`#9a6a4a`) — solid ground.
 * - `passthrough`: muted green-brown (`#7a9a6a`) — distinct from solid.
 * - `trap`: dark purple (`#5a3a5a`) — ominous.
 * - `hazard`: red (`#ff3a3a`) — danger.
 * - `decoration`: muted purple (`#6a5a7a`) — recedes.
 * - `trigger`: teal (`#3a7a7a`) — invisible-ish.
 * - `movingPlatform`: steel blue (`#5a7a9a`) — mechanical.
 * - `player`: warm orange (`#fe5701`).
 */
export const DEFAULT_ENTITY_PALETTE: Readonly<EntityPalette> = {
  spawn: '#7aff7a',
  exit: '#ffe066',
  platform: '#9a6a4a',
  passthrough: '#7a9a6a',
  trap: '#5a3a5a',
  hazard: '#ff3a3a',
  decoration: '#6a5a7a',
  trigger: '#3a7a7a',
  movingPlatform: '#5a7a9a',
  enemy: '#ff3a3a',
  player: '#fe5701',
  // Collectible sub-kind palette — all values WCAG AA against
  // `DEFAULT_OUTLINE_COLOR` (`#1d1128`, the library background):
  //   coin (#ffd700) → 12.5:1 contrast (gold)
  //   gem  (#4a9eff) → 5.2:1  contrast (blue)
  //   key  (#c0c0c0) → 9.8:1  contrast (silver)
  // All three ≥ 4.5:1 AA. Verified by `@architect` in
  // `docs/design/collectibles-proposal.md` (open question 4).
  collectibleCoin: '#ffd700',
  collectibleGem: '#4a9eff',
  collectibleKey: '#c0c0c0',
};

/**
 * Per-kind override hooks. Each callback receives the `ctx` and the entity;
 * return `true` to indicate the override handled drawing (the default is
 * skipped), or `false` to fall through to the default renderer.
 */
export interface DrawLevelEntityOverrideMap {
  /** Override for `spawn` entities. */
  readonly spawn?: (ctx: CanvasRenderingContext2D, entity: LevelEntity) => boolean;
  /** Override for `exit` entities. */
  readonly exit?: (ctx: CanvasRenderingContext2D, entity: LevelEntity) => boolean;
  /** Override for `platform` entities. */
  readonly platform?: (ctx: CanvasRenderingContext2D, entity: LevelEntity) => boolean;
  /** Override for `passthrough` entities. */
  readonly passthrough?: (ctx: CanvasRenderingContext2D, entity: LevelEntity) => boolean;
  /** Override for `trap` entities. */
  readonly trap?: (ctx: CanvasRenderingContext2D, entity: LevelEntity) => boolean;
  /** Override for `hazard` entities. */
  readonly hazard?: (ctx: CanvasRenderingContext2D, entity: LevelEntity) => boolean;
  /** Override for `decoration` entities. */
  readonly decoration?: (ctx: CanvasRenderingContext2D, entity: LevelEntity) => boolean;
  /** Override for `trigger` entities. */
  readonly trigger?: (ctx: CanvasRenderingContext2D, entity: LevelEntity) => boolean;
  /** Override for `movingPlatform` entities. */
  readonly movingPlatform?: (ctx: CanvasRenderingContext2D, entity: LevelEntity) => boolean;
  /** Override for `enemy` entities. */
  readonly enemy?: (ctx: CanvasRenderingContext2D, entity: LevelEntity) => boolean;
  /** Override for `collectible` entities. */
  readonly collectible?: (ctx: CanvasRenderingContext2D, entity: LevelEntity) => boolean;
}

/**
 * Options for {@link drawLevelEntity}.
 */
export interface DrawLevelEntityOptions {
  /** Palette override (spread over {@link DEFAULT_ENTITY_PALETTE}). */
  readonly palette?: EntityPalette;
  /** Per-kind override. Return `true` if you handled drawing; `false` to fall through to the default. */
  readonly drawOverride?: DrawLevelEntityOverrideMap;
}

/**
 * Kinds rendered with a solid-feeling flat fill + 1px outline via `outlineRect`.
 * Traps are grouped here because they're discrete in-world obstacles, even
 * though they're not collision surfaces in the kernel.
 */
const SOLID_FEELING_KINDS: ReadonlySet<EntityKind> = new Set<EntityKind>([
  'platform',
  'passthrough',
  'movingPlatform',
  'hazard',
  'trap',
  'enemy',
]);

/**
 * Kinds rendered with a thin dashed outline (no fill). These are non-tangible
 * editor / event entities — the dashed treatment signals "this is a marker,
 * not real geometry".
 */
const DASHED_KINDS: ReadonlySet<EntityKind> = new Set<EntityKind>([
  'spawn',
  'exit',
  'trigger',
  'decoration',
]);

/** Dash pattern applied (and reset) for non-solid kinds. */
const DASH_PATTERN: readonly number[] = [3, 3];

/**
 * Draw a single `LevelEntity` by switching on `entity.kind`. Uses
 * `outlineRect` for solid-feeling entities (`platform`, `movingPlatform`,
 * `hazard`, `trap`) and a thinner dashed outline for non-solid marker
 * entities (`spawn`, `exit`, `trigger`, `decoration`). The consumer's
 * per-kind override (if provided) runs first; returning `true` skips the
 * default.
 *
 * Touches only the passed `ctx`; no global state, no DOM reads. Never
 * throws — unknown kinds are silently skipped; a throwing override is
 * swallowed and falls through to the default.
 *
 * @param ctx - the canvas 2D context (caller owns transform/state)
 * @param entity - the entity to draw
 * @param options - optional palette / per-kind override
 */
export function drawLevelEntity(
  ctx: CanvasRenderingContext2D,
  entity: LevelEntity,
  options?: DrawLevelEntityOptions,
): void {
  const palette: EntityPalette = {
    ...DEFAULT_ENTITY_PALETTE,
    ...(options?.palette ?? {}),
  };

  const override = options?.drawOverride?.[entity.kind];
  if (override) {
    try {
      if (override(ctx, entity)) return;
    } catch {
      // Swallow; fall through to the default rendering.
    }
  }

  // Collectibles dispatch on the sub-kind via dedicated palette keys
  // (`collectibleCoin` / `collectibleGem` / `collectibleKey`). TS's
  // discriminated-union narrowing on `entity.kind === 'collectible'`
  // resolves `props` to `CollectibleProps` here so the `props.kind`
  // access is type-safe. Draws a single flat fillRect (NO outline) so
  // collectibles render as pickable markers, not architectural solids.
  if (entity.kind === 'collectible') {
    const sub = entity.props.kind;
    const colorKey =
      sub === 'coin' ? 'collectibleCoin' :
      sub === 'gem'  ? 'collectibleGem'  :
      sub === 'key'  ? 'collectibleKey'  :
      null;
    if (colorKey === null) return;
    const color = palette[colorKey];
    if (color === undefined) return;
    ctx.fillStyle = color;
    ctx.fillRect(entity.rect.x, entity.rect.y, entity.rect.width, entity.rect.height);
    return;
  }

  const color = palette[entity.kind];
  if (color === undefined) return;

  const r = entity.rect;

  if (SOLID_FEELING_KINDS.has(entity.kind)) {
    outlineRect(ctx, r.x, r.y, r.width, r.height, color, DEFAULT_OUTLINE_COLOR);
    return;
  }

  if (DASHED_KINDS.has(entity.kind)) {
    drawDashedOutline(ctx, r.x, r.y, r.width, r.height, color);
    return;
  }

  // Unknown kind — silently skip.
}

/**
 * Draw a thin dashed outline (no fill). Sets `setLineDash([3, 3])` and
 * resets it to `[]` afterward so the dash doesn't leak to subsequent draws.
 * Coordinates are floored + inset by 0.5px to land on the pixel grid.
 */
function drawDashedOutline(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
): void {
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  const fw = Math.max(0, Math.floor(w) - 1);
  const fh = Math.max(0, Math.floor(h) - 1);
  ctx.setLineDash([...DASH_PATTERN]);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.strokeRect(fx + 0.5, fy + 0.5, fw, fh);
  ctx.setLineDash([]);
}

/**
 * Draw an actor (player) as a single outlined rect at the core's position.
 * The minimalist fallback — consumers with skeletal rigs should ignore this
 * and use `drawRig` from `../animation/skin` instead.
 *
 * Touches only the passed `ctx`. Never throws.
 *
 * @param ctx - the canvas 2D context (caller owns transform/state)
 * @param core - the actor core (position, dimensions)
 * @param options - optional palette override for the player color
 */
export function drawActor(
  ctx: CanvasRenderingContext2D,
  core: ActorCore,
  options?: { readonly palette?: EntityPalette },
): void {
  const palette: EntityPalette = {
    ...DEFAULT_ENTITY_PALETTE,
    ...(options?.palette ?? {}),
  };
  const color = palette.player ?? DEFAULT_OUTLINE_COLOR;
  outlineRect(ctx, core.x, core.y, core.width, core.height, color, DEFAULT_OUTLINE_COLOR);
}

/**
 * Draw a level's tile grid by sampling each cell and calling `drawTile` per
 * cell. The consumer provides a `drawTile(ctx, x, y, tileValue, tileSize)`
 * callback that owns the actual rendering (sprites, colors, etc.).
 *
 * Tiles with value `0` are skipped by default (convention: empty cell). Pass
 * `{ includeZeros: true }` to also visit zero cells (e.g. for debug overlays).
 *
 * For large levels, prefer calling `drawTile` only for tiles inside the
 * camera viewport — this helper iterates every `cols × rows` cell.
 *
 * Touches only the passed `ctx` (the consumer's `drawTile` callback owns its
 * own drawing). Never throws; malformed grids and throwing callbacks are
 * silently skipped.
 *
 * @param ctx - the canvas 2D context (caller owns transform/state)
 * @param grid - the tile grid (`data`, `cols`, `rows`, `tileSize`)
 * @param drawTile - per-cell drawing callback
 * @param options - optional flags (e.g. `{ includeZeros: true }`)
 */
export function drawTileGrid(
  ctx: CanvasRenderingContext2D,
  grid: {
    readonly data: readonly number[];
    readonly cols: number;
    readonly rows: number;
    readonly tileSize: number;
  },
  drawTile: (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    tileValue: number,
    tileSize: number,
  ) => void,
  options?: { readonly includeZeros?: boolean },
): void {
  const includeZeros = options?.includeZeros ?? false;
  const cols = grid.cols;
  const rows = grid.rows;
  const tileSize = grid.tileSize;
  if (!Number.isFinite(cols) || !Number.isFinite(rows) || !Number.isFinite(tileSize)) return;
  if (cols <= 0 || rows <= 0 || tileSize <= 0) return;
  if (!Array.isArray(grid.data)) return;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const idx = row * cols + col;
      const value = grid.data[idx];
      if (value === undefined) continue;
      if (value === 0 && !includeZeros) continue;
      const x = col * tileSize;
      const y = row * tileSize;
      try {
        drawTile(ctx, x, y, value, tileSize);
      } catch {
        // Swallow — one bad tile callback must not abort the whole grid.
      }
    }
  }
}
