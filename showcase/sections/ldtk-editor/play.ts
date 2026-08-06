/**
 * Play mode — run the platformer on the level currently being edited.
 *
 * The bridge is `ldtkLevelToLevelData`: the LDtk IntGrid becomes the engine's
 * `TileGrid`, and the same compiled geometry the runtime uses drives collision.
 * The art stays LDtk's, drawn by the same `drawLdtkLevel` the editor uses, so
 * play mode is the level as it will actually ship rather than a preview.
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
import { createJumpState } from '../../../src/animation/jump';
import { createCamera, updateCamera, type Camera } from '../../../src/camera';
import {
  createKeyboardAdapter,
  type KeyboardAdapter,
  type PolledEdge,
} from '../../../src/input';
import { drawLdtkLevel, type LdtkLevel, type LdtkTilesetBundle } from '../../../src/ldtk';
import type { LevelData } from '../../../src/level/types';
import type { GeneratedTileSemantics } from '../../../src/level/tile-semantics';
import type { Solid } from '../../../src/collision';

/** An edge that is never pressed — the default for an unmapped action. */
const IDLE_EDGE: PolledEdge = { pressed: false, released: false, held: false };

/** Colors for the play-mode actor. */
const PLAYER_COLOR = '#ffd166';
const PLAYER_OUTLINE = '#1d1300';
/** Fill color while the player overlaps a ladder cell. */
const PLAYER_LADDER_COLOR = '#7CFC9E';

/**
 * IntGrid value identifying a ladder in the bundled platformer sample's
 * `Collisions` layer (`{ value: 2, identifier: 'ladder' }`). Used only to tint
 * the player while overlapping — climb itself is key-driven (see `CLIMB_SPEED`).
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
 * Vertical climb speed in px/s used while holding Up or Down on a ladder.
 * Applied by overriding `core.vy` after `stepPlatformer` runs, so gravity and
 * jump still resolve normally but a held vertical direction wins out — keeping
 * the ladder handling deliberately simple (no snap-to-ladder state machine).
 */
export const CLIMB_SPEED = 120;

/**
 * Gravity-free config used while the player is on a ladder, so they stick in
 * place while idle and a climb override (see `stepLadderPlay`) is not fought
 * by gravity. Same as `PRECISION_PLATFORMER` but with gravity zeroed; the
 * terminal fall speed is kept at the normal value so the climb override (which
 * sets `vy` directly) is not clamped to zero by the kernel's max-fall clamp.
 */
