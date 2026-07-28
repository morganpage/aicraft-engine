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
import type { GeneratedTileSemantics } from '../../src/level';
import type { LevelData, LevelEntity } from '../../src/level/types';

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
