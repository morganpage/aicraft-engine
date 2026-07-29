/**
 * Tile-room frame composition — Phase 0 (§9.0, §9.1).
 *
 * DOM-free on purpose. The live showcase section, the headless contact-sheet
 * script, and the benchmark harness all call {@link drawTileRoomFrame}, so a
 * sheet shows the frame the showcase actually renders rather than a lookalike
 * reconstruction of it. The only host object it touches is the
 * `CanvasRenderingContext2D` handed to it, which `canvas@3` satisfies
 * structurally under Node.
 *
 * Two treatments compose the same frame:
 *
 * - `'fallback'` — today's renderer: `drawTileGrid` over the whole grid with a
 *   flat fill and a 1px outline per cell, plus `drawLevelEntity` / `drawActor`.
 *   This is the comparison baseline, and it is exactly the "generated levels
 *   look like collision geometry" state the plan is aimed at. It is kept
 *   deliberately unimproved so the Phase 2 comparison stays honest.
 * - `'terrain'` — the Phase 2 production material and connected-terrain APIs.
 *
 * Pass ownership follows §5.4: fill the backdrop, draw the background layer,
 * apply the world transform, draw terrain then the player then non-terrain
 * entities, restore, then draw the foreground layer in screen space. Canvas
 * state is balanced on exit.
 */

import {
  createLevelThemeRenderer,
  CAVERN_LEVEL_THEME,
  MECHANICAL_LEVEL_THEME,
  OUTDOOR_LEVEL_THEME,
  RUINS_LEVEL_THEME,
  drawPreparedLevelFrame,
  drawTileGrid,
  drawLevelEntity,
  drawActor,
  type PreparedLevelScene,
  type ResolvedLevelEntity,
} from '../../src/platformer';
import type { ActorCore } from '../../src/platformer';
import {
  outlineRect,
  DEFAULT_OUTLINE_COLOR,
  applySnappedTranslate,
} from '../../src/primitives';
import type { LevelData, LevelEntity, LevelRect } from '../../src/level/types';
import type { TileRoomScene } from './tile-room-fixtures';

/** Which treatment composes the frame. */
export type TileRoomTreatment =
  | 'fallback'
  | 'ruins'
  | 'cavern'
  | 'mechanical'
  | 'outdoor';

/**
 * Everything that varies frame to frame. Deliberately shaped like the
 * `LevelRenderFrame` §7.7 proposes, minus the parts Phases 1–3 deliver —
 * whether this shape carries what a real scene needs is one of the questions
 * Phase 0 exists to answer.
 */
export interface TileRoomFrame {
  /** Camera origin in world px (top-left of the view). */
  readonly camera: { readonly x: number; readonly y: number };
  /** Viewport width in CSS px. */
  readonly viewW: number;
  /** Viewport height in CSS px. */
  readonly viewH: number;
  /** Device pixel ratio, passed in — never read from the DOM here (§5.7). */
  readonly dpr: number;
  /** The player body, or `null` when no simulation is running. */
  readonly player: ActorCore | null;
  /** Runtime rectangles for moving platforms, keyed by entity id (§9.3). */
  readonly movingRects: ReadonlyMap<number, LevelRect>;
  /** Which treatment to compose with. */
  readonly treatment: TileRoomTreatment;
  /** When `true`, marker entities (spawn, trigger) are drawn — the edit/debug view (§5.6). */
  readonly showMarkers: boolean;
  /** Collected entity ids omitted from every entity-rendering pass. */
  readonly collectedEntityIds?: ReadonlySet<number>;
  /** Stable seed for coordinate-addressed visual detail. */
  readonly worldSeed: number;
  /**
   * Draw the background and foreground layers. Defaults to `true`.
   *
   * Set `false` to isolate terrain — the topology and scale contact sheets do
   * this, because atmosphere is exactly what a reviewer must *not* be looking
   * at when judging whether connected surfaces read as continuous. Layers are
   * explicit passes (§5.4), so omitting them is composition, not a special
   * rendering mode.
   */
  readonly drawLayers?: boolean;
}

/** Entity kinds that are markers rather than world geometry (§5.6). */
const MARKER_KINDS: ReadonlySet<LevelEntity['kind']> = new Set<LevelEntity['kind']>([
  'spawn',
  'trigger',
]);

/** Entity kinds this material treats as terrain roles (§7.8's terrain partition). */
const TERRAIN_ROLE_KINDS: ReadonlySet<LevelEntity['kind']> = new Set<LevelEntity['kind']>([
  'platform',
  'passthrough',
  'movingPlatform',
  'hazard',
]);

/**
 * Substitute a runtime rectangle into an entity.
 *
 * Narrowed to `movingPlatform` deliberately: it is the only kind whose drawn
 * rectangle differs from its authored one, and narrowing first keeps the
 * discriminated union intact without a cast.
 */