export const ZERO_GRAVITY_CONFIG: Readonly<PlatformerConfig> = {
  ...PRECISION_PLATFORMER,
  gravity: 0,
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
 * @param ldtkLevel - Original LDtk level, used to precompute the ladder tile
 *   mask for the stick-to-ladder feel and the overlap tint.
 */
export function createPlaySession(
  level: LevelData,
  semantics: GeneratedTileSemantics,
  canvas: HTMLCanvasElement,
  ldtkLevel: LdtkLevel,
): PlaySession {
  const config: Readonly<PlatformerConfig> = PRECISION_PLATFORMER;
  const compiled: CompiledLevel = compileGeneratedLevel(
    { level, tileSemantics: semantics },
    { config, playerWidth: PLAYER_WIDTH },
  );

  // Precomputed ladder cells (as tile indices into the collision layer), so
  // both the stick-to-ladder physics and the overlap tint share one source of
  // truth without re-reading the LDtk level each frame.
  const ladders = makeLadderMask(ldtkLevel, level.tileSize);

  // Collision solids with ladder cells removed. The translator marks ladders
  // as `passthrough` (one-way platforms), so without this they act as floors
  // when climbing down. Ladders are climb space, not geometry — drop any solid
  // whose rect overlaps a ladder cell; the solid walls flanking the shaft stay.
  const solids = compiled.staticSolids.filter((s) => !isOnLadder(s, ladders));

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
      const jumpEdge = edges['jump'] ?? IDLE_EDGE;
      // Climb intent derived from held Up/Down: ±CLIMB_SPEED when one wins,
      // 0 when both or neither are held.
      const climbY = up.held === down.held
        ? 0
        : up.held
          ? -CLIMB_SPEED
          : CLIMB_SPEED;
      state = stepLadderPlay(
        state,
        { moveX, jump: jumpEdge.pressed, climbY },
        solids,
        ladders,
        dt,
        config,
      );

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
 * Per-tick play intent, distilled from polled keyboard edges. This is the
 * testable cut: the real session derives it from `window` keyboard events,
 * but tests (and any future input source) can pass it directly. The vertical
 * `climbY` carries the resolved ladder climb (±{@link CLIMB_SPEED} or 0).
 */
export interface LadderPlayIntent {
  /** Horizontal movement: -1 left, 0 idle, +1 right. */
  readonly moveX: -1 | 0 | 1;
  /** Whether jump was pressed this tick. */
  readonly jump: boolean;
  /** Resolved vertical climb velocity in px/s (negative = up, positive = down). */
  readonly climbY: number;
}

/**
 * Advance the play session one tick, applying the deliberately-simple ladder
 * feel. Pure: no host access, no closures over the session — the same logic
 * the real `step()` runs, factored out so tests can drive it directly.
 *
 * Ladder rules (no snap-to-ladder state machine):
 *   - On a ladder and not jumping → gravity is cancelled (zero-g config) so the
 *     player sticks while idle and `climbY` sets a steady climb with nothing
 *     fighting it. The ladder cells are already removed from `solids`, so they
 *     never act as one-way-platform floors.
 *   - On a ladder and climbing → `vy` is overridden to `climbY`.
 *   - On a ladder and idle → `vy` is zeroed to kill any residual drift.
 *   - Jumping, or off the ladder → normal gravity applies and `climbY` is ignored.
 */
export function stepLadderPlay(
  state: PlatformerState,
  intent: LadderPlayIntent,
  solids: readonly Solid[],
  ladders: LadderMask,
  dt: number,
  config: Readonly<PlatformerConfig>,
): PlatformerState {
  const jumpEdge: PolledEdge = intent.jump
    ? { pressed: true, released: false, held: true }
    : IDLE_EDGE;
  const input: PlatformerInput = {
    moveX: intent.moveX,
    jump: jumpEdge,
    dash: null,
  };

  const onLadder = isOnLadder(state.core, ladders);
  const startCoreY = state.core.y;

  // When on a ladder and not jumping, the ladder is authoritative for vertical
  // motion. The jump ability runs its own gravity inside `stepPlatformer`
  // (independent of the kernel's config.gravity), so zeroing the kernel gravity
  // is not enough to stop a fall. Instead we run the step (so horizontal move
  // and collision still resolve), then restore the ladder-authoritative Y:
  // start Y plus the intended climb delta (0 when idle → sticks in place).
  const ladderAuthoritative = onLadder && !intent.jump;
  const effectiveConfig: Readonly<PlatformerConfig> = ladderAuthoritative
    ? ZERO_GRAVITY_CONFIG
    : config;
  let next = stepPlatformer(state, input, solids, dt, effectiveConfig).state;

  if (ladderAuthoritative) {
    const targetY = startCoreY + intent.climbY * dt;
    next = { ...next, core: { ...next.core, y: targetY, vy: intent.climbY } };
    // The jump ability runs its own gravity inside `stepPlatformer` and writes
    // it back to `core.vy` from an internal state that drifts while we hold the
    // ladder-authoritative Y (the cause of the broken jump-off-ladder feel).
    // Resetting the jump slice to a fresh grounded state each ladder tick stops
    // the drift, so leaving the ladder or jumping resumes clean physics with no
    // stale momentum and no slow landing-recovery.
    next = {
      ...next,
      abilities: {
        ...next.abilities,
        jump: { kind: 'jump', jump: createJumpState(config.jump) },
      },
    };
  }

  return next;
}

/**
 * Precomputed ladder cells. Built once from the LDtk IntGrid (the bundled
 * sample marks ladders as value {@link LADDER_INT_GRID_VALUE} on its
 * `Collisions` layer) and queried per-tick by both the stick-to-ladder
 * physics and the overlap tint.
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
 * range, matching the collision query convention. Used by both physics (the
 * stick-to-ladder gravity cancel) and the render tint so they agree.
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
