/**
 * Play mode — run the platformer on the level currently being edited.
 *
 * The bridge is `ldtkLevelToLevelData`: the LDtk IntGrid becomes the engine's
 * `TileGrid`, and the same compiled geometry the runtime uses drives collision.
 * The art stays LDtk's, drawn by the same `drawLdtkLevel` the editor uses, so
 * play mode is the level as it will actually ship rather than a preview.
 *
 * Ladder climbing is handled by the engine's climb ability (`climbEnabled` in
 * the config below). Ladder IntGrid values are excluded from `solid` during
 * translation (so they never form blocking rects or get merged into walls) and
 * re-emitted as one `ladder: true` solid per cell: the AABB resolvers skip them
 * (non-colliding climb space) and the climb ability reads them to drive
 * ascent/descent and the stick-to-ladder feel. This keeps climb and jump from
 * desyncing — the ability owns vertical motion inside the pipeline rather than
 * fighting it from outside.
 *
 * The session owns a clone of the level data; nothing it does can write back
 * into the project being edited.
 */

import {
  compileGeneratedLevel,
  createPlatformerState,
  EMPTY_CONTACTS,
  stepPlatformer,
  PRECISION_PLATFORMER,
  advanceSquash,
  DEFAULT_SQUASH_CONFIG,
  IDENTITY_SCALE,
  type CompiledLevel,
  type PlatformerConfig,
  type PlatformerInput,
  type PlatformerState,
} from '../../../src/platformer';
import {
  createSpriteAnimState,
  advanceSpriteAnim,
  deriveSpriteAnimKind,
  type SpriteAnimState,
} from '../../../src/sprites';
import {
  createMobActors,
  drawPlayerSprite,
  SPRITE_ANIM_TIME_SCALE,
  type MobActors,
  type SpriteBundle,
} from './mob-sprites';
import type { Solid } from '../../../src/collision';
import { DEFAULT_JUMP } from '../../../src/animation/jump';
import { createCamera, updateCamera, type Camera } from '../../../src/camera';
import {
  createKeyboardAdapter,
  type KeyboardAdapter,
  type PolledEdge,
} from '../../../src/input';
import {
  drawLdtkLevel,
  ldtkLevelToLevelData,
  type LdtkLevel,
  type LdtkNeighbour,
  type LdtkProject,
  type LdtkTilesetBundle,
} from '../../../src/ldtk';
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
 * Fallback IntGrid value used to identify ladders when a project declares no
 * value named `'ladder'` in its defs. Matches the bundled platformer sample's
 * `Collisions` layer (`{ value: 2, identifier: 'ladder' }`). The real ladder
 * value is resolved per level from the project's IntGrid value names — see
 * {@link ladderValueFromProject} — so a project can use any integer for ladders
 * as long as it names the value `'ladder'` (any case).
 */
const LADDER_INT_GRID_VALUE = 2;

/**
 * Reference tile size the play tuning was authored against. Everything below —
 * player body, gravity, jump apex, speeds — is expressed relative to this, then
 * scaled by the level's actual tile size so the *feel* is the same in a 16px
 * platformer and an 8px auto-layer sample.
 */
const REFERENCE_TILE = 16;

/**
 * Player body width as a fraction of a tile — half a tile, narrower than the
 * engine default (a full tile) so the body fits through a 1-tile-wide ladder
 * shaft with solid colliders on each side.
 */
const PLAYER_WIDTH_TILES = 0.5;

/**
 * Vertical climb speed in tiles/s. Scaled to pixels per second at session start
 * from the level's tile size, then passed to the engine's climb ability via
 * `PlatformerConfig.climbSpeed`.
 */
export const CLIMB_SPEED_TILES = 7.5;

/**
 * Build the play config for a level, scaling every pixel value by the level's
 * tile size relative to the 16px reference.
 *
 * The feel is authored at the reference size (gravity 1800 px/s², move 180 px/s,
 * an 81px apex over 0.3s) and kept constant in *tile* units: a level with 8px
 * tiles gets half the gravity, half the apex, etc., so a jump covers the same
 * number of tiles either way. Without this a small-tile level feels like the
 * player is on the moon.
 */
