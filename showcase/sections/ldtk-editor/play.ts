/**
 * Play mode — run the platformer on the level currently being edited.
 *
 * The bridge is `ldtkLevelToLevelData`: the LDtk IntGrid becomes the engine's
 * `TileGrid`, and the same compiled geometry the runtime uses drives collision.
 * The art stays LDtk's, drawn by the same `drawLdtkLevel` the editor uses, so
 * play mode is the level as it will actually ship rather than a preview.
 *
 * Ladder climbing is handled by the engine's climb ability (`climbEnabled` in
 * the config below). Ladder cells are tagged `ladder: true` on the compiled
 * solids: the AABB resolvers skip them (non-colliding climb space) and the
 * climb ability reads them to drive ascent/descent and the stick-to-ladder
 * feel. This keeps climb and jump from desyncing — the ability owns vertical
 * motion inside the pipeline rather than fighting it from outside.
 *
 * The session owns a clone of the level data; nothing it does can write back
 * into the project being edited.
 */

import {
  compileGeneratedLevel,
  stepPlatformer,
  PRECISION_PLATFORMER,
  type CompiledLevel,
  type PlatformerConfig,
  type PlatformerInput,
  type PlatformerState,
} from '../../../src/platformer';
import { DEFAULT_JUMP } from '../../../src/animation/jump';
import { createCamera, updateCamera, type Camera } from '../../../src/camera';
import {
  createKeyboardAdapter,
  type KeyboardAdapter,
  type PolledEdge,
} from '../../../src/input';
import { drawLdtkLevel, type LdtkLevel, type LdtkTilesetBundle } from '../../../src/ldtk';
import type { LevelData } from '../../../src/level/types';
import type { GeneratedTileSemantics } from '../../../src/level/tile-semantics';

/** An edge that is never pressed — the default for an unmapped action. */
const IDLE_EDGE: PolledEdge = { pressed: false, released: false, held: false };

/** Colors for the play-mode actor. */
const PLAYER_COLOR = '#ffd166';
const PLAYER_OUTLINE = '#1d1300';
/** Fill color while the player overlaps a ladder cell. */
const PLAYER_LADDER_COLOR = '#7CFC9E';

/**
 * IntGrid value identifying a ladder in the bundled platformer sample's
 * `Collisions` layer (`{ value: 2, identifier: 'ladder' }`). Used to tag the
 * compiled solids and to tint the player while overlapping.
 */
const LADDER_INT_GRID_VALUE = 2;

/**
 * Play-mode player body width in world px. Half a tile — narrower than the
 * engine default (`DEFAULT_PLAYER_WIDTH` = 16, a full tile) so the body fits
 * through a 1-tile-wide (16px) ladder shaft with solid colliders on each side,
 * leaving 8px of clearance (4px on each side).
 */
export const PLAYER_WIDTH = 8;

/**
 * Vertical climb speed in px/s (Up/Down on a ladder). Passed to the engine's
 * climb ability via `PlatformerConfig.climbSpeed`.
 */
export const CLIMB_SPEED = 120;

/**
 * Play-mode kernel tuning. Matches the tile-room showcase so the feel is
 * consistent across scenes: gravity 1800 px/s², move 180 px/s, an 81px apex
 * (~5 tiles) over 0.3s. Higher and snappier than the bare `PRECISION_PLATFORMER`
 * default (apex 48px / gravity 980), which felt too weak and floaty here.
 * `climbEnabled` opts in to the engine's ladder climb.
 */
export const PLAY_CONFIG: Readonly<PlatformerConfig> = {
  ...PRECISION_PLATFORMER,
  gravity: 1800,
  maxFallSpeed: 720,
  moveSpeed: 180,
  airControl: 0.5,
  jump: {
    ...DEFAULT_JUMP,
    apexHeight: 81,
    timeToApex: 0.3,
  },
  climbEnabled: true,
  climbSpeed: CLIMB_SPEED,
};

