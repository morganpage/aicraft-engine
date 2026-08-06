/**
 * Tile-room fixtures — Phase 0 of the level-visual-rendering plan (§9.0, §14.6).
 *
 * Pure data + pure builders. No DOM, no Canvas, no `Math.random`: everything
 * here is importable from a Vitest `environment: 'node'` test and from the
 * headless `benchmarks/_scripts/*` render scripts, which is the whole point —
 * the tile room is both a showcase scene and the source of §13.3 benchmark
 * fixtures 2, 3, and 4.
 *
 * Two scenes live here:
 *
 * 1. **Generated room** — `createGeneratedRoomLevel`, built from
 *    `generateLevel` (which is `generateBlueprint` + `realizeBlueprint`). This
 *    is the real `src/levelgen` consumer the plan asks for; whatever the
 *    generator emits is what the renderer must survive.
 * 2. **Topology room** — `createTopologyRoomLevel`, a hand-authored 60×34 grid
 *    that embeds every shape in §14.6 (isolated cell, ledge, corner, tunnel,
 *    pillar, enclosed room, staircase) plus a solid shell. It is a *fixture*,
 *    not generated content: the generator's current output is a ground strip
 *    with a few single-tile platforms, which exercises horizontal spans and
 *    nothing else. See `docs/design/level-visual-rendering-phase0-record.md`.
 *
 * Tile-art legend, shared by every fixture in this file:
 *
 * | Char | Tile value | Meaning                      |
 * |------|-----------|-------------------------------|
 * | `.`  | 0         | empty                         |
 * | `#`  | 1         | solid (`TILE_ROOM_SEMANTICS.solid`)       |
 * | `=`  | 2         | passthrough (`TILE_ROOM_SEMANTICS.passthrough`) |
 */

import { generateLevel } from '../../src/levelgen';
import { aabbOverlap } from '../../src/collision';
import type { GeneratedTileSemantics } from '../../src/level';
import type { CollectibleKind, LevelData, LevelEntity, LevelRect } from '../../src/level/types';

// --- Scene constants -------------------------------------------------------

/** Tile edge length in world pixels. Matches the playground's `TILE_SIZE`. */
export const TILE_ROOM_TILE_SIZE = 16;

/** Room width in tiles. §13.3 fixture 2 names a 60×34 room. */
export const TILE_ROOM_COLS = 60;

/** Room height in tiles. */
export const TILE_ROOM_ROWS = 34;

/**
 * Viewport width in CSS pixels. Deliberately smaller than the room
 * (60 × 16 = 960 world px) so the camera has somewhere to scroll — the
 * property the playground cannot validate (§2.5).
 */
export const TILE_ROOM_VIEW_W = 600;

/**
 * Viewport height in CSS pixels. Smaller than the room (34 × 16 = 544 world
 * px), so the camera scrolls on both axes rather than only horizontally.
 */
export const TILE_ROOM_VIEW_H = 400;

/** Default generation seed. Fixed so the scene, the sheets, and the benchmark all agree. */
export const TILE_ROOM_SEED = 1337;

/**
 * Tile semantics for every fixture here. Matches `DEFAULT_TILE_SEMANTICS`, so
 * a fixture grid and a generated grid can be compiled by the same
 * `compileGeneratedLevel` call.
 */
export const TILE_ROOM_SEMANTICS: Readonly<GeneratedTileSemantics> = {
  solid: [1],
  passthrough: [2],
};

/**
 * Player body height in world px, used to seat spawn points on a floor. Mirrors
 * the engine's `DEFAULT_PLAYER_HEIGHT`; duplicated as a local constant because
 * the fixtures must stay dependency-light and the value is asserted in
 * `showcase/tests/tile-room-fixtures.test.ts` against a compiled level.
 */
export const TILE_ROOM_PLAYER_HEIGHT = 24;

// --- Tile art parsing ------------------------------------------------------

/** A parsed tile grid in the shape `LevelData.tiles` (and `drawTileGrid`) expects. */
export interface TileRoomGrid {
  readonly data: readonly number[];
  readonly cols: number;
  readonly rows: number;
  readonly tileSize: number;
}