function playConfigFor(tileSize: number): Readonly<PlatformerConfig> {
  const s = tileSize / REFERENCE_TILE;
  return {
    ...PRECISION_PLATFORMER,
    gravity: 1800 * s,
    maxFallSpeed: 720 * s,
    moveSpeed: 180 * s,
    airAccelMultiplier: 0.5,
    jump: {
      ...DEFAULT_JUMP,
      apexHeight: 81 * s,
      timeToApex: 0.3,
    },
    climbEnabled: true,
    climbSpeed: CLIMB_SPEED_TILES * tileSize,
    // Phase 6 — wall-grab on (the KeyK binding above feeds `input.grab`). The
    // ability is OFF in DEFAULT_PLATFORMER_CONFIG; the showcase opts in so the
    // grab key does something in play mode.
    wallGrabEnabled: true,
    // Let the player walk up small steps: stair lips, minor ledges, and the
    // last few px of a ladder-top exit (the climb guard leaves the player one
    // climb step below a flush platform). Half a tile is enough to bridge those
    // without letting the player auto-climb full-tile walls.
    stepHeight: 0.5 * tileSize,
  };
}

/**
 * Player body width in world px at a given tile size.
 *
 * Exported (and kept as a number, not the old fixed constant) so the ladder
 * tests can read the value the session actually uses rather than a magic 8.
 */
export function playerWidthFor(tileSize: number): number {
  return PLAYER_WIDTH_TILES * tileSize;
}

/**
 * Player body height in world px. Two tiles tall at the reference size, scaled
 * with the tile so the proportions are constant.
 */
export function playerHeightFor(tileSize: number): number {
  return 1.5 * tileSize;
}

/**
 * The zoom that makes a level fill the canvas.
 *
 * Play mode has no editor viewport/pan, so a small level (the auto-layer
 * samples are a few hundred px) should scale *up* to fill the canvas rather
 * than sit as a thumbnail. A level larger than the canvas on either axis stays
 * at 1× — the follow-camera scrolls to follow the player, and upscaling already
 * large pixel art only softens it. Pixel art scaled up by an integer factor
 * stays crisp (the renderer keeps `imageSmoothingEnabled = false`).
 *
 * Nudged down a hair so a level that *just* fits does not round-overflow by a
 * pixel and clip its border.
 */
function fitZoom(
  level: Readonly<{ width: number; height: number }>,
  canvas: Readonly<{ width: number; height: number }>,
): number {
  const fitsWidth = level.width <= canvas.width;
  const fitsHeight = level.height <= canvas.height;
  if (!fitsWidth || !fitsHeight) return 1;
  const fit = Math.min(canvas.width / level.width, canvas.height / level.height);
  return fit * 0.98;
}

// --- level transitions --------------------------------------------------

/**
 * The cardinal directions a level neighbour can sit in. LDtk's `dir` field
 * also permits diagonals (`'ne'` …), but this sample's edges are all cardinal
 * and a diagonal exit has no room to transition into; those fall through to the
 * usual fall-out-of-level respawn.
 */
export type CardinalDir = 'n' | 's' | 'e' | 'w';

/** A transition the player has triggered by leaving the active level. */
export interface LevelTransition {
  /** The edge the player crossed. */
  readonly dir: CardinalDir;
  /** The neighbour record from the active level's `__neighbours`. */
  readonly neighbour: LdtkNeighbour;
}

/**
 * Which edge (if any) the player has left the level through, and the neighbour
 * that edge links to.
 *
 * Triggers when the player's AABB crosses past the level's pixel bounds. The
 * edge is chosen by the axis the player is furthest out of bounds on, so a
 * corner exit resolves to the dominant axis rather than picking arbitrarily.
 * Returns `undefined` when the player is inside the level, or when the crossed
 * edge has no cardinal neighbour (the void — handled by the respawn fallback).
 *
 * Pure over its inputs; unit-tested without a canvas.
 */