/** A running play session. */
export interface PlaySession {
  step(dt: number): void;
  render(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    level: LdtkLevel,
    tilesets: LdtkTilesetBundle,
  ): void;
  dispose(): void;
}

/** Keys the section claims while playing, so the page does not scroll under it. */
const CLAIMED_KEYS: ReadonlySet<string> = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space',
  'KeyA', 'KeyD', 'KeyW', 'KeyS',
]);

/**
 * Start a play session over a translated level.
 *
 * @param level - Level data translated from the LDtk level.
 * @param semantics - Which IntGrid values are solid or passthrough.
 * @param canvas - Canvas the session draws into; used to size the camera.
 * @param ldtkLevel - Original LDtk level, used to tag ladder solids and tint
 *   the player while overlapping a ladder.
 */
export function createPlaySession(
  level: LevelData,
  semantics: GeneratedTileSemantics,
  canvas: HTMLCanvasElement,
  ldtkLevel: LdtkLevel,
): PlaySession {
  const compiled: CompiledLevel = compileGeneratedLevel(
    { level, tileSemantics: semantics },
    { config: PLAY_CONFIG, playerWidth: PLAYER_WIDTH },
  );

  // Precomputed ladder cells (as tile indices) for tagging solids and tinting.
  const ladders = makeLadderMask(ldtkLevel, level.tileSize);

  // Tag any compiled solid that overlaps a ladder cell. The translator emits
  // ladder cells as `passthrough` solids; marking them `ladder: true` makes the
  // AABB resolvers skip them (non-colliding climb space) AND lets the climb
  // ability detect them — both via the one flag. The solid walls flanking a
  // shaft don't overlap ladder cells, so they stay fully solid.
  const solids = compiled.staticSolids.map((s) =>
    isOnLadder(s, ladders) ? { ...s, ladder: true } : s,
  );

  let state: PlatformerState = compiled.initialState;
  let camera: Camera = createCamera();
  const keyboard: KeyboardAdapter = createKeyboardAdapter({
    codeToAction: {
      ArrowLeft: 'left',
      ArrowRight: 'right',
      KeyA: 'left',
      KeyD: 'right',
      Space: 'jump',
      ArrowUp: 'up',
      KeyW: 'up',
      ArrowDown: 'down',
      KeyS: 'down',
      KeyR: 'reset',
    },
  });

  // The platformer claims arrows and space while playing; without this the page
  // scrolls out from under the level on the first jump.
  const suppress = (event: KeyboardEvent): void => {
    if (CLAIMED_KEYS.has(event.code)) event.preventDefault();
  };
  window.addEventListener('keydown', suppress);

  const viewport = { width: canvas.width, height: canvas.height };

  return {
    step(dt) {
      const edges = keyboard.poll();
      const left = edges['left'] ?? IDLE_EDGE;
      const right = edges['right'] ?? IDLE_EDGE;
      const up = edges['up'] ?? IDLE_EDGE;
      const down = edges['down'] ?? IDLE_EDGE;
      if (edges['reset']?.pressed === true) state = compiled.initialState;

      const moveX = left.held === right.held ? 0 : left.held ? -1 : 1;
      // Vertical climb intent consumed by the climb ability while on a ladder:
      // -1 (up), +1 (down), 0 (idle / both held).
      const climb = up.held === down.held ? 0 : up.held ? -1 : 1;
      const input: PlatformerInput = {
        moveX,
        jump: edges['jump'] ?? IDLE_EDGE,
        dash: null,
        climb,
      };
      state = stepPlatformer(state, input, solids, dt, PLAY_CONFIG).state;

      // Falling out of the level is a normal outcome while testing an
      // unfinished room, so respawn rather than letting the actor vanish.
      if (state.core.y > level.height + level.tileSize * 4) {
        state = compiled.initialState;
      }
      camera = updateCamera(
        camera,
        state.core,
        { width: level.width, height: level.height },
        viewport,
      );
    },

    render(context, width, height, ldtkLevel, tilesets) {
      context.imageSmoothingEnabled = false;
      context.fillStyle = '#0b0e12';
      context.fillRect(0, 0, width, height);

      const offsetX = -Math.round(camera.x);
      const offsetY = -Math.round(camera.y);
      drawLdtkLevel(context, ldtkLevel, {
        tilesets,
        worldOffset: { x: offsetX, y: offsetY },
        view: { x: camera.x, y: camera.y, width, height },
      });

      const { core } = state;
      context.fillStyle = isOnLadder(core, ladders)
        ? PLAYER_LADDER_COLOR
        : PLAYER_COLOR;
      context.fillRect(core.x + offsetX, core.y + offsetY, core.width, core.height);
      context.strokeStyle = PLAYER_OUTLINE;
      context.lineWidth = 1;
      context.strokeRect(
        core.x + offsetX + 0.5,
        core.y + offsetY + 0.5,
        core.width - 1,
        core.height - 1,
      );
    },

    dispose() {
      window.removeEventListener('keydown', suppress);
      keyboard.dispose();
    },
  };
}