/** Tile value emitted for `#`. */
const SOLID_VALUE = 1;
/** Tile value emitted for `=`. */
const PASSTHROUGH_VALUE = 2;
/** Tile value emitted for `.` and for any unrecognized character. */
const EMPTY_VALUE = 0;

/**
 * Parse rows of tile art into a {@link TileRoomGrid}.
 *
 * Row width is taken from the widest row; short rows are right-padded with
 * empty cells so ragged art can never produce a grid whose `data.length`
 * disagrees with `cols × rows`. Unrecognized characters parse as empty rather
 * than throwing — these are fixtures, and a typo should show up as a hole in a
 * contact sheet, not as a crashed render script.
 *
 * @param art - one string per grid row, using the legend in the module JSDoc
 * @param tileSize - tile edge length in world pixels
 * @returns a fresh grid; the input is never mutated
 */
export function parseTileArt(
  art: readonly string[],
  tileSize: number = TILE_ROOM_TILE_SIZE,
): TileRoomGrid {
  const rows = art.length;
  let cols = 0;
  for (const line of art) {
    if (line.length > cols) cols = line.length;
  }

  const data: number[] = new Array<number>(cols * rows).fill(EMPTY_VALUE);
  for (let r = 0; r < rows; r++) {
    const line = art[r] ?? '';
    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      data[r * cols + c] =
        ch === '#' ? SOLID_VALUE : ch === '=' ? PASSTHROUGH_VALUE : EMPTY_VALUE;
    }
  }

  return { data, cols, rows, tileSize };
}

// --- §14.6 topology shapes -------------------------------------------------

/** The seven topology shapes §14.6 requires on the topology contact sheet. */
export type TopologyShapeName =
  | 'isolated'
  | 'ledge'
  | 'corner'
  | 'tunnel'
  | 'pillar'
  | 'room'
  | 'staircase';

/** One named topology shape, small enough to tile onto a contact sheet. */
export interface TopologyShape {
  /** Stable identifier — also the contact-sheet cell label. */
  readonly name: TopologyShapeName;
  /** What a reviewer should be looking at in this cell. */
  readonly description: string;
  /** The shape's tile grid. */
  readonly grid: TileRoomGrid;
}

/**
 * The §14.6 topology shapes as standalone 8×8 grids.
 *
 * These exist so the topology contact sheet shows each shape in isolation,
 * where a missing corner join or an unintended internal outline is obvious.
 * The same shapes also appear in context inside {@link TOPOLOGY_ROOM_ART};
 * neither view substitutes for the other.
 */
export const TOPOLOGY_SHAPES: readonly TopologyShape[] = [
  {
    name: 'isolated',
    description: 'Single cell with no neighbors — every edge is exposed.',
    grid: parseTileArt([
      '........',
      '........',
      '........',
      '...#....',
      '........',
      '........',
      '........',
      '........',
    ]),
  },
  {
    name: 'ledge',
    description: 'Horizontal span — one continuous top cap, two end caps.',
    grid: parseTileArt([
      '........',
      '........',
      '........',
      '.######.',
      '........',
      '........',
      '........',
      '........',
    ]),
  },
  {
    name: 'corner',
    description: 'L join — the inner corner must not draw an internal cap.',
    grid: parseTileArt([
      '........',
      '..##....',
      '..##....',
      '..##....',
      '..#####.',
      '..#####.',
      '........',
      '........',
    ]),
  },
  {
    name: 'tunnel',
    description: 'One-cell horizontal void through a mass — a ceiling and a floor face each other.',
    grid: parseTileArt([
      '........',
      '.######.',
      '.######.',
      '.######.',
      '.#....#.',
      '.######.',
      '.######.',
      '........',
    ]),
  },
  {
    name: 'pillar',
    description: 'Vertical column — both side faces exposed, one top cap.',
    grid: parseTileArt([
      '........',
      '...##...',
      '...##...',
      '...##...',
      '...##...',
      '...##...',
      '...##...',
      '........',
    ]),
  },
  {
    name: 'room',
    description: 'Enclosed perimeter with a doorway — inner and outer faces on the same body.',
    grid: parseTileArt([
      '########',
      '#......#',
      '#......#',
      '#......#',
      '.......#',
      '.......#',
      '#......#',
      '########',
    ]),
  },
  {
    name: 'staircase',
    description: 'Diagonal steps — the case where naive per-cell outlining reads as noise.',
    grid: parseTileArt([
      '........',
      '.......#',
      '......##',
      '.....###',
      '....####',
      '...#####',
      '..######',
      '.#######',
    ]),
  },
];