export function transitionFor(
  body: Readonly<{ x: number; y: number; width: number; height: number }>,
  level: Readonly<{ pxWid: number; pxHei: number; __neighbours: readonly LdtkNeighbour[] }>,
): LevelTransition | undefined {
  const overTop = -body.y; // >0 when the body's top is above y=0
  const overBottom = body.y + body.height - level.pxHei; // >0 when past the floor
  const overLeft = -body.x;
  const overRight = body.x + body.width - level.pxWid;

  // Only an out-of-bounds axis can trigger; pick the most-past axis for a
  // corner exit so the player enters the room they were mostly heading into.
  const maxOver = Math.max(overTop, overBottom, overLeft, overRight);
  if (maxOver <= 0) return undefined;
  let dir: CardinalDir;
  if (maxOver === overTop) dir = 'n';
  else if (maxOver === overBottom) dir = 's';
  else if (maxOver === overLeft) dir = 'w';
  else dir = 'e';

  const neighbour = level.__neighbours.find((n) => n.dir === dir);
  if (neighbour === undefined) return undefined;
  return { dir, neighbour };
}

/**
 * Where the player should enter the target level, in the target's local space.
 *
 * The player's position is converted through world space: world pos is the
 * active level's local pos plus its `worldX/worldY` origin, then the target's
 * origin is subtracted back out. Because linked edges are flush in this sample
 * (e.g. Top's bottom edge sits at the same worldY as the main level's top),
 * the seam maps to the matching edge of the target room — walk north, enter at
 * the target's bottom edge.
 *
 * The entry is clamped inside the target's bounds so a player crossing where
 * the rooms only partially overlap still lands inside the new room rather than
 * back out in the void. Pure; unit-tested against the real sample geometry.
 */
export function entryPoint(
  body: Readonly<{ x: number; y: number; width: number; height: number }>,
  from: Readonly<{ worldX: number; worldY: number }>,
  to: Readonly<{ worldX: number; worldY: number; pxWid: number; pxHei: number }>,
): { x: number; y: number } {
  const worldX = body.x + from.worldX;
  const worldY = body.y + from.worldY;
  const localX = worldX - to.worldX;
  const localY = worldY - to.worldY;
  return {
    x: Math.max(0, Math.min(localX, to.pxWid - body.width)),
    y: Math.max(0, Math.min(localY, to.pxHei - body.height)),
  };
}

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
  /** The level currently being played (changes on a transition). */
  activeLdtkLevel(): LdtkLevel;
  dispose(): void;
}

/** Keys the section claims while playing, so the page does not scroll under it. */
const CLAIMED_KEYS: ReadonlySet<string> = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space',
  'KeyA', 'KeyD', 'KeyW', 'KeyS',
]);

/**
 * Compiled runtime data for one level — everything `step`/`render` need, cached
 * the first time a room is entered so revisits are instant.
 */
interface LevelRuntime {
  readonly ldtkLevel: LdtkLevel;
  readonly levelData: LevelData;
  readonly compiled: CompiledLevel;
  readonly solids: readonly { readonly id?: string; readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly ladder?: boolean }[];
  readonly ladders: LadderMask;
}

/**
 * Resolve a level anywhere in a project (single- or multi-world) by iid.
 * Mirrors the lookup in `./document`'s `findLevel`, kept local so play.ts needs
 * no extra import.
 */
function findLevelInProject(project: LdtkProject, iid: string): LdtkLevel | undefined {
  for (const level of project.levels) if (level.iid === iid) return level;
  for (const world of project.worlds) {
    for (const level of world.levels) if (level.iid === iid) return level;
  }
  return undefined;
}