/**
 * Precomputed ladder cells. Built once from the LDtk IntGrid (the bundled
 * sample marks ladders as value {@link LADDER_INT_GRID_VALUE} on its
 * `Collisions` layer) and queried per-tick to tag solids and tint the player.
 */
export interface LadderMask {
  /** Pixel edge length of one cell. Matches the collision layer's `__gridSize`. */
  readonly size: number;
  /** Cells in the collision layer, as `"<tx>,<ty>"` strings. */
  readonly cells: ReadonlySet<string>;
}

/** Empty mask — nothing is a ladder. Returned when no IntGrid layer exists. */
const EMPTY_LADDER_MASK: LadderMask = { size: 16, cells: new Set<string>() };

/**
 * Collect every ladder IntGrid cell in `ldtkLevel` into a fast lookup mask.
 * Falls back to an empty mask (no ladders) if there is no IntGrid layer; the
 * collision layer's `__gridSize` is used so the mask stays correct when it
 * differs from the engine `tileSize`.
 */
export function makeLadderMask(ldtkLevel: LdtkLevel, fallbackTileSize: number): LadderMask {
  const layers = ldtkLevel.layerInstances;
  if (layers === null) return EMPTY_LADDER_MASK;
  for (const layer of layers) {
    if (layer.__type !== 'IntGrid') continue;
    const csv = layer.intGridCsv;
    if (csv === undefined) continue;
    const cells = new Set<string>();
    for (let i = 0; i < csv.length; i++) {
      if (csv[i] === LADDER_INT_GRID_VALUE) {
        const ty = Math.floor(i / layer.__cWid);
        const tx = i - ty * layer.__cWid;
        cells.add(`${tx},${ty}`);
      }
    }
    return { size: layer.__gridSize, cells };
  }
  return { size: fallbackTileSize, cells: new Set<string>() };
}

/**
 * Whether the body's AABB covers any ladder cell in `mask`. Inclusive tile
 * range, matching the collision query convention. Used to tag solids and to
 * tint the player while overlapping a ladder.
 */
export function isOnLadder(
  body: Readonly<{ x: number; y: number; width: number; height: number }>,
  mask: LadderMask,
): boolean {
  if (mask.cells.size === 0) return false;
  const { size, cells } = mask;
  const minX = Math.floor(body.x / size);
  const maxX = Math.floor((body.x + body.width - 1) / size);
  const minY = Math.floor(body.y / size);
  const maxY = Math.floor((body.y + body.height - 1) / size);
  for (let ty = minY; ty <= maxY; ty++) {
    for (let tx = minX; tx <= maxX; tx++) {
      if (cells.has(`${tx},${ty}`)) return true;
    }
  }
  return false;
}
