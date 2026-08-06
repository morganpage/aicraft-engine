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
import {
  drawPreparedTerrainArtDualGrid,
  type PreparedTerrainArtDualGrid,
  type TerrainArtPixelAtlas,
  type TerrainArtVisualHit,
} from '../../src/terrain-art';
import type { TileRoomScene } from './tile-room-fixtures';

/** Which treatment composes the frame. */
export type TileRoomTreatment =
  | 'fallback'
  | 'ruins'
  | 'cavern'
  | 'mechanical'
  | 'outdoor'
  | 'dual-grid';

/** Prepared art and optional inspector selection for the dual-grid treatment. */
export interface TileRoomDualGridFrame {
  readonly prepared: Readonly<PreparedTerrainArtDualGrid>;
  readonly atlas: Readonly<TerrainArtPixelAtlas>;
  readonly image: CanvasImageSource;
  readonly additional?: readonly { readonly atlas: Readonly<TerrainArtPixelAtlas>; readonly image: CanvasImageSource }[];
  readonly selection: Readonly<TerrainArtVisualHit> | null;
  readonly showDualGrid?: boolean;
  readonly showLogicalGrid?: boolean;
  readonly highlightMatches?: boolean;
  readonly occurrence?: { readonly dualX: number; readonly dualY: number; readonly image: CanvasImageSource };
  /** Logical cells currently under an uncommitted level-paint gesture. */
  readonly paintPreview?: {
    readonly cells: readonly { readonly col: number; readonly row: number }[];
    readonly behavior: 'paint' | 'erase';
    readonly cursor: { readonly col: number; readonly row: number };
  };
  /** Uncommitted moving-platform rectangle and its default/translated path. */
  readonly movingPlatformPreview?: {
    readonly rect: Readonly<LevelRect>;
    readonly path: readonly { readonly x: number; readonly y: number }[];
    readonly mode: 'create' | 'move';
  };
  /** Persistent route editor for the selected authored moving platform. */
  readonly movingPlatformWidget?: {
    readonly rect: Readonly<LevelRect>;
    readonly path: readonly { readonly x: number; readonly y: number }[];
    readonly activeWaypoint?: number;
  };
  /** Authored object selected by the general object-properties workflow. */
  readonly selectedEntity?: Readonly<LevelEntity>;
  /** Uncommitted spike strip, or a delete selection with matching strips. */
  readonly spikePreview?: {
    readonly rect: Readonly<LevelRect>;
    readonly mode: 'create' | 'delete';
    readonly targets: readonly Readonly<LevelRect>[];
  };
  /** Ghost or hover treatment for place/move/delete object tools. */
  readonly entityPreview?: {
    readonly entity: Readonly<LevelEntity>;
    readonly mode: 'place' | 'move' | 'delete';
  };
}

function drawSpikeStrip(
  ctx: CanvasRenderingContext2D,
  rect: Readonly<LevelRect>,
  fill = '#dc5d4f',
  outline = '#251c17',
): void {
  const count = Math.max(1, Math.round(rect.width / Math.max(1, rect.height * 0.5)));
  const width = rect.width / count;
  ctx.save();
  ctx.fillStyle = fill; ctx.strokeStyle = outline; ctx.lineWidth = 2; ctx.lineJoin = 'bevel';
  ctx.beginPath(); ctx.moveTo(rect.x, rect.y + rect.height);
  for (let index = 0; index < count; index++) {
    const x = rect.x + index * width;
    ctx.lineTo(x + width * 0.5, rect.y);
    ctx.lineTo(x + width, rect.y + rect.height);
  }
  ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
}