// --- Topology room ---------------------------------------------------------

/**
 * The 60×34 topology room, as tile art.
 *
 * Reading left to right along the floor: a staircase, a free-standing pillar, a
 * mass with a one-cell tunnel bored through it, and an enclosed room with a
 * two-cell doorway on its left wall. Above them: a floating ledge, a
 * passthrough ledge, an L corner, an isolated cell, and a high ledge. The whole
 * thing sits inside a solid shell with a two-row floor.
 *
 * Hand-authored on purpose — see the module JSDoc.
 */
export const TOPOLOGY_ROOM_ART: readonly string[] = [
  '############################################################',
  '#..........................................................#',
  '#..........................................................#',
  '#..........................................................#',
  '#..........................................................#',
  '#..........................................................#',
  '#.......................................#..................#',
  '#..........................................................#',
  '#...........................#..............................#',
  '#...........................#..............................#',
  '#...........................#...............#########......#',
  '#...........................#..............................#',
  '#...........................#..............................#',
  '#...........................########.......................#',
  '#..........................................................#',
  '#..........................................................#',
  '#.......#############......................................#',
  '#..........................................................#',
  '#..........................................................#',
  '#.........................========.........................#',
  '#..........................................................#',
  '#...........................................#############..#',
  '#.................#.........................#...........#..#',
  '#...........#.....#.........................#...........#..#',
  '#..........##.....#.........................#...........#..#',
  '#.........###.....#.....###############.....#...........#..#',
  '#........####.....#.....###############.....#...........#..#',
  '#.......#####.....#.....###############.....#...........#..#',
  '#......######.....#.....#.............#.....#...........#..#',
  '#.....#######.....#.....###############.................#..#',
  '#....########.....#.....###############.................#..#',
  '#...#########.....#.....###############.....#############..#',
  '############################################################',
  '############################################################',
];

/** Row index of the topology room's floor surface (the first solid floor row). */
const TOPOLOGY_FLOOR_ROW = 32;

/**
 * Entities for the topology room. Deliberately sparse: the room's job is tile
 * topology, and every entity added here is one more thing competing for
 * attention on a contact sheet.
 *
 * The moving platform is the exception and is not optional — it is the only
 * thing in either scene that forces the consumer to substitute a runtime
 * rectangle for an authored one, which is the behavior `ResolvedLevelEntity`
 * formalizes in Phase 3 (§7.7, §9.3).
 */
function topologyRoomEntities(tileSize: number): readonly LevelEntity[] {
  const t = tileSize;
  const scale = t / TILE_ROOM_TILE_SIZE;
  const floorY = TOPOLOGY_FLOOR_ROW * t;
  const markerSize = 16 * scale;
  const pickupSize = 12 * scale;
  return [
    {
      id: 1,
      kind: 'spawn',
      rect: {
        x: 2 * t,
        y: floorY - TILE_ROOM_PLAYER_HEIGHT * scale,
        width: markerSize,
        height: markerSize,
      },
      props: {},
    },
    {
      id: 2,
      kind: 'exit',
      rect: { x: 50 * t, y: 30 * t, width: markerSize, height: markerSize },
      props: { isTrap: false, locked: false },
    },
    {
      id: 3,
      kind: 'collectible',
      rect: { x: 14 * t, y: 15 * t, width: pickupSize, height: pickupSize },
      props: { kind: 'coin', value: 1 },
    },
    {
      id: 4,
      kind: 'collectible',
      // Suspended in the enclosed room's air, not embedded in its left mass.
      rect: { x: 48 * t, y: 27 * t, width: pickupSize, height: pickupSize },
      props: { kind: 'gem', value: 5 },
    },
    {
      id: 5,
      kind: 'hazard',
      rect: { x: 21 * t, y: 31 * t, width: 2 * t, height: t },
      props: {},
    },
    {
      id: 6,
      kind: 'movingPlatform',
      rect: { x: 21 * t, y: 22 * t, width: 3 * t, height: t },
      props: {
        speed: 60 * scale,
        path: [
          { x: 21 * t, y: 22 * t },
          { x: 40 * t, y: 22 * t },
        ],
        loopMode: 'pingpong',
      },
    },
    {
      id: 7,
      kind: 'trigger',
      // A large, unmistakable editor-only region inside the enclosed room.
      rect: { x: 45 * t, y: 23 * t, width: 8 * t, height: 5 * t },
      props: { action: 'topology-marker-demo', params: {} },
    },
  ];
}