/** Options for {@link createPlaySession}. */
export interface PlaySessionOptions {
  /**
   * Called when the player crosses into a new level. Receives the level's
   * identifier, for a status-line indicator. Optional.
   */
  readonly onLevelChange?: (identifier: string) => void;
  /**
   * Optional sprite bundle for the PLAYER. When supplied, the player is drawn
   * as a sprite selected from physics via `deriveSpriteAnimKind`. This may be a
   * different sheet from `mobSprites` — e.g. the full-color 0x72 knight for the
   * player while mobs still come from the Kenney sheet. When omitted, the
   * player is a colored rect (the legacy behavior).
   */
  readonly sprites?: SpriteBundle;
  /**
   * Optional sprite bundle for patrolling MOBS. Defaults to `sprites` when not
   * specified (the legacy single-bundle behavior). Pass a separate bundle when
   * the player sheet (e.g. the 0x72 knight) does not define the mob characters
   * (`slime`/`walker`); mobs then animate from this sheet instead. When both
   * this and `sprites` are omitted, mobs are not rendered.
   */
  readonly mobSprites?: SpriteBundle;
}

/**
 * Start a play session over a translated level.
 *
 * The session owns the whole project so it can follow `__neighbours` links and
 * switch rooms when the player walks off an edge. Each room is compiled lazily
 * on first entry (same translation + compile + ladder-tag pipeline as the
 * starting level) and cached. The active level pointer is the session's own —
 * it never disturbs the editor's selection.
 *
 * @param startLevel - Level data translated from the starting LDtk level.
 * @param semantics - Which IntGrid values are solid or passthrough for the start level.
 * @param canvas - Canvas the session draws into; used to size the camera.
 * @param startLdtkLevel - Original LDtk level, for ladder tagging and rendering.
 * @param project - The whole project, so neighbours can be resolved on transition.
 * @param options - Optional callbacks.
 */