function drawMovingPlatformWidget(
  ctx: CanvasRenderingContext2D,
  rect: Readonly<LevelRect>,
  path: readonly Readonly<{ x: number; y: number }>[],
  activeWaypoint?: number,
): void {
  if (path.length === 0) return;
  const centers = path.map((point) => ({ x: point.x + rect.width / 2, y: point.y + rect.height / 2 }));
  ctx.save();
  ctx.strokeStyle = '#69e8f2'; ctx.fillStyle = 'rgba(21, 64, 76, .92)'; ctx.lineWidth = 2;
  if (centers.length > 1) {
    ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.moveTo(centers[0]!.x, centers[0]!.y);
    for (let index = 1; index < centers.length; index++) ctx.lineTo(centers[index]!.x, centers[index]!.y);
    ctx.stroke(); ctx.setLineDash([]);
  }
  for (let index = 0; index < centers.length; index++) {
    const center = centers[index]!; const active = index === activeWaypoint;
    ctx.beginPath(); ctx.arc(center.x, center.y, active ? 9 : 7, 0, Math.PI * 2);
    ctx.fillStyle = index === 0 ? 'rgba(21, 64, 76, .92)' : active ? '#eaffff' : '#287f8b';
    ctx.fill(); ctx.strokeStyle = active ? '#ffffff' : '#69e8f2'; ctx.lineWidth = active ? 3 : 2; ctx.stroke();
    const label = index === 0 ? 'Start' : index === 1 ? 'Move to' : `Move to ${index}`;
    ctx.font = 'bold 10px sans-serif'; const width = ctx.measureText(label).width + 8;
    const labelX = center.x - width / 2; const labelY = center.y - (active ? 23 : 21);
    ctx.fillStyle = 'rgba(12, 33, 43, .9)'; ctx.fillRect(labelX, labelY - 10, width, 14);
    ctx.fillStyle = '#dffcff'; ctx.fillText(label, labelX + 4, labelY);
  }
  ctx.restore();
}