/**
 * Build the hand-authored topology room.
 *
 * Pure: returns a fresh `LevelData` on every call, so a caller can hand it to
 * the editor, a benchmark, and a render script without any of them observing
 * another's mutations.
 *
 * @param tileSize - tile edge length in world pixels (default 16). Passing 8 or
 *   32 produces the §14.6 scale-sheet variants from identical topology.
 * @returns a `LevelData` whose collision comes entirely from `tiles`
 */
export function createTopologyRoomLevel(
  tileSize: number = TILE_ROOM_TILE_SIZE,
): LevelData {
  const tiles = parseTileArt(TOPOLOGY_ROOM_ART, tileSize);
  const entities = topologyRoomEntities(tileSize);
  const spawn = entities.find((e) => e.kind === 'spawn');

  return {
    version: 1,
    id: 'tile-room-topology',
    name: 'Topology room',
    width: tiles.cols * tileSize,
    height: tiles.rows * tileSize,
    tileSize,
    spawn: { x: spawn?.rect.x ?? 0, y: spawn?.rect.y ?? 0 },
    tiles,
    entities: [...entities],
    nextEntityId: 8,
  };
}

// --- Generated room --------------------------------------------------------

/**
 * A tile-room scene: the level plus the semantics needed to compile it.
 *
 * `id` is an open string rather than a closed union because the headless
 * render scripts wrap other levels — the playground's rectangle-authored level
 * among them — in this same shape so one draw path serves every capture.
 */
export interface TileRoomScene {
  /** Stable scene identifier. */
  readonly id: string;
  /** Human-readable scene name (used in the section UI and sheet labels). */
  readonly label: string;
  /** The level to render and simulate. */
  readonly level: LevelData;
  /** Tile-value classification for `compileGeneratedLevel`. */
  readonly tileSemantics: Readonly<GeneratedTileSemantics>;
}

/** Return a scene with its one canonical player-spawn record moved immutably. */
export function moveTileRoomSceneSpawn(scene: Readonly<TileRoomScene>, x: number, y: number): TileRoomScene {
  const level = scene.level;
  const spawnX = Math.max(0, Math.min(level.width, Number.isFinite(x) ? x : level.spawn.x));
  const spawnY = Math.max(0, Math.min(level.height, Number.isFinite(y) ? y : level.spawn.y));
  let foundSpawn = false;
  const entities: LevelEntity[] = level.entities.map((entity) => {
    if (entity.kind !== 'spawn') return entity;
    foundSpawn = true;
    return { ...entity, rect: { ...entity.rect, x: spawnX, y: spawnY } };
  });
  let nextEntityId = level.nextEntityId;
  if (!foundSpawn) {
    entities.push({ id: nextEntityId, kind: 'spawn', rect: { x: spawnX, y: spawnY, width: level.tileSize, height: level.tileSize }, props: {} });
    nextEntityId++;
  }
  return { ...scene, level: { ...level, spawn: { x: spawnX, y: spawnY }, entities, nextEntityId } };
}

function clampMovingPlatformRect(level: Readonly<LevelData>, rect: Readonly<LevelRect>): LevelRect {
  const width = Math.max(level.tileSize, Math.min(level.width, rect.width));
  const height = Math.max(level.tileSize, Math.min(level.height, rect.height));
  return {
    x: Math.max(0, Math.min(level.width - width, rect.x)),
    y: Math.max(0, Math.min(level.height - height, rect.y)),
    width,
    height,
  };
}