function withRuntimeRect(entity: LevelEntity, rect: LevelRect): LevelEntity {
  if (entity.kind === 'movingPlatform') return { ...entity, rect };
  return entity;
}

/**
 * Resolve the level's authored entities into the list to draw this frame.
 *
 * This is the consumer's job, not the renderer's (§9.3): moving platforms get
 * their runtime rectangle, and markers are dropped outside edit/debug views.
 * Every surviving entity appears exactly once — the property §14.5 asserts
 * against a full frame.
 *
 * Pure: allocates a fresh array, never mutates the level.
 *
 * @param level - the level whose authored entities are being resolved
 * @param movingRects - runtime rectangles keyed by entity id
 * @param showMarkers - include `spawn` / `trigger` markers
 * @returns the entities to draw, in authored order
 */
export function resolveTileRoomEntities(
  level: LevelData,
  movingRects: ReadonlyMap<number, LevelRect>,
  showMarkers: boolean,
  collectedEntityIds: ReadonlySet<number> = new Set(),
): readonly LevelEntity[] {
  const out: LevelEntity[] = [];
  for (const entity of level.entities) {
    if (collectedEntityIds.has(entity.id)) continue;
    if (!showMarkers && MARKER_KINDS.has(entity.kind)) continue;
    const runtime = movingRects.get(entity.id);
    out.push(runtime === undefined ? entity : withRuntimeRect(entity, runtime));
  }
  return out;
}

/**
 * Split resolved entities into the terrain pass and the non-terrain pass.
 *
 * The partition is total and disjoint by construction — every input lands in
 * exactly one output — which is what makes "drawn exactly once" checkable
 * rather than merely intended (§7.8).
 *
 * @param resolved - output of {@link resolveTileRoomEntities}
 */
export function partitionTileRoomEntities(resolved: readonly LevelEntity[]): {
  readonly terrain: readonly LevelEntity[];
  readonly other: readonly LevelEntity[];
} {
  const terrain: LevelEntity[] = [];
  const other: LevelEntity[] = [];
  for (const entity of resolved) {
    if (TERRAIN_ROLE_KINDS.has(entity.kind)) terrain.push(entity);
    else other.push(entity);
  }
  return { terrain, other };
}

// --- Fallback treatment ----------------------------------------------------

/** Fallback tile colours, matching `DEFAULT_ENTITY_PALETTE`'s platform hues. */
const FALLBACK_TILE_COLORS: Readonly<Record<number, string>> = {
  1: '#9a6a4a',
  2: '#7a9a6a',
};

/** Backdrop behind the fallback treatment. Matches the playground's stage fill. */
const FALLBACK_BACKDROP = '#120c18';

function drawFallbackTiles(ctx: CanvasRenderingContext2D, level: LevelData): void {
  drawTileGrid(ctx, level.tiles, (c, x, y, value, tileSize) => {
    const color = FALLBACK_TILE_COLORS[value];
    if (color === undefined) return;
    outlineRect(c, x, y, tileSize, tileSize, color, DEFAULT_OUTLINE_COLOR);
  });
}

// --- Production theme facade ----------------------------------------------

const TILE_ROOM_THEMES = {
  ruins: RUINS_LEVEL_THEME,
  cavern: CAVERN_LEVEL_THEME,
  mechanical: MECHANICAL_LEVEL_THEME,
  outdoor: OUTDOOR_LEVEL_THEME,
} as const;

const THEME_RENDERERS = {
  ruins: createLevelThemeRenderer(TILE_ROOM_THEMES.ruins),
  cavern: createLevelThemeRenderer(TILE_ROOM_THEMES.cavern),
  mechanical: createLevelThemeRenderer(TILE_ROOM_THEMES.mechanical),
  outdoor: createLevelThemeRenderer(TILE_ROOM_THEMES.outdoor),
} as const;

const themedSceneCaches = {
  ruins: new WeakMap<LevelData, PreparedLevelScene>(),
  cavern: new WeakMap<LevelData, PreparedLevelScene>(),
  mechanical: new WeakMap<LevelData, PreparedLevelScene>(),
  outdoor: new WeakMap<LevelData, PreparedLevelScene>(),
} as const;

function themedSceneFor(
  level: LevelData,
  treatment: Exclude<TileRoomTreatment, 'fallback'>,
): PreparedLevelScene {
  const cache = themedSceneCaches[treatment];
  const cached = cache.get(level);
  if (cached !== undefined) return cached;
  const prepared = THEME_RENDERERS[treatment].prepare(level);
  cache.set(level, prepared);
  return prepared;
}