export function createPlaySession(
  startLevel: LevelData,
  semantics: GeneratedTileSemantics,
  canvas: HTMLCanvasElement,
  startLdtkLevel: LdtkLevel,
  project: LdtkProject,
  options: Readonly<PlaySessionOptions> = {},
): PlaySession {
  const config = playConfigFor(startLevel.tileSize);
  const playerWidth = playerWidthFor(startLevel.tileSize);
  const playerHeight = playerHeightFor(startLevel.tileSize);

  // Per-level compile cache. The start level is compiled eagerly; neighbours
  // compile on first transition. Re-compiling on every step would be wasteful
  // and would re-seed ladder masks each frame.
  const cache = new Map<string, LevelRuntime>();
  function compileLevel(ldtkLevel: LdtkLevel, levelData: LevelData, semantics: GeneratedTileSemantics): LevelRuntime {
    const compiled = compileGeneratedLevel(
      { level: levelData, tileSemantics: semantics },
      { config, playerWidth, playerHeight },
    );
    const ladderValue = ladderValueFromProject(project, ldtkLevel) ?? LADDER_INT_GRID_VALUE;
    const ladders = makeLadderMask(ldtkLevel, levelData.tileSize, ladderValue);
    // Ladders are pure climb space: one non-colliding `ladder: true` solid per
    // ladder cell, emitted separately from the compiled wall/floor solids. This
    // keeps ladder cells out of the merged wall rects (which previously let a
    // merged rect that happened to span a ladder cell get mis-tagged `ladder`
    // and become fully non-colliding — the "walls act as passthrough" bug).
    // The name-driven translation now excludes ladder values from `solid`, so
    // the compiled solids never contain ladder cells in the first place; these
    // per-cell solids are what the climb ability reads via `overlapsLadder`.
    const ladderSolids = ladderMaskToSolids(ladders);
    const solids = [...compiled.staticSolids, ...ladderSolids];
    return { ldtkLevel, levelData, compiled, solids, ladders };
  }
  function getLevel(iid: string): LevelRuntime | undefined {
    const cached = cache.get(iid);
    if (cached !== undefined) return cached;
    const ldtkLevel = findLevelInProject(project, iid);
    if (ldtkLevel === undefined) return undefined;
    const translated = ldtkLevelToLevelData(ldtkLevel, project);
    if (translated.level === undefined) return undefined;
    const runtime = compileLevel(ldtkLevel, translated.level, translated.tileSemantics);
    cache.set(iid, runtime);
    return runtime;
  }

  // Active room. Begins as the start level — reuses the already-translated
  // start level + semantics rather than re-translating.
  let active = compileLevel(startLdtkLevel, startLevel, semantics);
  cache.set(startLdtkLevel.iid, active);

  // Sprite state (only when a bundle was supplied). The player's anim clock is
  // session-wide; mobs are per-level (each room has its own instances and its
  // own independent patrol sim), cached alongside the level runtime. The player
  // bundle (`sprites`) and the mob bundle (`mobSprites`, defaulting to `sprites`)
  // may differ: the 0x72 knight sheet defines only the player, so mobs continue
  // to animate from the Kenney sheet that carries the `slime`/`walker` characters.
  const sprites = options.sprites;
  const mobSprites = options.mobSprites ?? options.sprites;
  let playerAnim: SpriteAnimState | null = sprites === undefined ? null : createSpriteAnimState();
  const mobActorsByLevel = new Map<string, MobActors>();
  function mobActorsFor(level: LdtkLevel): MobActors | null {
    if (mobSprites === undefined) return null;
    const cached = mobActorsByLevel.get(level.iid);
    if (cached !== undefined) return cached;
    const actors = createMobActors(level, mobSprites);
    if (actors !== null) mobActorsByLevel.set(level.iid, actors);
    return actors;
  }
  let mobs = mobActorsFor(startLdtkLevel);

  let state: PlatformerState = active.compiled.initialState;
  let camera: Camera = createCamera();
  // Phase 8c — per-event squash & stretch FX. The TRANSIENT scale lives HERE in
  // the play-session closure (the renderer), NOT on `PlatformerState` — it is
  // pure presentation, never affects physics trajectories or replay state, and
  // carries no `physicsVersion` impact. Advanced once per tick from the
  // kernel's emitted events; applied to the player draw in `render`.
  let currentSquash = IDENTITY_SCALE;
  const squashConfig = config.squash ?? DEFAULT_SQUASH_CONFIG;
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
      // Dash is bound to Left Shift (ShiftLeft) — the Celeste/industry-standard
      // dash key, and non-conflicting with the move/jump/climb/reset mappings
      // above. The dash ability runs once `input.dash` is non-null; `dashEnabled`
      // is inherited as `true` from `PRECISION_PLATFORMER` via `playConfigFor`.
      ShiftLeft: 'dash',
      // Wall-grab is bound to KeyK (Phase 6 — Celeste uses `C`/`Z` for grab;
      // KeyK is the common non-conflicting alternative, clear of the WASD
      // cluster and ShiftLeft dash). The grab ability runs once `input.grab` is
      // non-null; `wallGrabEnabled` is turned on below in `playConfigFor`.
      KeyK: 'grab',
    },
  });

  // The platformer claims arrows and space while playing; without this the page
  // scrolls out from under the level on the first jump.
  const suppress = (event: KeyboardEvent): void => {
    if (CLAIMED_KEYS.has(event.code)) event.preventDefault();
  };
  window.addEventListener('keydown', suppress);

  const viewport = { width: canvas.width, height: canvas.height };
  // Zoom recomputed per-room on transition: rooms differ in size, so a fixed
  // zoom would over/under-fill. The follow-camera sees the canvas divided by
  // the zoom so its centering letterboxes the room inside the scaled view.
  let zoom = fitZoom(active.levelData, viewport);
  let worldView = { width: viewport.width / zoom, height: viewport.height / zoom };

  return {
    step(dt) {
      const edges = keyboard.poll();
      const left = edges['left'] ?? IDLE_EDGE;
      const right = edges['right'] ?? IDLE_EDGE;
      const up = edges['up'] ?? IDLE_EDGE;
      const down = edges['down'] ?? IDLE_EDGE;
      if (edges['reset']?.pressed === true) {
        state = active.compiled.initialState;
        // Reset the render-only squash with the respawned character.
        currentSquash = IDENTITY_SCALE;
      }

      const moveX = left.held === right.held ? 0 : left.held ? -1 : 1;
      // Vertical intent (Phase 4): drives the climb ability while on a ladder
      // (-1 up / +1 down) AND the fast-fall cap (holding down eases the max-fall
      // cap up toward `fastMaxFallSpeed`). 0 when idle / both held.
      const moveY = up.held === down.held ? 0 : up.held ? -1 : 1;
      const input: PlatformerInput = {
        moveX,
        moveY,
        jump: edges['jump'] ?? IDLE_EDGE,
        dash: edges['dash'] ?? IDLE_EDGE,
        // Phase 6 — wall-grab edge. `null` (absent) would disable grab; the
        // KeyK binding above feeds a real edge, so `IDLE_EDGE` (held=false) is
        // the correct "mapped but not pressed" default rather than `null`.
        grab: edges['grab'] ?? IDLE_EDGE,
      };
      state = stepPlatformer(state, input, active.solids, dt, config).state;

      // Phase 8c — advance the render-only squash from this tick's emitted
      // events + the resolved core velocity. `moveY === 1 && vy > 0` is the
      // fast-fall signal (holding down while descending). Held in the session
      // closure, never on PlatformerState — pure presentation.
      const fastFalling = moveY === 1 && state.core.vy > 0;
      currentSquash = advanceSquash(
        currentSquash,
        {
          events: state.events,
          coreVx: state.core.vx,
          coreVy: state.core.vy,
          fastFalling,
          dt,
        },
        squashConfig,
      );

      // Level transition: did the player leave the active room through a linked
      // edge? Resolve the neighbour, compile it (cached), and reposition the
      // player at the matching seam — preserving momentum so the world feels
      // continuous rather than teleporting between rooms.
      const exit = transitionFor(state.core, active.ldtkLevel);
      if (exit !== undefined) {
        const target = getLevel(exit.neighbour.levelIid);
        if (target !== undefined) {
          const entry = entryPoint(state.core, active.ldtkLevel, target.ldtkLevel);
          // Keep vx/vy/facing (momentum), reset contacts (new geometry).
          state = {
            ...createPlatformerState(entry.x, entry.y, config, playerWidth, playerHeight),
            core: {
              ...state.core,
              x: entry.x,
              y: entry.y,
              onGround: false,
              contacts: EMPTY_CONTACTS,
            },
          };
          active = target;
          mobs = mobActorsFor(active.ldtkLevel);
          camera = createCamera();
          zoom = fitZoom(active.levelData, viewport);
          worldView = { width: viewport.width / zoom, height: viewport.height / zoom };
          options.onLevelChange?.(active.ldtkLevel.identifier);
        }
      }

      // Falling out of the level is a normal outcome while testing an
      // unfinished room, so respawn rather than letting the actor vanish.
      if (state.core.y > active.levelData.height + active.levelData.tileSize * 4) {
        state = active.compiled.initialState;
        // Reset the render-only squash with the respawned character.
        currentSquash = IDENTITY_SCALE;
      }
      camera = updateCamera(
        camera,
        state.core,
        { width: active.levelData.width, height: active.levelData.height },
        worldView,
      );

      // Advance the sprite animation clocks at the shared scaled rate (the
      // frame-player works in milliseconds, but `SPRITE_ANIM_TIME_SCALE` slows
      // the cast so the 2-frame walk cycles don't shuffle).
      if (playerAnim !== null) playerAnim = advanceSpriteAnim(playerAnim, dt * 1000 * SPRITE_ANIM_TIME_SCALE);
      mobs?.step(dt);
    },

    render(context, width, height, ldtkLevel, tilesets) {
      context.imageSmoothingEnabled = false;
      context.fillStyle = '#0b0e12';
      context.fillRect(0, 0, width, height);

      const offsetX = -Math.round(camera.x);
      const offsetY = -Math.round(camera.y);
      // One world-space transform: scale up, then apply the camera offset. The
      // camera's centering (it goes negative when the level is smaller than
      // worldView) letterboxes the level inside the canvas for free — no extra
      // offset that would compound with the camera and shove the level aside.
      context.save();
      context.scale(zoom, zoom);
      drawLdtkLevel(context, ldtkLevel, {
        tilesets,
        worldOffset: { x: offsetX, y: offsetY },
        view: { x: camera.x, y: camera.y, width: worldView.width, height: worldView.height },
      });

      const { core } = state;

      // Patrolling mobs: drawn before the player so the player reads on top.
      // `MobActors.draw` takes the camera offset since the world transform is
      // scale-only here (the level was drawn with an explicit `worldOffset`).
      if (mobs !== null) {
        mobs.draw(context, { x: offsetX, y: offsetY });
      }

      // Player: sprite when a bundle is present (selected from physics), else
      // the legacy colored rect. The sprite source is a square 16px cell; drawn
      // at one tile so it scales by a clean integer (1× at 16px tiles, 2× at
      // 8px tiles) and stays pixel-crisp. The collision body is taller than it
      // is wide (0.5×1.5 tiles — narrow so it fits one-tile ladder shafts), so
      // the sprite is bottom-anchored to the body's feet and horizontally
      // centred on the narrow body. Dest coords are snapped to whole pixels so
      // the float physics position doesn't bleed across edges mid-stride.
      //
      // Phase 8c — the per-event squash & stretch scale (held in this closure,
      // never on PlatformerState) is applied around the player draw, pivoted at
      // the FEET (bottom-center of the body) so a launch stretch reads as
      // pushing off the ground and a landing squash reads as compressing into
      // it. Identity (`1, 1`) is a no-op transform, so the squash only changes
      // the silhouette when an event fired or the ease-back is mid-recovery.
      const feetX = core.x + offsetX + core.width / 2;
      const feetY = core.y + offsetY + core.height;
      context.save();
      context.translate(feetX, feetY);
      context.scale(currentSquash.scaleX, currentSquash.scaleY);
      context.translate(-feetX, -feetY);
      let drewSprite = false;
      if (sprites !== undefined && playerAnim !== null) {
        const kind = deriveSpriteAnimKind({
          supported: core.onGround,
          speedX: core.vx,
          velocityY: core.vy,
        });
        const spriteSize = active.levelData.tileSize;
        drewSprite = drawPlayerSprite(
          context,
          sprites,
          playerAnim,
          kind,
          // Centre the (square) sprite on the narrow body.
          Math.round(core.x + offsetX + (core.width - spriteSize) / 2),
          // Bottom-anchor: the sprite's feet meet the body's bottom edge.
          Math.round(core.y + offsetY + core.height - spriteSize),
          core.facing,
          spriteSize,
        );
      }
      if (!drewSprite) {
        context.fillStyle = isOnLadder(core, active.ladders)
          ? PLAYER_LADDER_COLOR
          : PLAYER_COLOR;
        context.fillRect(core.x + offsetX, core.y + offsetY, core.width, core.height);
        context.strokeStyle = PLAYER_OUTLINE;
        context.lineWidth = 1 / zoom;
        context.strokeRect(
          core.x + offsetX + 0.5 / zoom,
          core.y + offsetY + 0.5 / zoom,
          core.width - 1 / zoom,
          core.height - 1 / zoom,
        );
      }
      context.restore();
      context.restore();
    },

    activeLdtkLevel() {
      return active.ldtkLevel;
    },

    dispose() {
      window.removeEventListener('keydown', suppress);
      keyboard.dispose();
      for (const actors of mobActorsByLevel.values()) actors.dispose();
    },
  };
}