/** Add a moving platform with a useful four-cell horizontal ping-pong path. */
export function addTileRoomMovingPlatform(scene: Readonly<TileRoomScene>, requestedRect: Readonly<LevelRect>): TileRoomScene {
  const level = scene.level; const rect = clampMovingPlatformRect(level, requestedRect);
  const maxX = level.width - rect.width; const travel = level.tileSize * 4;
  const otherX = rect.x + travel <= maxX ? rect.x + travel : Math.max(0, rect.x - travel);
  const entity: LevelEntity = {
    id: level.nextEntityId,
    kind: 'movingPlatform',
    rect,
    props: { speed: 60, path: [{ x: rect.x, y: rect.y }, { x: otherX, y: rect.y }], loopMode: 'pingpong' },
  };
  return { ...scene, level: { ...level, entities: [...level.entities, entity], nextEntityId: level.nextEntityId + 1 } };
}

/** Move an authored moving platform and translate its complete path by the same delta. */
export function moveTileRoomMovingPlatform(scene: Readonly<TileRoomScene>, entityId: number, requestedRect: Readonly<LevelRect>): TileRoomScene {
  const level = scene.level;
  let changed = false;
  const entities = level.entities.map((entity) => {
    if (entity.id !== entityId || entity.kind !== 'movingPlatform') return entity;
    const rect = clampMovingPlatformRect(level, { ...requestedRect, width: entity.rect.width, height: entity.rect.height });
    const dx = rect.x - entity.rect.x; const dy = rect.y - entity.rect.y;
    if (dx === 0 && dy === 0) return entity;
    changed = true;
    return { ...entity, rect, props: { ...entity.props, path: entity.props.path.map((point) => ({
      x: Math.max(0, Math.min(level.width - rect.width, point.x + dx)),
      y: Math.max(0, Math.min(level.height - rect.height, point.y + dy)),
    })) } };
  });
  return changed ? { ...scene, level: { ...level, entities } } : scene;
}

/** Move one authored destination without moving the platform body or its other waypoints. */
export function moveTileRoomMovingPlatformWaypoint(
  scene: Readonly<TileRoomScene>,
  entityId: number,
  waypointIndex: number,
  requestedPoint: Readonly<{ x: number; y: number }>,
): TileRoomScene {
  const level = scene.level;
  let changed = false;
  const entities = level.entities.map((entity) => {
    if (entity.id !== entityId || entity.kind !== 'movingPlatform' || waypointIndex <= 0 || waypointIndex >= entity.props.path.length) return entity;
    const point = {
      x: Math.max(0, Math.min(level.width - entity.rect.width, requestedPoint.x)),
      y: Math.max(0, Math.min(level.height - entity.rect.height, requestedPoint.y)),
    };
    const previous = entity.props.path[waypointIndex]!;
    if (point.x === previous.x && point.y === previous.y) return entity;
    changed = true;
    const path = entity.props.path.map((candidate, index) => index === waypointIndex ? point : candidate);
    return { ...entity, props: { ...entity.props, path } };
  });
  return changed ? { ...scene, level: { ...level, entities } } : scene;
}

/** Update simulation settings without disturbing a moving platform's body or route. */
export function updateTileRoomMovingPlatform(
  scene: Readonly<TileRoomScene>,
  entityId: number,
  values: Readonly<{ speed?: number; loopMode?: 'loop' | 'pingpong' }>,
): TileRoomScene {
  let changed = false;
  const entities = scene.level.entities.map((entity) => {
    if (entity.id !== entityId || entity.kind !== 'movingPlatform') return entity;
    const speed = values.speed === undefined ? entity.props.speed : Math.max(1, Math.min(1000, values.speed));
    const loopMode = values.loopMode ?? entity.props.loopMode ?? 'pingpong';
    if (speed === entity.props.speed && loopMode === (entity.props.loopMode ?? 'pingpong')) return entity;
    changed = true; return { ...entity, props: { ...entity.props, speed, loopMode } };
  });
  return changed ? { ...scene, level: { ...scene.level, entities } } : scene;
}