function themedEntities(
  level: LevelData,
  movingRects: ReadonlyMap<number, LevelRect>,
  showMarkers: boolean,
  collectedEntityIds: ReadonlySet<number>,
): readonly ResolvedLevelEntity[] {
  const out: ResolvedLevelEntity[] = [];
  let hasSpawn = false;
  for (const entity of level.entities) {
    if (collectedEntityIds.has(entity.id)) continue;
    if (!showMarkers && MARKER_KINDS.has(entity.kind)) continue;
    let rect = movingRects.get(entity.id) ?? entity.rect;
    if (entity.kind === 'spawn') {
      hasSpawn = true;
      rect = {
        x: rect.x - 3,
        y: rect.y - 3,
        width: Math.max(22, rect.width + 6),
        height: Math.max(30, rect.height + 6),
      };
    }
    out.push({ entity, rect });
  }
  if (showMarkers && !hasSpawn) {
    out.push({
      entity: {
        id: -1,
        kind: 'spawn',
        rect: { x: level.spawn.x, y: level.spawn.y, width: 16, height: 16 },
        props: {},
      },
      rect: { x: level.spawn.x - 3, y: level.spawn.y - 3, width: 22, height: 30 },
    });
  }
  return out;
}

// --- Frame composition -----------------------------------------------------

/**
 * Draw one complete tile-room frame.
 *
 * The caller owns the canvas's base transform (typically `ctx.scale(dpr, dpr)`
 * applied once at setup); this function saves and restores around the world
 * pass and leaves no Canvas state behind.
 *
 * @param ctx - the 2D context to draw into
 * @param scene - the scene being rendered
 * @param frame - per-frame state (camera, player, runtime rects, treatment)
 */
export function drawTileRoomFrame(
  ctx: CanvasRenderingContext2D,
  scene: TileRoomScene,
  frame: TileRoomFrame,
): void {
  const { level } = scene;
  const terrainTreatment = frame.treatment !== 'fallback';
  const collectedEntityIds = frame.collectedEntityIds ?? new Set<number>();
  const resolved = resolveTileRoomEntities(
    level,
    frame.movingRects,
    frame.showMarkers,
    collectedEntityIds,
  );
  const { terrain, other } = partitionTileRoomEntities(resolved);

  if (terrainTreatment) {
    const prepared = themedSceneFor(level, frame.treatment);
    const themedFrame = {
      level,
      devicePixelRatio: frame.dpr,
      view: { x: frame.camera.x, y: frame.camera.y, width: frame.viewW, height: frame.viewH },
      entities: themedEntities(
        level,
        frame.movingRects,
        frame.showMarkers,
        collectedEntityIds,
      ),
      tick: 0,
      mode: frame.showMarkers ? 'edit' : 'play',
    } as const;
    if (frame.drawLayers === false) {
      ctx.fillStyle = TILE_ROOM_THEMES[frame.treatment].backgroundColor;
      ctx.fillRect(0, 0, frame.viewW, frame.viewH);
      ctx.save();
      applySnappedTranslate(ctx, -frame.camera.x, -frame.camera.y, frame.dpr);
      prepared.drawTerrainTiles(ctx, themedFrame);
      prepared.drawTerrainRects(ctx, themedFrame);
      if (frame.player !== null) drawActor(ctx, frame.player);
      prepared.drawEntities(ctx, themedFrame);
      ctx.restore();
      return;
    }
    drawPreparedLevelFrame(ctx, prepared, themedFrame, {
      drawWorld(worldCtx) {
        if (frame.player !== null) drawActor(worldCtx, frame.player);
      },
    });
    return;
  }

  ctx.fillStyle = FALLBACK_BACKDROP;
  ctx.fillRect(0, 0, frame.viewW, frame.viewH);
  ctx.save();
  ctx.translate(-Math.round(frame.camera.x), -Math.round(frame.camera.y));
  drawFallbackTiles(ctx, level);
  for (const entity of terrain) drawLevelEntity(ctx, entity);

  if (frame.player !== null) drawActor(ctx, frame.player);

  let drewSpawnMarker = false;
  for (const entity of other) {
    if (entity.kind === 'spawn') {
      drewSpawnMarker = true;
      // The authored spawn overlaps the player by definition. Expand its
      // editor outline so toggling markers remains visible around the actor.
      drawLevelEntity(ctx, {
        ...entity,
        rect: {
          x: entity.rect.x - 3,
          y: entity.rect.y - 3,
          width: Math.max(22, entity.rect.width + 6),
          height: Math.max(30, entity.rect.height + 6),
        },
      });
    } else {
      drawLevelEntity(ctx, entity);
    }
  }
  // Generated levels carry `level.spawn` but do not necessarily contain a
  // spawn entity. Marker mode still needs an observable result in that scene.
  if (frame.showMarkers && !drewSpawnMarker) {
    drawLevelEntity(ctx, {
      id: -1,
      kind: 'spawn',
      rect: {
        x: level.spawn.x - 3,
        y: level.spawn.y - 3,
        width: 22,
        height: 30,
      },
      props: {},
    });
  }

  ctx.restore();

}