/**
 * Precomputed ladder cells. Built once from the LDtk IntGrid (the bundled
 * sample marks ladders as value {@link LADDER_INT_GRID_VALUE} on its
 * `Collisions` layer) and used to emit per-cell `ladder: true` solids
 * ({@link ladderMaskToSolids}) and to tint the player while overlapping a
 * ladder.
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
 * Resolve the IntGrid integer that marks ladders in `ldtkLevel` by looking up
 * the level's IntGrid layer definition in `project.defs.layers` and finding the
 * declared value whose identifier is `'ladder'` (case-insensitive, so
 * `'Ladder'` and `'LADDER'` all match).
 *
 * Returns `undefined` when the level has no IntGrid layer, the project has no
 * matching layer definition, or no value is named `'ladder'` — in which case
 * the caller falls back to {@link LADDER_INT_GRID_VALUE}.
 */
export function ladderValueFromProject(
  project: LdtkProject,
  ldtkLevel: LdtkLevel,
): number | undefined {
  const layers = ldtkLevel.layerInstances;
  if (layers === null) return undefined;
  const intGridLayer = layers.find((l) => l.__type === 'IntGrid');
  if (intGridLayer === undefined) return undefined;
  const def = project.defs.layers.find((d) => d.uid === intGridLayer.layerDefUid);
  const values = def?.intGridValues;
  if (values === undefined) return undefined;
  for (const v of values) {
    if (v.identifier !== null && v.identifier.toLowerCase() === 'ladder') return v.value;
  }
  return undefined;
}