/** Append a reachable, clamped destination to a moving platform route. */
export function addTileRoomMovingPlatformWaypoint(scene: Readonly<TileRoomScene>, entityId: number): TileRoomScene {
  const level = scene.level; let changed = false;
  const entities = level.entities.map((entity) => {
    if (entity.id !== entityId || entity.kind !== 'movingPlatform') return entity;
    const last = entity.props.path[entity.props.path.length - 1] ?? { x: entity.rect.x, y: entity.rect.y };
    const travel = level.tileSize * 4; const maxX = level.width - entity.rect.width; const maxY = level.height - entity.rect.height;
    const point = last.x + travel <= maxX ? { x: last.x + travel, y: last.y }
      : last.x - travel >= 0 ? { x: last.x - travel, y: last.y }
        : { x: last.x, y: last.y + travel <= maxY ? last.y + travel : Math.max(0, last.y - travel) };
    changed = true; return { ...entity, props: { ...entity.props, path: [...entity.props.path, point] } };
  });
  return changed ? { ...scene, level: { ...level, entities } } : scene;
}

/** Remove the last destination while preserving the required Start + Move to pair. */
export function removeTileRoomMovingPlatformWaypoint(scene: Readonly<TileRoomScene>, entityId: number): TileRoomScene {
  let changed = false;
  const entities = scene.level.entities.map((entity) => {
    if (entity.id !== entityId || entity.kind !== 'movingPlatform' || entity.props.path.length <= 2) return entity;
    changed = true; return { ...entity, props: { ...entity.props, path: entity.props.path.slice(0, -1) } };
  });
  return changed ? { ...scene, level: { ...scene.level, entities } } : scene;
}

/** Update the selected exit's gameplay flags. */
export function updateTileRoomExit(
  scene: Readonly<TileRoomScene>, entityId: number, values: Readonly<{ locked?: boolean; isTrap?: boolean }>,
): TileRoomScene {
  let changed = false;
  const entities = scene.level.entities.map((entity) => {
    if (entity.id !== entityId || entity.kind !== 'exit') return entity;
    const props = { locked: values.locked ?? entity.props.locked, isTrap: values.isTrap ?? entity.props.isTrap };
    if (props.locked === entity.props.locked && props.isTrap === entity.props.isTrap) return entity;
    changed = true; return { ...entity, props };
  });
  return changed ? { ...scene, level: { ...scene.level, entities } } : scene;
}

/** Update a pickup's authored type, value, and persistence behavior. */
export function updateTileRoomCollectible(
  scene: Readonly<TileRoomScene>, entityId: number,
  values: Readonly<{ kind?: CollectibleKind; value?: number; persists?: boolean }>,
): TileRoomScene {
  let changed = false;
  const entities = scene.level.entities.map((entity) => {
    if (entity.id !== entityId || entity.kind !== 'collectible') return entity;
    const props = {
      kind: values.kind ?? entity.props.kind,
      value: values.value === undefined ? entity.props.value : Math.max(0, values.value),
      persists: values.persists ?? entity.props.persists,
    };
    if (props.kind === entity.props.kind && props.value === entity.props.value && props.persists === entity.props.persists) return entity;
    changed = true; return { ...entity, props };
  });
  return changed ? { ...scene, level: { ...scene.level, entities } } : scene;
}

/** Duplicate an editable object with a one-cell offset and a fresh stable id. */
export function duplicateTileRoomEntity(scene: Readonly<TileRoomScene>, entityId: number): TileRoomScene {
  const source = scene.level.entities.find((entity) => entity.id === entityId);
  if (source === undefined || source.kind === 'spawn' || source.kind === 'trigger' || source.kind === 'platform' || source.kind === 'passthrough') return scene as TileRoomScene;
  const clone: LevelEntity = { ...source, id: scene.level.nextEntityId };
  const staged = { ...scene, level: { ...scene.level, entities: [...scene.level.entities, clone], nextEntityId: scene.level.nextEntityId + 1 } };
  const x = source.rect.x + scene.level.tileSize <= scene.level.width - source.rect.width ? source.rect.x + scene.level.tileSize : Math.max(0, source.rect.x - scene.level.tileSize);
  return moveTileRoomEntity(staged, clone.id, x, source.rect.y);
}

function clampSpikeRect(level: Readonly<LevelData>, requestedRect: Readonly<LevelRect>): LevelRect {
  const size = level.tileSize;
  const width = Math.max(size, Math.min(level.width, requestedRect.width));
  return {
    x: Math.max(0, Math.min(level.width - width, requestedRect.x)),
    y: Math.max(0, Math.min(level.height - size, requestedRect.y)),
    width,
    height: size,
  };
}