function drawSelectedEntity(ctx: CanvasRenderingContext2D, entity: Readonly<LevelEntity>): void {
  const rect = entity.rect; const handle = 5;
  ctx.save(); ctx.strokeStyle = '#f4d35e'; ctx.fillStyle = '#f4d35e'; ctx.lineWidth = 2; ctx.setLineDash([5, 3]);
  ctx.strokeRect(rect.x - 3, rect.y - 3, rect.width + 6, rect.height + 6); ctx.setLineDash([]);
  for (const [x, y] of [[rect.x - 3, rect.y - 3], [rect.x + rect.width + 3, rect.y - 3], [rect.x - 3, rect.y + rect.height + 3], [rect.x + rect.width + 3, rect.y + rect.height + 3]]) ctx.fillRect(x - handle / 2, y - handle / 2, handle, handle);
  ctx.restore();
}

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
  /** Draw only the player-start marker while the move-spawn tool is active. */
  readonly showSpawnMarker?: boolean;
  /** Collected entity ids omitted from every entity-rendering pass. */
  readonly collectedEntityIds?: ReadonlySet<number>;
  /** Stable seed for coordinate-addressed visual detail. */
  readonly worldSeed: number;
  /** Atlas-backed dual-grid assets. Required only by the dual-grid treatment. */
  readonly dualGrid?: Readonly<TileRoomDualGridFrame>;
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
  treatment: keyof typeof TILE_ROOM_THEMES,
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

  if (frame.treatment === 'dual-grid') {
    ctx.fillStyle = '#1d3347';
    ctx.fillRect(0, 0, frame.viewW, frame.viewH);
    ctx.save();
    ctx.translate(-Math.round(frame.camera.x), -Math.round(frame.camera.y));
    if (frame.dualGrid !== undefined) {
      drawPreparedTerrainArtDualGrid(ctx, frame.dualGrid.prepared, {
        atlas: frame.dualGrid.atlas,
        image: frame.dualGrid.image,
        view: {
          x: frame.camera.x,
          y: frame.camera.y,
          width: frame.viewW,
          height: frame.viewH,
        },
      });
      for (const pass of frame.dualGrid.additional ?? []) drawPreparedTerrainArtDualGrid(ctx, frame.dualGrid.prepared, { atlas: pass.atlas, image: pass.image, view: { x: frame.camera.x, y: frame.camera.y, width: frame.viewW, height: frame.viewH } });
      if (frame.dualGrid.occurrence !== undefined) {
        const size = frame.dualGrid.prepared.tileSize;
        ctx.drawImage(frame.dualGrid.occurrence.image, frame.dualGrid.occurrence.dualX * size - size / 2, frame.dualGrid.occurrence.dualY * size - size / 2, size, size);
      }
    }
    for (const entity of terrain) {
      if (entity.kind === 'hazard') drawSpikeStrip(ctx, entity.rect);
      else drawLevelEntity(ctx, entity);
    }
    if (frame.player !== null) drawActor(ctx, frame.player);
    for (const entity of other) drawLevelEntity(ctx, entity);
    if (frame.showSpawnMarker && !frame.showMarkers) drawLevelEntity(ctx, { id: -1, kind: 'spawn', rect: { x: level.spawn.x - 3, y: level.spawn.y - 3, width: 22, height: 30 }, props: {} });
    if (frame.dualGrid?.selectedEntity !== undefined) drawSelectedEntity(ctx, frame.dualGrid.selectedEntity);
    if (frame.dualGrid?.showDualGrid || frame.dualGrid?.showLogicalGrid) {
      const size = frame.dualGrid.prepared.tileSize;
      ctx.save(); ctx.lineWidth = 1;
      if (frame.dualGrid.showDualGrid) {
        ctx.strokeStyle = 'rgba(105,210,255,.28)';
        for (let col = 0; col < frame.dualGrid.prepared.cols; col++) { const x = col * size - size / 2 + .5; ctx.beginPath(); ctx.moveTo(x, -size / 2); ctx.lineTo(x, level.height + size / 2); ctx.stroke(); }
        for (let row = 0; row < frame.dualGrid.prepared.rows; row++) { const y = row * size - size / 2 + .5; ctx.beginPath(); ctx.moveTo(-size / 2, y); ctx.lineTo(level.width + size / 2, y); ctx.stroke(); }
      }
      if (frame.dualGrid.showLogicalGrid) {
        ctx.strokeStyle = 'rgba(255,255,255,.18)';
        for (let col = 0; col <= level.tiles.cols; col++) { const x = col * size + .5; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, level.height); ctx.stroke(); }
        for (let row = 0; row <= level.tiles.rows; row++) { const y = row * size + .5; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(level.width, y); ctx.stroke(); }
      }
      ctx.restore();
    }
    if (frame.dualGrid?.paintPreview !== undefined) {
      const { cells, behavior, cursor } = frame.dualGrid.paintPreview;
      const size = frame.dualGrid.prepared.tileSize;
      ctx.save();
      ctx.fillStyle = behavior === 'erase' ? 'rgba(255, 92, 84, .36)' : 'rgba(126, 232, 151, .38)';
      ctx.strokeStyle = behavior === 'erase' ? 'rgba(255, 130, 122, .95)' : 'rgba(182, 255, 198, .95)';
      ctx.lineWidth = 1.5;
      for (const cell of cells) {
        if (cell.col < 0 || cell.row < 0 || cell.col >= level.tiles.cols || cell.row >= level.tiles.rows) continue;
        const x = cell.col * size; const y = cell.row * size;
        ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
        ctx.strokeRect(x + 1, y + 1, size - 2, size - 2);
        if (behavior === 'erase') {
          ctx.beginPath(); ctx.moveTo(x + 3, y + 3); ctx.lineTo(x + size - 3, y + size - 3); ctx.moveTo(x + size - 3, y + 3); ctx.lineTo(x + 3, y + size - 3); ctx.stroke();
        }
      }
      if (cursor.col >= 0 && cursor.row >= 0 && cursor.col < level.tiles.cols && cursor.row < level.tiles.rows) {
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#ffffff';
        ctx.strokeRect(cursor.col * size + 1.5, cursor.row * size + 1.5, size - 3, size - 3);
      }
      ctx.restore();
    }
    if (frame.dualGrid?.movingPlatformPreview !== undefined) {
      const preview = frame.dualGrid.movingPlatformPreview; const rect = preview.rect;
      ctx.save();
      ctx.fillStyle = 'rgba(80, 214, 226, .42)'; ctx.strokeStyle = '#b8fbff'; ctx.lineWidth = 2;
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height); ctx.strokeRect(rect.x + 1, rect.y + 1, rect.width - 2, rect.height - 2);
      if (preview.path.length > 1) {
        const start = preview.path[0]!; const end = preview.path[preview.path.length - 1]!;
        const startX = start.x + rect.width / 2; const startY = start.y + rect.height / 2;
        const endX = end.x + rect.width / 2; const endY = end.y + rect.height / 2;
        ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.moveTo(startX, startY); ctx.lineTo(endX, endY); ctx.stroke(); ctx.setLineDash([]);
        const angle = Math.atan2(endY - startY, endX - startX); ctx.beginPath(); ctx.moveTo(endX, endY); ctx.lineTo(endX - Math.cos(angle - .55) * 8, endY - Math.sin(angle - .55) * 8); ctx.moveTo(endX, endY); ctx.lineTo(endX - Math.cos(angle + .55) * 8, endY - Math.sin(angle + .55) * 8); ctx.stroke();
      }
      ctx.fillStyle = '#eaffff'; ctx.font = 'bold 9px sans-serif'; ctx.fillText(preview.mode === 'create' ? 'NEW MOVING PLATFORM' : 'MOVE PLATFORM', rect.x + 5, rect.y + Math.min(12, rect.height - 3));
      ctx.restore();
    }
    if (frame.dualGrid?.movingPlatformWidget !== undefined) {
      const widget = frame.dualGrid.movingPlatformWidget;
      drawMovingPlatformWidget(ctx, widget.rect, widget.path, widget.activeWaypoint);
    }
    if (frame.dualGrid?.spikePreview !== undefined) {
      const preview = frame.dualGrid.spikePreview;
      ctx.save();
      if (preview.mode === 'create') {
        ctx.globalAlpha = .78;
        drawSpikeStrip(ctx, preview.rect, '#ff7b68', '#ffe5df');
      } else {
        ctx.fillStyle = 'rgba(255, 72, 72, .2)'; ctx.strokeStyle = '#ff8d86'; ctx.lineWidth = 2;
        ctx.fillRect(preview.rect.x, preview.rect.y, preview.rect.width, preview.rect.height);
        ctx.strokeRect(preview.rect.x + 1, preview.rect.y + 1, preview.rect.width - 2, preview.rect.height - 2);
        for (const target of preview.targets) {
          ctx.fillStyle = 'rgba(255, 72, 72, .44)'; ctx.fillRect(target.x, target.y, target.width, target.height);
          ctx.beginPath(); ctx.moveTo(target.x + 2, target.y + 2); ctx.lineTo(target.x + target.width - 2, target.y + target.height - 2); ctx.moveTo(target.x + target.width - 2, target.y + 2); ctx.lineTo(target.x + 2, target.y + target.height - 2); ctx.stroke();
        }
      }
      ctx.restore();
    }
    if (frame.dualGrid?.entityPreview !== undefined) {
      const preview = frame.dualGrid.entityPreview; const entity = preview.entity; const r = entity.rect;
      ctx.save(); ctx.globalAlpha = preview.mode === 'delete' ? .72 : .68;
      if (entity.kind === 'hazard') drawSpikeStrip(ctx, r, preview.mode === 'delete' ? '#ff4f52' : '#78e7f0', '#ffffff');
      else drawLevelEntity(ctx, entity, { palette: {
        exit: preview.mode === 'delete' ? '#ff5658' : '#f4d35e',
        movingPlatform: preview.mode === 'delete' ? '#ff5658' : '#50d6e2',
        collectibleCoin: preview.mode === 'delete' ? '#ff5658' : '#ffd700',
        collectibleGem: preview.mode === 'delete' ? '#ff5658' : '#4a9eff',
        collectibleKey: preview.mode === 'delete' ? '#ff5658' : '#d8e2ea',
      } });
      ctx.globalAlpha = 1; ctx.strokeStyle = preview.mode === 'delete' ? '#ff7779' : '#d8fbff'; ctx.lineWidth = 2;
      ctx.strokeRect(r.x - 2, r.y - 2, r.width + 4, r.height + 4);
      if (preview.mode === 'delete') {
        ctx.beginPath(); ctx.moveTo(r.x, r.y); ctx.lineTo(r.x + r.width, r.y + r.height); ctx.moveTo(r.x + r.width, r.y); ctx.lineTo(r.x, r.y + r.height); ctx.stroke();
      }
      ctx.restore();
    }
    if (frame.dualGrid?.selection !== null && frame.dualGrid?.selection !== undefined) {
      const selection = frame.dualGrid.selection;
      const size = frame.dualGrid.prepared.tileSize;
      ctx.save();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#f4d35e';
      ctx.strokeRect(
        selection.dualX * size - size / 2 + 1,
        selection.dualY * size - size / 2 + 1,
        size - 2,
        size - 2,
      );
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255, 117, 106, 0.9)';
      for (const logical of selection.logicalCorners) {
        if (
          logical.col < 0 || logical.row < 0 ||
          logical.col >= frame.dualGrid.prepared.cols - 1 ||
          logical.row >= frame.dualGrid.prepared.rows - 1
        ) continue;
        ctx.strokeRect(logical.col * size + 1, logical.row * size + 1, size - 2, size - 2);
      }
      if (frame.dualGrid.highlightMatches) {
        const selectedMaterial = selection.tile.materials[0];
        if (selectedMaterial !== undefined) {
          ctx.strokeStyle = 'rgba(244,211,94,.5)';
          for (const candidate of frame.dualGrid.prepared.tiles) {
            if (candidate.materials.some((entry) => entry.materialId === selectedMaterial.materialId && entry.mask === selectedMaterial.mask)) {
              ctx.strokeRect(candidate.dualX * size - size / 2 + .5, candidate.dualY * size - size / 2 + .5, size - 1, size - 1);
            }
          }
        }
      }
      ctx.restore();
    }
    ctx.restore();
    return;
  }

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