/**
 * Collect every ladder IntGrid cell in `ldtkLevel` into a fast lookup mask.
 * Falls back to an empty mask (no ladders) if there is no IntGrid layer; the
 * collision layer's `__gridSize` is used so the mask stays correct when it
 * differs from the engine `tileSize`.
 *
 * `ladderValue` identifies which IntGrid integer marks a ladder. Resolve it per
 * level via {@link ladderValueFromProject} so projects can name the value
 * `'ladder'` (any case) rather than reserving integer `2`. Defaults to
 * {@link LADDER_INT_GRID_VALUE} when omitted, preserving the legacy behaviour
 * for callers — and tests — that don't supply it.
 */
export function makeLadderMask(
  ldtkLevel: LdtkLevel,
  fallbackTileSize: number,
  ladderValue: number = LADDER_INT_GRID_VALUE,
): LadderMask {
  const layers = ldtkLevel.layerInstances;
  if (layers === null) return EMPTY_LADDER_MASK;
  for (const layer of layers) {
    if (layer.__type !== 'IntGrid') continue;
    const csv = layer.intGridCsv;
    if (csv === undefined) continue;
    const cells = new Set<string>();
    for (let i = 0; i < csv.length; i++) {
      if (csv[i] === ladderValue) {
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
 * Build one non-colliding `ladder: true` solid per ladder cell in `mask`. Each
 * cell becomes a size×size rect at its pixel position. These solids are skipped
 * by both AABB resolvers (so they never block movement) and read by the climb
 * ability via `overlapsLadder` to detect climb space.
 *
 * Emitting ladders as per-cell solids — rather than re-tagging compiled wall
 * rects that happen to overlap a ladder cell — is what prevents a merged wall
 * rect from being turned entirely non-colliding. Ladder values are already
 * excluded from `solid` during translation, so `compiled.staticSolids` contains
 * no ladder cells; this helper re-adds them as climb space only.
 */
export function ladderMaskToSolids(mask: LadderMask): Solid[] {
  const { size, cells } = mask;
  const solids: Solid[] = [];
  for (const key of cells) {
    const comma = key.indexOf(',');
    const tx = Number(key.slice(0, comma));
    const ty = Number(key.slice(comma + 1));
    if (!Number.isInteger(tx) || !Number.isInteger(ty)) continue;
    solids.push({
      id: `ladder-${tx}-${ty}`,
      x: tx * size,
      y: ty * size,
      width: size,
      height: size,
      ladder: true,
    });
  }
  return solids;
}

/**
 * Whether the body's AABB covers any ladder cell in `mask`. Inclusive tile
 * range, matching the collision query convention. Used to tint the player while
 * overlapping a ladder (ladder climb itself is driven by per-cell ladder solids
 * via `overlapsLadder`, not this helper).
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