/** Add a horizontal strip of spike hazards without changing the terrain grid below it. */
export function addTileRoomSpikes(scene: Readonly<TileRoomScene>, requestedRect: Readonly<LevelRect>): TileRoomScene {
  const level = scene.level;
  const entity: LevelEntity = {
    id: level.nextEntityId,
    kind: 'hazard',
    rect: clampSpikeRect(level, requestedRect),
    props: {},
  };
  return { ...scene, level: { ...level, entities: [...level.entities, entity], nextEntityId: level.nextEntityId + 1 } };
}

function rectsOverlap(a: Readonly<LevelRect>, b: Readonly<LevelRect>): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** Delete every spike strip touched by a dragged selection rectangle. */
export function deleteTileRoomSpikes(scene: Readonly<TileRoomScene>, selection: Readonly<LevelRect>): TileRoomScene {
  const entities = scene.level.entities.filter((entity) => entity.kind !== 'hazard' || !rectsOverlap(entity.rect, selection));
  if (entities.length === scene.level.entities.length) return scene as TileRoomScene;
  return { ...scene, level: { ...scene.level, entities } };
}

export type TileRoomPlaceableEntity = 'exit' | 'coin' | 'gem' | 'key';

/** Place an exit or pickup in the selected logical cell. */
export function addTileRoomEntity(
  scene: Readonly<TileRoomScene>,
  kind: TileRoomPlaceableEntity,
  cellX: number,
  cellY: number,
): TileRoomScene {
  const level = scene.level; const size = level.tileSize;
  const id = level.nextEntityId;
  let entity: LevelEntity;
  if (kind === 'exit') {
    const width = size; const height = size * 2;
    entity = {
      id, kind: 'exit',
      rect: {
        x: Math.max(0, Math.min(level.width - width, cellX)),
        y: Math.max(0, Math.min(level.height - height, cellY - size)),
        width, height,
      },
      props: { isTrap: false, locked: false },
    };
  } else {
    const edge = Math.max(6, Math.round(size * .65));
    entity = {
      id, kind: 'collectible',
      rect: {
        x: Math.max(0, Math.min(level.width - edge, cellX + (size - edge) / 2)),
        y: Math.max(0, Math.min(level.height - edge, cellY + (size - edge) / 2)),
        width: edge, height: edge,
      },
      props: { kind, value: kind === 'coin' ? 1 : kind === 'gem' ? 5 : 0, persists: kind === 'key' },
    };
  }
  return { ...scene, label: level.name, level: { ...level, entities: [...level.entities, entity], nextEntityId: id + 1 } };
}

/** Move an authored object while preserving moving-platform path offsets. */
export function moveTileRoomEntity(
  scene: Readonly<TileRoomScene>,
  entityId: number,
  requestedX: number,
  requestedY: number,
): TileRoomScene {
  const entity = scene.level.entities.find((candidate) => candidate.id === entityId);
  if (entity === undefined || entity.kind === 'spawn') return scene as TileRoomScene;
  if (entity.kind === 'movingPlatform') return moveTileRoomMovingPlatform(scene, entityId, { ...entity.rect, x: requestedX, y: requestedY });
  const x = Math.max(0, Math.min(scene.level.width - entity.rect.width, requestedX));
  const y = Math.max(0, Math.min(scene.level.height - entity.rect.height, requestedY));
  if (x === entity.rect.x && y === entity.rect.y) return scene as TileRoomScene;
  return { ...scene, level: { ...scene.level, entities: scene.level.entities.map((candidate) => candidate.id === entityId ? { ...candidate, rect: { ...candidate.rect, x, y } } : candidate) } };
}

/** Delete an object, protecting the canonical spawn and the final required exit. */
export function deleteTileRoomEntity(scene: Readonly<TileRoomScene>, entityId: number): TileRoomScene {
  const target = scene.level.entities.find((entity) => entity.id === entityId);
  if (target === undefined || target.kind === 'spawn') return scene as TileRoomScene;
  if (target.kind === 'exit' && scene.level.entities.filter((entity) => entity.kind === 'exit').length <= 1) return scene as TileRoomScene;
  return { ...scene, level: { ...scene.level, entities: scene.level.entities.filter((entity) => entity.id !== entityId) } };
}

/** Rename a level without changing its stable scene-tab id. */
export function renameTileRoomScene(scene: Readonly<TileRoomScene>, name: string): TileRoomScene {
  const next = name.trim();
  if (next.length === 0 || next === scene.level.name) return scene as TileRoomScene;
  return { ...scene, label: next, level: { ...scene.level, name: next } };
}

/** True when the player touched authored danger, bottom lava, or fell out of bounds. */
export function isTileRoomPlayerDead(
  level: Readonly<LevelData>,
  player: Readonly<LevelRect>,
): boolean {
  return player.y > level.height + 64 ||
    (level.bottomLava !== undefined && player.y + player.height > level.bottomLava.surfaceY) ||
    level.entities.some((entity) => entity.kind === 'hazard' && aabbOverlap(player, entity.rect));
}

/** True when the player overlaps an unlocked, non-trap exit. */
export function isTileRoomExitReached(level: Readonly<LevelData>, player: Readonly<LevelRect>): boolean {
  return level.entities.some((entity) => entity.kind === 'exit' && !entity.props.locked && !entity.props.isTrap && aabbOverlap(player, entity.rect));
}

/**
 * Build the generated room from `src/levelgen`.
 *
 * This is the plan's actual requirement (§9.0): a scene built from
 * `realizeBlueprint` output, so the tile renderer has a real generator-driven
 * consumer rather than a hand-tuned one.
 *
 * Pure and deterministic: same `(seed, cols, rows, tileSize)` → same level.
 *
 * @param seed - generation seed (default {@link TILE_ROOM_SEED})
 * @param cols - room width in tiles (default {@link TILE_ROOM_COLS})
 * @param rows - room height in tiles (default {@link TILE_ROOM_ROWS})
 * @param tileSize - tile edge length in world pixels
 * @returns the generated scene, ready for `compileGeneratedLevel`
 */
export function createGeneratedRoomScene(
  seed: number = TILE_ROOM_SEED,
  cols: number = TILE_ROOM_COLS,
  rows: number = TILE_ROOM_ROWS,
  tileSize: number = TILE_ROOM_TILE_SIZE,
): TileRoomScene {
  const generated = generateLevel(seed, { cols, rows, tileSize });
  return {
    id: 'generated',
    label: 'Generated room',
    level: generated.level,
    tileSemantics: generated.tileSemantics,
  };
}

/**
 * Build the topology room as a {@link TileRoomScene}, so both scenes can be
 * consumed through one shape.
 *
 * @param tileSize - tile edge length in world pixels
 */
export function createTopologyRoomScene(
  tileSize: number = TILE_ROOM_TILE_SIZE,
): TileRoomScene {
  return {
    id: 'topology',
    label: 'Topology room',
    level: createTopologyRoomLevel(tileSize),
    tileSemantics: TILE_ROOM_SEMANTICS,
  };
}

// --- Camera helper ---------------------------------------------------------

/**
 * Clamp a camera origin to the level bounds for a given viewport.
 *
 * `updateCamera` already clamps, but the render scripts and the benchmark need
 * a *static* camera at a known place in the level without running a follow
 * loop, and they must clamp it the same way the live section does. Sharing this
 * helper is what keeps a contact sheet showing the same framing the showcase
 * shows.
 *
 * When the level is smaller than the viewport on an axis, the level is centred
 * on that axis — matching `updateCamera`'s behavior exactly.
 *
 * @param x - desired camera origin X in world px
 * @param y - desired camera origin Y in world px
 * @param level - the level being viewed (uses `width` / `height`)
 * @param viewW - viewport width in CSS px
 * @param viewH - viewport height in CSS px
 * @returns the clamped camera origin
 */
export function clampCameraToLevel(
  x: number,
  y: number,
  level: Pick<LevelData, 'width' | 'height'>,
  viewW: number = TILE_ROOM_VIEW_W,
  viewH: number = TILE_ROOM_VIEW_H,
): { readonly x: number; readonly y: number } {
  const maxX = level.width - viewW;
  const maxY = level.height - viewH;
  const cx = level.width <= viewW ? maxX / 2 : Math.min(Math.max(x, 0), maxX);
  const cy = level.height <= viewH ? maxY / 2 : Math.min(Math.max(y, 0), maxY);
  return { x: cx, y: cy };
}
