/**
 * Section 3 — Unified platformer playground + level editor.
 *
 * The "proof that the stack works" composite, now merged with the level
 * editor. A single section with two modes toggled by a toolbar button:
 *
 * - **Play mode (default)** — the platformer kernel runs against the
 *   compiled level. The slime-knight character is fully playable with
 *   move/jump + all the game-feel polish: squash/stretch on jump/land,
 *   landing dust burst, hit-stop on hard landings, footstep dust + audio
 *   synced to locomotion phase, launch stretch, screen shake, idle
 *   breathing, blinking cyclops eye, expressive smile / "o" mouth.
 *
 * - **Edit mode** — the kernel is paused and the catalog toolbar is
 *   revealed. Click-drag to draw variable-size platforms / passthroughs /
 *   hazards. Click-to-place for fixed-size kinds (spawn, exit, trap,
 *   decoration, trigger, movingPlatform). Select + drag to move entities.
 *   Undo / redo with full snapshot history. When a `movingPlatform` is
 *   selected, a dashed path widget with draggable waypoints is revealed.
 *
 * The Play/Edit cycle uses the formal playtest sandbox boundary from the
 * editor module: `enterPlaytest(editorState)` deep-clones the level
 * before play, `exitPlaytest(editorState, snapshot)` restores it after.
 * Runtime mutations can never leak into the authoritative editor state —
 * the same protection the standalone editor section had.
 *
 * Public library APIs exercised (everything is a public export; no
 * internal hooks):
 *
 * Editor pillar:
 *   - `createEditorState`, `applyOp`, `undo`, `redo`, `beginTransaction`,
 *     `commitTransaction`, `select`, `clearSelection`, `entityAtPoint`,
 *     `findCatalogEntry`, `instantiateCatalogEntry`, `snapToGrid`,
 *     `enterPlaytest`, `exitPlaytest`, `DEFAULT_CATALOG` — the full editor
 *     reducer surface (src/editor).
 *   - `EditorOperation` discriminated union: `addEntity`, `removeEntity`,
 *     `updateEntityProps`, `moveEntities` — all serializable, all dispatched
 *     through the single `applyOp` entry point.
 *
 * Platformer pillar:
 *   - `compileLevel` lifts the edited `LevelData` into the kernel's inputs
 *     (staticSolids + movingPlatforms + initialState).
 *   - `stepPlatformer` is the authoritative per-tick advance, tuned by a
 *     custom `PLAYGROUND_PLATFORMER_CONFIG` that preserves the original
 *     pre-kernel physics feel.
 *   - `advanceMovingPlatform` + `movingPlatformToSolid` +
 *     `createMovingPlatformDisplacementProvider` wire the kernel's riding-
 *     tracker so a placed moving-platform actually moves AND carries the
 *     actor in play.
 *   - `drawLevelEntity` renders entities (dispatched per kind) with a
 *     custom palette override so the cave-warm aesthetic is preserved.
 *   - `drawActor` would render the player as a flat rect; the slime-knight
 *     renderer below is a richer override that draws the full character.
 *
 * Game-loop + input + FX pillars:
 *   - `createGameLoop` drives a fixed-step (1/60 s) loop with the library's
 *     own defensive rAF adapter. Started in Play mode (gated by
 *     `prefersReducedMotion`); stopped in Edit mode (the editor renders on
 *     demand from mouse / keyboard handlers).
 *   - `createKeyboardAdapter` polls input EXACTLY once per fixed tick and
 *     drains pressed/released edges (no stuck keys, no auto-repeat).
 *   - `createTouchButtonSet` tracks three on-screen overlay buttons for
 *     coarse-pointer devices. `orEdges` OR-merges keyboard + touch per
 *     action each tick so either device drives the player.
 *   - `volumeScale` from `animation/squash-stretch` produces a volume-
 *     preserving (scaleX × scaleY === 1) squash on landing and a launch
 *     stretch on jump.
 *   - `spawn` + `step` from `particles` emit deterministic landing-dust
 *     bursts and per-step dust puffs synced to the walk-cycle foot-plant
 *     transitions.
 *   - `sineShake` + `shakeEnvelope` from `animation/oscillators` drive a
 *     decaying screen shake on hard landings (visual-only — never feeds
 *     back into sim state, so determinism is preserved).
 *   - `advanceLocomotionByDisplacement` + `evaluateLocomotion` from
 *     `animation/locomotion` integrate a displacement-driven walk-cycle
 *     phase (stop moving → dx=0 → phase freezes → feet planted).
 *   - `drawSimpleFeet` from `animation/simple-feet` renders two body-
 *     colored foot rects positioned by the locomotion pose.
 *   - `createAudioAdapter` from `audio` synthesizes footstep / jump /
 *     landing SFX on the fly — defensive, lazily unlocked on first user
 *     gesture, no-op in Node.
 *
 * Primitives:
 *   - `outlineRect` draws platforms + the character (flat fill + 1px
 *     outline). `drawGlow` stamps a subtle additive glow under the
 *     character. `resizeCanvasToBackingStore` makes the canvas crisp on
 *     high-DPI mobile.
 *
 * World layout: 600 × 400 — same dimensions as the canvas / viewport —
 * so no camera scrolling is needed and world-space === screen-space in
 * both modes. Mouse hit-testing maps directly to world coordinates; the
 * path-widget waypoints are draggable without any camera translation.
 *
 * Reduced-motion: the editor itself doesn't animate (renders on demand),
 * so the gate only affects play mode — when reduced motion is preferred,
 * the loop is never started and a single static frame is rendered in
 * whichever mode is active. Matches the hero / lava-pool gate exactly.
 *
 * Local state: this section does NOT extend `GlobalState` — the
 * playground runs entirely on local game state (the editor reducer, the
 * platformer kernel state, transient UI flags). The `store` parameter is
 * accepted to match the section-init signature but is intentionally
 * unused (prefixed `_`).
 *
 * Page-scroll safety: arrow keys + Space scroll the page by default. A
 * `keydown` listener on `window` calls `preventDefault()` on those keys
 * ONLY when the playground section is in the viewport (tracked via an
 * IntersectionObserver) AND the section is in Play mode. In Edit mode the
 * arrows are not suppressed (they're not used for editing either, so the
 * page can scroll). Scrolled out → page scrolls normally.
 */

import {
  applyOp,
  beginTransaction,
  clearSelection,
  commitTransaction,
  createEditorState,
  DEFAULT_CATALOG,
  entityAtPoint,
  findCatalogEntry,
  instantiateCatalogEntry,
  redo,
  select,
  snapToGrid,
  undo,
  type EditorOperation,
  type EditorState,
} from '../../src/editor';
import type {
  EntityId,
  EntityKind,
  LevelData,
  LevelEntity,
  MovingPlatformProps,
} from '../../src/level/types';
import type { Solid } from '../../src/collision';
import {
  advanceMovingPlatform,
  createMovingPlatformDisplacementProvider,
  drawLevelEntity,
  movingPlatformToSolid,
  PRECISION_PLATFORMER,
  stepPlatformer,
  compileEnemies,
  stepEnemies,
  stepProjectile,
  drawEnemies,
  drawProjectiles,
  createEnemyBehaviorRegistry,
  type CompiledLevel,
  type CompiledMovingPlatform,
  type DrawLevelEntityOptions,
  type EntityPalette,
  type CompiledEnemy,
  type ProjectileState,
  type EnemyBehaviorRegistry,
  type EnemyPalette,
} from '../../src/platformer';
import type {
  PlatformerConfig,
  PlatformerInput,
  PlatformerState,
} from '../../src/platformer';
import { aabbOverlap } from '../../src/collision';
// DOM-free pure session + helpers — the authoritative implementation of the
// edit↔play boundary and the editor's mouse-math. Imported here so the
// showcase/tests/*.test.ts suites exercise the SAME code path the live
// playground runs (regression in helper = regression in showcase).
import {
  startSession,
  stopSession,
  resetToInitialState,
  addEntityAndSelect,
} from './playground-session';
import {
  boundingRect,
  buildDrawnEntityOp,
  canvasMouseToWorld,
  computePlayerVisuals,
  hitTestWaypoint,
  instantiateEnemyAt,
  instantiateMovingPlatformAt,
  isEnemyToolbarButtonActive,
  mouseToWaypointTopLeft,
  resolveEnemyCatalogEntry,
  shouldRenderEntityInPlay,
  computeShootToWidgetGeometry,
  hitTestShootToEndpoint,
  computeShootToFromEndpoint,
  shouldShowShootToWidget,
  SHOOT_TO_WIDGET_CONFIG,
} from './playground-helpers';
import {
  createKeyboardAdapter,
  createTouchButtonSet,
  orEdges,
  type KeyboardAdapter,
  type PolledEdge,
  type TouchButtonSetAdapter,
} from '../../src/input';
import { createGameLoop, type GameLoop } from '../../src/game-loop';
import {
  createHitStop,
  triggerHitStop,
  stepHitStop,
  isHitStopActive,
  drawGlow,
  resizeCanvasToBackingStore,
  type HitStopState,
} from '../../src/primitives';
import { volumeScale, breathe, DEFAULT_BREATH } from '../../src/animation/squash-stretch';
import { sineShake, shakeEnvelope } from '../../src/animation/oscillators';
import {
  spawn,
  step as stepParticles,
  particleAlphaCurve,
  particleSizeCurve,
  type Particle,
} from '../../src/particles';
import {
  advanceLocomotionByDisplacement,
  evaluateLocomotion,
  blendLocomotionToStance,
  type GaitConfig,
  type LocomotionState,
  type LocomotionPose,
} from '../../src/animation/locomotion';
import { drawSimpleFeet, IK_PARITY_FEET } from '../../src/animation/simple-feet';
import { createFootPlantState, advanceFootPlant } from '../../src/animation';
import { createAudioAdapter, type AudioAdapter } from '../../src/audio';
import { DEFAULT_JUMP } from '../../src/animation/jump';
import { mulberry32 } from '../../src/rng/mulberry32';
import { shouldAnimate } from '../helpers/motion-gate';
import {
  beginDeath,
  advanceDeath,
  shouldRespawn,
  isDying,
  shouldFlash,
  flashAlpha,
  respawnPopScale,
  DEATH_ANIM_TICKS,
  DEATH_HIT_STOP_TICKS,
  DEATH_PARTICLE_COUNT,
  DEATH_PARTICLE_COUNT_REDUCED,
  DEATH_SHAKE_AMPLITUDE,
  DEATH_SHAKE_DURATION,
  DEATH_RESPAWN_POP_TICKS,
  DEATH_PARTICLE_SPEED,
  DEATH_PARTICLE_SIZE,
  DEATH_PARTICLE_LIFE,
  DEATH_PARTICLE_DRAG,
  DEATH_RNG_SEED,
  DEATH_PARTICLE_COLOR,
  type DeathState,
} from './playground-death';
import type { Store } from '../store';
import type { GlobalState } from '../main';

// --- World / viewport dimensions -------------------------------------------

/** Canvas / level width in CSS pixels. Level dimensions match the viewport
 *  exactly — no camera scrolling needed, world === screen. */
const VIEW_W = 600;
/** Canvas / level height in CSS pixels. */
const VIEW_H = 400;
/** Pixel size of each (square) tile in the level's tile grid. */
const TILE_SIZE = 16;
/** Snapping grid size in world units. Matches TILE_SIZE so placed entities
 *  land on tile boundaries. */
const GRID_SIZE = 16;

/**
 * Tile grid dimensions. `Math.floor` because `VIEW_W / TILE_SIZE` may be
 * non-integer (600 / 16 = 37.5) and `new Array()` rejects fractional lengths.
 * The tile grid covers `GRID_COLS_LEVEL * TILE_SIZE × GRID_ROWS_LEVEL *
 * TILE_SIZE` pixels, which may be slightly smaller than the viewport — the
 * renderer clears the full viewport first so any edge sliver just shows
 * the background fill.
 */
const GRID_COLS_LEVEL = Math.floor(VIEW_W / TILE_SIZE);
const GRID_ROWS_LEVEL = Math.floor(VIEW_H / TILE_SIZE);

// --- Player ----------------------------------------------------------------

/** Player collision-box width (px). */
const PLAYER_W = 24;
/** Player collision-box height (px). */
const PLAYER_H = 32;

// --- Editor entity kinds ---------------------------------------------------

/**
 * Entity kinds that benefit from drag-draw (variable size). For these, a
 * mouse-drag in place mode sweeps out a bounding rect; the resulting
 * `addEntity` op uses the dragged rect (or the catalog default if the drag
 * is smaller than one tile). All other kinds are click-to-place with the
 * catalog default size.
 */
const SIZEABLE_KINDS: ReadonlySet<EntityKind> = new Set<EntityKind>([
  'platform',
  'passthrough',
  'hazard',
]);

/** Visual radius of a path-widget waypoint circle (px). */
const WAYPOINT_RADIUS = 6;
/** Hit-test radius for grabbing a waypoint (px). Matches the visual radius. */
const WAYPOINT_HIT_RADIUS = WAYPOINT_RADIUS;
/** Minimum drag-rect dimension that is accepted as a "real" drag (px). If
 *  either side of the drag bounding box is smaller than this, the catalog
 *  default size is used instead. Matches the tile size so a single-tile
 *  click places a default-size entity. */
const MIN_DRAW_SIZE = TILE_SIZE;

// --- Initial level ---------------------------------------------------------

/**
 * The starting level — the playground's hand-authored layout, expressed
 * as a `LevelData`. Compact and immediately playable: a ground floor, two
 * side walls, three floating platforms, one passthrough, a spawn at the
 * bottom-left, an exit at the bottom-right (reachable by walking), and a
 * moving-platform traversing the upper-middle so visitors see the path
 * widget when they enter Edit mode and click on it.
 *
 * The tile grid is empty — collision comes from the `platform` /
 * `passthrough` entities, which `compileLevel` lifts into `staticSolids`
 * for the kernel.
 */
const PLAYGROUND_LEVEL: LevelData = {
  version: 1,
  id: 'playground',
  name: 'Playground',
  width: VIEW_W,
  height: VIEW_H,
  tileSize: TILE_SIZE,
  spawn: { x: 48, y: 336 },
  tiles: {
    data: new Array<number>(GRID_COLS_LEVEL * GRID_ROWS_LEVEL).fill(0),
    cols: GRID_COLS_LEVEL,
    rows: GRID_ROWS_LEVEL,
    tileSize: TILE_SIZE,
  },
  entities: [
    { id: 1, kind: 'spawn', rect: { x: 48, y: 336, width: 16, height: 16 }, props: {} },
    { id: 2, kind: 'exit', rect: { x: 552, y: 336, width: 16, height: 16 }, props: { isTrap: false, locked: false } },
    // Ground floor — spans the full world width.
    { id: 3, kind: 'platform', rect: { x: 0, y: 368, width: 600, height: 32 }, props: {} },
    // Left + right walls (bound the play area so the player can't run off-screen).
    { id: 4, kind: 'platform', rect: { x: 0, y: 0, width: 16, height: 368 }, props: {} },
    { id: 5, kind: 'platform', rect: { x: 584, y: 0, width: 16, height: 368 }, props: {} },
    // Floating platforms — stair-steps up the middle.
    { id: 6, kind: 'platform', rect: { x: 96, y: 304, width: 96, height: 16 }, props: {} },
    { id: 7, kind: 'platform', rect: { x: 224, y: 256, width: 80, height: 16 }, props: {} },
    { id: 8, kind: 'platform', rect: { x: 400, y: 208, width: 96, height: 16 }, props: {} },
    // Passthrough platform (one-way — jump up through, land on top).
    { id: 9, kind: 'passthrough', rect: { x: 288, y: 304, width: 96, height: 16 }, props: {} },
    // Moving platform — horizontal traversal in the upper-middle. Path[0]
    // matches the entity's rect so the "home" position renders consistently
    // with where the platform starts at compile time.
    {
      id: 10,
      kind: 'movingPlatform',
      rect: { x: 96, y: 160, width: 48, height: 16 },
      props: {
        speed: 90,
        path: [
          { x: 96, y: 160 },
          { x: 456, y: 160 },
        ],
        loopMode: 'pingpong',
      },
    },
  ],
  nextEntityId: 11,
};

// --- Platformer kernel tuning ----------------------------------------------
//
// The kernel works in px/s and seconds. The conversions from the original
// pre-kernel per-tick tuning are noted inline (× 60 for px/tick → px/s;
// × 60² for px/tick² → px/s²). The `jump` sub-config's apexHeight /
// timeToApex are derived from the original JUMP_VELOCITY and GRAVITY using
// the formulas documented on `JumpConfig`:
//   physics.gravity        = 2 · apexHeight / timeToApex²
//   physics.launchVelocity = −2 · apexHeight / timeToApex
// → apexHeight = |JUMP_VELOCITY|² / (2 · GRAVITY) = 9² / (2 · 0.5) = 81
//   timeToApex  = |JUMP_VELOCITY| / GRAVITY       = 9 / 0.5       = 18 ticks = 0.3 s

/** Per-tick gravity in px/s². Original `GRAVITY = 0.5 px/tick²` × 60² = 1800. */
const PLAYGROUND_GRAVITY = 1800;
/** Terminal fall velocity in px/s. Original `MAX_FALL = 12 px/tick` × 60 = 720. */
const PLAYGROUND_MAX_FALL = 720;
/** Ground move speed in px/s. Original `MOVE_SPEED = 3 px/tick` × 60 = 180. */
const PLAYGROUND_MOVE_SPEED = 180;
/** Air-control multiplier in [0,1] (dimensionless). Original `AIR_CONTROL = 0.5`. */
const PLAYGROUND_AIR_CONTROL = 0.5;

/**
 * Tuning for the playground's platformer kernel. Spread
 * `DEFAULT_PLATFORMER_CONFIG` (which itself spreads `DEFAULT_JUMP` for the
 * `jump` sub-config) and override only the fields that differ.
 *
 * `wallSlideEnabled`, `dashEnabled`, `doubleJumpEnabled` are false — the
 * playground is a minimal move+jump demo.
 */
const PLAYGROUND_PLATFORMER_CONFIG: Readonly<PlatformerConfig> = {
  ...PRECISION_PLATFORMER,
  gravity: PLAYGROUND_GRAVITY,
  maxFallSpeed: PLAYGROUND_MAX_FALL,
  moveSpeed: PLAYGROUND_MOVE_SPEED,
  airControl: PLAYGROUND_AIR_CONTROL,
  jump: {
    ...DEFAULT_JUMP,
    apexHeight: 81,
    timeToApex: 0.3,
    coyoteTime: 0,
    jumpBufferTime: 0,
    anticipationDuration: 0,
    jumpCutoffFactor: 1,
    fallMultiplier: 1,
    landingSquashMin: 1,
    landingSquashStiffness: 0,
    landingSquashDamping: 0,
    anticipationSquash: 1,
    launchStretch: 1,
    airborneBlendRampUp: 0,
    airborneBlendRampDown: 0,
  },
  wallSlideEnabled: false,
  dashEnabled: false,
  doubleJumpEnabled: false,
};

/**
 * Per-tick gravity in px/s, expressed in original-tick units for the
 * impact-velocity reconstruction. Mirrors the original
 * `vyBeforeResolve = preVy + GRAVITY` (per-tick). See playground kernel
 * decision for why the double integration cancels out across the arc.
 */
const IMPACT_GRAVITY_PER_TICK_PX_PER_SEC = 30;
/** Fall-off-world respawn margin. Player resets to spawn once their top
 *  edge exceeds WORLD_H + this margin. */
const RESPAWN_FALL_MARGIN = 64;
/** Hit-stop freeze duration on a hard landing (ticks). */
const HIT_STOP_DURATION = 4;
/** Minimum impact velocity (px/tick) that triggers a hit-stop freeze. */
const HIT_STOP_THRESHOLD_TICKS = 6;
/** Maximum squash depth on landing (scaleY deviation from 1). */
const MAX_SQUASH = 0.3;
/** Reference downward velocity the squash is normalized against (px/tick). */
const REFERENCE_VELOCITY_TICKS = 9;
/** Per-tick multiplier applied to `squashOffset` toward neutral (0). */
const SQUASH_DECAY = 0.82;
/** Vertical stretch applied on jump launch. */
const LAUNCH_STRETCH = 0.15;

/**
 * Playground-specific gait — wider stride and higher lift than DEFAULT_GAIT
 * so the walk reads clearly on a 32px-tall character.
 */
const PLAYGROUND_GAIT: Readonly<GaitConfig> = {
  baseFrequency: 0.05,
  strideLength: 8,
  strideHeight: 5,
  hipBobHeight: 2,
  hipSwayWidth: 1,
};

/**
 * Total center-to-center foot distance at full idle stance (px). Each foot
 * targets `±PLAYGROUND_IDLE_FOOT_SPREAD / 2` from the body midline.
 * `footW + desiredGap` (= 7 + 1 = 8) yields a tight 1 px visible gap between
 * the inner edges of the two foot rectangles at full blend: each foot sits
 * `±4 px` from the midline, inner edges at `±0.5 px`, total gap = 1 px (sub-
 * pixel rounding handled by `Math.round` in the renderer). Matches the
 * locked semantics in `docs/design/idle-foot-stance-decision.md` (playground
 * spread = 8). Fed to `blendLocomotionToStance` in `drawPlayer`.
 */
const PLAYGROUND_IDLE_FOOT_SPREAD = IK_PARITY_FEET.footW + 1;

// --- FX recipe constants ---

/** Dust-burst particle fill — warm tan, clearly visible against the dark bg. */
const COLOR_DUST_LANDING = '#9a8060';
/** Footstep-dust fill — slightly darker than landing dust for hierarchy. */
const COLOR_DUST_FOOTSTEP = '#8a7050';
/** Minimum horizontal speed for footstep dust to spawn (px/tick). */
const FOOTSTEP_MIN_SPEED_TICKS = 1;
/** Footstep sound: short low-freq noise burst. */
const FOOTSTEP_SOUND_DUR = 40;
/** Footstep sound: lowpass cutoff (Hz). */
const FOOTSTEP_SOUND_FREQ = 200;
/** Footstep sound: peak gain. */
const FOOTSTEP_SOUND_PEAK = 0.12;
/** Screen-shake duration (render ticks) on a hard landing. */
const SHAKE_DURATION = 10;
/** Screen-shake x-axis frequency. */
const SHAKE_FREQ_X = 1.5;
/** Screen-shake y-axis frequency. */
const SHAKE_FREQ_Y = 2.3;
/** Cap on shake magnitude so the freeze-frame never throws the read off. */
const SHAKE_MAX_MAGNITUDE = 6;
/** Shake magnitude per unit of impact velocity (pre-cap). */
const SHAKE_MAGNITUDE_PER_IMPACT = 0.5;
/** Particle-stepping gravity for dust (px/tick²). */
const DUST_GRAVITY = 0.15;
/** Particle-stepping drag for dust. */
const DUST_DRAG = 0.92;

// --- Palette ---------------------------------------------------------------

/** Background fill — cave-warm near-black. */
const COLOR_BG = '#1a0d0a';
/** Solid-platform fill — earthy brown, brightened for editor visibility against the cave-warm bg. */
const COLOR_PLATFORM = '#5a3a24';
/** Passthrough-platform fill — olive green to clearly distinguish from solid platforms. */
const COLOR_PLATFORM_PASSTHROUGH = '#5a6a3a';
/** Moving-platform fill — steel blue, reads as mechanical. */
const COLOR_MOVING_PLATFORM = '#5a7a9a';
/** Player fill — soft purple (cute cyclops, distinct from Spitekeep orange). */
const COLOR_PLAYER = '#6c5ce7';
/** Face feature color (eye + mouth). */
const COLOR_FACE = '#1d1128';
/** Hazard fill — danger red. */
const COLOR_HAZARD = '#ff3a3a';
/** Spawn marker color — bright friendly green. */
const COLOR_SPAWN = '#7aff7a';
/** Exit marker color — goal yellow. */
const COLOR_EXIT = '#ffe066';

/** Editor grid-line color — warm gray, visible enough to aid placement without dominating. */
const COLOR_GRID = '#3a2820';
/** Selection-highlight stroke — bright gold. */
const COLOR_SELECTION = '#ffd84a';
/** Ghost-rect stroke (translucent gold) for the place-mode preview. */
const COLOR_GHOST = 'rgba(255, 216, 74, 0.55)';
/** Path-widget polyline + waypoint outline color — cyan, distinct from the yellow selection. */
const COLOR_PATH = '#5fd4ff';
/** Path-widget waypoint fill — semi-opaque cyan, reads as a solid grabbable handle. */
const COLOR_PATH_FILL = 'rgba(95, 212, 255, 0.55)';
/** HUD text color — dim warm gray. */
const COLOR_HUD = '#a09080';

/**
 * Custom entity palette for `drawLevelEntity` — overrides the library's
 * `DEFAULT_ENTITY_PALETTE` so the cave-warm aesthetic of the playground is
 * preserved. Only the kinds the level actually uses are overridden; the
 * rest fall through to the defaults.
 */
const PLAYGROUND_PALETTE: Readonly<EntityPalette> = {
  platform: COLOR_PLATFORM,
  passthrough: COLOR_PLATFORM_PASSTHROUGH,
  movingPlatform: COLOR_MOVING_PLATFORM,
  hazard: COLOR_HAZARD,
  spawn: COLOR_SPAWN,
  exit: COLOR_EXIT,
  enemy: '#ff3a3a',
};

/**
 * Enemy palette for runtime enemy rendering.
 */
const ENEMY_PALETTE: EnemyPalette = {
  spinny: '#ff3a3a',
  turret: '#ff6a00',
  default: '#ff3a3a',
  indicator: '#ffffff',
  projectile: '#ffaa00',
};

/**
 * Per-kind draw options passed to `drawLevelEntity`. The library's default
 * renderer classifies `passthrough` as a solid-feeling kind (flat fill +
 * outline), so no override is needed for it. Other kinds also use the
 * library default, just with the playground palette.
 */
const PLAYGROUND_DRAW_OPTIONS: DrawLevelEntityOptions = {
  palette: PLAYGROUND_PALETTE,
};

// --- Input / keyboard constants --------------------------------------------

/** Idle edge — the zero state for OR-merge fallback when a slot is absent. */
const IDLE_EDGE: PolledEdge = { held: false, pressed: false, released: false };

/**
 * Keyboard codes whose default page action (scroll / space-press button)
 * we suppress while the playground is onscreen + in Play mode so the
 * player can play without scrolling the page. In Edit mode these are NOT
 * suppressed — the editor uses Delete + Ctrl/Cmd+Z (not arrows), and
 * allowing scroll lets the user navigate the page if needed.
 */
const SUPPRESSED_CODES_PLAY: ReadonlySet<string> = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Space',
  'KeyR',
]);

// ===========================================================================
// initPlayground
// ===========================================================================

/**
 * Initialize the unified playground + editor section.
 *
 * Wires the keyboard + touch adapters, game loop, mouse + keyboard editing
 * handlers, and the rendering pipeline for both modes. Returns a `dispose`
 * callback that tears down both input adapters, the IntersectionObserver,
 * the window keydown listeners, and the game loop — defensive for future
 * single-page-app reuse.
 *
 * @param container - the `<section id="playground">` element
 * @param _store    - the global observable store. Intentionally unused — the
 *   playground runs entirely on local state. Accepted only to match the
 *   section-init signature.
 * @returns A `dispose` callback (idempotent — safe to call multiple times).
 */
export function initPlayground(
  container: HTMLElement,
  // Underscore-prefixed: TypeScript's `noUnusedParameters` exempts these.
  _store: Store<GlobalState>,
): () => void {
  const canvas = container.querySelector<HTMLCanvasElement>('.playground-canvas')!;
  const ctx = canvas.getContext('2d')!;
  // DPR-aware backing store: canvas.width/height = CSS size × devicePixelRatio
  // so the canvas renders crisp on Retina / high-DPI mobile. Applied ONCE
  // at setup as the base transform; all per-frame transforms compose on top.
  const dpr = resizeCanvasToBackingStore(canvas, VIEW_W, VIEW_H);
  ctx.scale(dpr, dpr);

  // --- DOM refs ---
  const statusPanel = container.querySelector<HTMLElement>('.playground-status')!;
  const modeToggleBtn =
    container.querySelector<HTMLButtonElement>('.playground-mode-toggle')!;
  const undoBtn = container.querySelector<HTMLButtonElement>('.playground-undo')!;
  const selectBtn =
    container.querySelector<HTMLButtonElement>('[data-mode="select"]')!;
  const kindBtns = Array.from(
    container.querySelectorAll<HTMLButtonElement>('.playground-btn[data-kind]'),
  );

  // --- Editor state (reassigned on each op — the reducer is pure) ---
  let editorState: EditorState = createEditorState(PLAYGROUND_LEVEL);

  /** Currently selected catalog kind for place mode. */
  let selectedKind: EntityKind = 'platform';
  /** Selected enemy archetype (used when selectedKind === 'enemy'). */
  let selectedEnemyArchetype = 'spinny';
  /** Edit sub-mode: place (click to add) vs select (click to select/move). */
  let editMode: 'place' | 'select' = 'place';

  /** Top-level section mode: Play (kernel running) vs Edit (editor active). */
  let mode: 'play' | 'edit' = 'play';

  // --- Edit-mode transient state ---
  /** Entity being dragged (select mode), or null. */
  let draggingEntityId: EntityId | null = null;
  /** Last snapped mouse position during a drag (for delta computation). */
  let dragLastSnapped: { x: number; y: number } | null = null;
  /** True while a series of ops is being accumulated into one transaction
   *  (so a drag = one undo step). */
  let inTransaction = false;
  /** Current snapped mouse position (for ghost preview + click placement). */
  let snappedMouse: { x: number; y: number } = { x: 0, y: 0 };
  /** True while the cursor is over the canvas (for ghost visibility). */
  let mouseOverCanvas = false;
  /** Active drag-draw rect (place mode + sizeable kind), or null. */
  let drawingRect: {
    readonly start: { readonly x: number; readonly y: number };
    readonly current: { readonly x: number; readonly y: number };
  } | null = null;
  /** Active waypoint drag (selected movingPlatform), or null. */
  let draggingWaypoint: { readonly entityId: EntityId; readonly index: number } | null = null;
  /** Active shootTo endpoint drag (selected turret), or null. */
  let draggingShootTo: { readonly entityId: EntityId } | null = null;

  // --- Play-mode runtime state ---
  /** Playtest snapshot — the deep-clone of the level taken on enterPlaytest.
   *  Authoritative for restoring the editor on exitPlaytest; also used as
   *  the source of truth for which entities to render in Play mode. */
  let playtestSnapshot: LevelData | null = null;
  /** Compiled level (kernel inputs). Non-null only in Play mode. */
  let compiled: CompiledLevel | null = null;
  /** Live runtime player state. Non-null only in Play mode. */
  let runtimeState: PlatformerState | null = null;
  /** Live moving-platform descriptors, advanced each tick. */
  let runtimePlatforms: readonly CompiledMovingPlatform[] = [];
  /** Compiled enemies, stepped each tick. */
  let runtimeEnemies: readonly CompiledEnemy[] = [];
  /** Active projectiles (from turret enemies). */
  let runtimeProjectiles: readonly ProjectileState[] = [];
  /** Enemy behavior registry. */
  let enemyRegistry: EnemyBehaviorRegistry | null = null;
  /** Death lifecycle state — null when alive. Drives the 15-tick dying phase. */
  let deathState: DeathState | null = null;
  /** Ticks since respawn (for the 8-tick pop-scale spring). -1 = not in pop. */
  let respawnPopTick = -1;
  /** Death-burst particles (radial ring, spawned once on death tick 0). */
  let deathParticles: Particle[] = [];

  // --- Play-mode FX state ---
  let hitStop: HitStopState = createHitStop();
  /** Squash/stretch offset (0 = neutral, negative = squashed, positive = stretched). */
  let squashOffset = 0;
  /** Dust particles (landing bursts + per-step footstep puffs). */
  let dustParticles: Particle[] = [];
  /** Locomotion phase accumulator — drives simple-feet positions. */
  let loco: LocomotionState = { phase: 0 };
  /** Foot-plant detector state — observes >0 → 0 descent of each foot. */
  let plantState = createFootPlantState();
  /** Audio adapter — defensive (lazy AudioContext, never-throw, no-op in Node). */
  const audio: AudioAdapter = createAudioAdapter();
  /** Screen-shake state. */
  let shakeTick = 0;
  let shakeMagnitude = 0;
  /** Idle feet blend weight [0,1]. 1 = full neutral standing stance. */
  let idleBlend = 0;
  /** Render-tick clock for visual-only oscillations (breathing). */
  let renderTick = 0;
  /** Blink timing (render ticks). */
  let blinkCountdown = 120;
  let blinkRemaining = 0;

  // --- Input adapter (used for play movement only) -------------------------
  const keyboard: KeyboardAdapter = createKeyboardAdapter({
    codeToAction: {
      ArrowLeft: 'left',
      ArrowRight: 'right',
      KeyA: 'left',
      KeyD: 'right',
      Space: 'jump',
      KeyR: 'reset',
    },
  });

  // --- Touch adapter (on-screen buttons for coarse-pointer devices) -------
  const touchLeftBtn = container.querySelector<HTMLButtonElement>(
    '.playground-touch-btn--left',
  );
  const touchRightBtn = container.querySelector<HTMLButtonElement>(
    '.playground-touch-btn--right',
  );
  const touchJumpBtn = container.querySelector<HTMLButtonElement>(
    '.playground-touch-btn--jump',
  );
  const touch: TouchButtonSetAdapter = createTouchButtonSet({
    elements: [touchLeftBtn, touchRightBtn, touchJumpBtn],
  });

  // --- Audio unlock --------------------------------------------------------
  // Browser autoplay policy: one-shot listener on first keydown OR pointerdown
  // arms playback; self-removes after firing.
  const unlockAudio = (): void => {
    audio.unlock();
    window.removeEventListener('keydown', unlockAudio);
    window.removeEventListener('pointerdown', unlockAudio);
  };
  window.addEventListener('keydown', unlockAudio);
  window.addEventListener('pointerdown', unlockAudio);

  // --- Page-scroll guard ---------------------------------------------------
  // Suppress arrow keys + Space ONLY in Play mode while onscreen.
  let onscreen = false;
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) onscreen = entry.isIntersecting;
    },
    { threshold: 0.01 },
  );
  observer.observe(container);

  const onKeyDownSuppress = (e: KeyboardEvent): void => {
    if (!onscreen || mode !== 'play') return;
    if (SUPPRESSED_CODES_PLAY.has(e.code)) e.preventDefault();
  };
  window.addEventListener('keydown', onKeyDownSuppress, { capture: true });

  // --- Editor shortcuts (Delete + Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z) ----------
  // Active only in Edit mode. Guarded against mid-drag: pressing Ctrl+Z while
  // a drag's transaction is open would undo under the in-flight state.
  const onKeyDownEditor = (e: KeyboardEvent): void => {
    if (mode !== 'edit' || !onscreen) return;
    if (draggingEntityId !== null || drawingRect !== null || draggingWaypoint !== null || draggingShootTo !== null) return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.code === 'Delete' || e.code === 'Backspace') {
      if (editorState.selection.ids.size > 0) {
        const id = [...editorState.selection.ids][0];
        const op: EditorOperation = { type: 'removeEntity', id };
        editorState = applyOp(editorState, op);
        editorState = clearSelection(editorState);
        afterEdit();
      }
      e.preventDefault();
      return;
    }
    if (mod && e.code === 'KeyZ') {
      editorState = e.shiftKey ? redo(editorState) : undo(editorState);
      afterEdit();
      e.preventDefault();
    }
    if (mod && e.code === 'KeyY') {
      editorState = redo(editorState);
      afterEdit();
      e.preventDefault();
    }
  };
  window.addEventListener('keydown', onKeyDownEditor);

  // =========================================================================
  // Helpers
  // =========================================================================

  /** Translate a MouseEvent into world-space coordinates. The canvas is
   *  sized responsively by CSS; the CSS pixel rect may differ from the
   *  600×400 world backing store, so scale accordingly. Delegates to the
   *  pure `canvasMouseToWorld` helper so the same math is unit-tested in
   *  `showcase/tests/playground-helpers.test.ts`. */
  const canvasMouse = (e: MouseEvent): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect();
    return canvasMouseToWorld(e.clientX, e.clientY, rect, VIEW_W, VIEW_H);
  };

  /**
   * Find the selected entity that has a path widget (movingPlatform with
   * `path`, or enemy with `patrolPath` in its params). Returns null if no
   * entity is selected or the selected entity has no editable path.
   */
  const selectedPathEntity = (): LevelEntity | null => {
    if (editorState.selection.ids.size === 0) return null;
    const id = [...editorState.selection.ids][0];
    const entity = editorState.level.entities.find((e) => e.id === id);
    if (!entity) return null;
    if (entity.kind === 'movingPlatform') return entity;
    if (entity.kind === 'enemy') {
      const params = (entity.props as { params?: Record<string, unknown> }).params;
      if (params && Array.isArray(params.patrolPath) && params.patrolPath.length >= 2) {
        return entity;
      }
    }
    return null;
  };

  /**
   * Get the waypoints and rect for a path-widget entity.
   * Returns `{ path, rect }` where `path` is the array of waypoints and
   * `rect` is the entity's bounding rect. Returns null if the entity has
   * no editable path.
   */
  const getPathWidgetData = (entity: LevelEntity): {
    readonly path: readonly { readonly x: number; readonly y: number }[];
    readonly rect: { readonly width: number; readonly height: number };
  } | null => {
    if (entity.kind === 'movingPlatform') {
      const props = entity.props as MovingPlatformProps;
      if (!Array.isArray(props.path) || props.path.length === 0) return null;
      return { path: props.path, rect: entity.rect };
    }
    if (entity.kind === 'enemy') {
      const params = (entity.props as { params?: Record<string, unknown> }).params;
      if (params && Array.isArray(params.patrolPath) && params.patrolPath.length >= 2) {
        return { path: params.patrolPath as { x: number; y: number }[], rect: entity.rect };
      }
    }
    return null;
  };

  /** Common post-edit hook: refresh validation, toolbar state, status, canvas. */
  const afterEdit = (): void => {
    updateToolbar();
    updateStatus();
    render();
  };

  // =========================================================================
  // Rendering — Edit mode
  // =========================================================================

  /** Paint the faint grid reference so snapped positions are visible. */
  const renderGrid = (): void => {
    ctx.strokeStyle = COLOR_GRID;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= VIEW_W; x += GRID_SIZE) {
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, VIEW_H);
    }
    for (let y = 0; y <= VIEW_H; y += GRID_SIZE) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(VIEW_W, y + 0.5);
    }
    ctx.stroke();
  };

  /**
   * Draw the path-widget overlay for an entity with a path (movingPlatform
   * or enemy with patrolPath): a dashed polyline through the path waypoints
   * + a draggable circle at each. The entity's body is drawn at its rect
   * position by the entity dispatcher; this only draws the connector + handles.
   */
  const renderPathWidget = (entity: LevelEntity): void => {
    const data = getPathWidgetData(entity);
    if (!data) return;
    const { path, rect } = data;

    // Path waypoints are stored as the entity's TOP-LEFT position at each
    // point in its journey. For the widget to look balanced, render the
    // polyline + circles at the entity's CENTER at each waypoint
    // (top-left + half of rect). This way the left waypoint sits visually
    // in the middle of the at-home entity body instead of its corner.
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const centers = path.map((p) => ({ x: p.x + cx, y: p.y + cy }));

    // Dashed polyline through the waypoint centers.
    if (centers.length >= 2) {
      ctx.strokeStyle = COLOR_PATH;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(centers[0].x + 0.5, centers[0].y + 0.5);
      for (let i = 1; i < centers.length; i++) {
        ctx.lineTo(centers[i].x + 0.5, centers[i].y + 0.5);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Filled draggable circle at each waypoint center. Semi-opaque fill +
    // solid 2px stroke reads as a grabbable handle, not just an outline.
    for (const c of centers) {
      ctx.fillStyle = COLOR_PATH_FILL;
      ctx.strokeStyle = COLOR_PATH;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(c.x, c.y, WAYPOINT_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  };

  /**
   * Draw the shootTo widget overlay for a selected turret (Treatment C):
   * - Faint amber range disk with subtle fill
   * - Solid amber vector line from turret center to endpoint
   * - Target reticle handle at endpoint (10px outer, 4px inner, crosshair ticks)
   * - Dark-blue-on-amber distance pill
   */
  const renderShootToWidget = (entity: LevelEntity): void => {
    const params = (entity.props as { params?: Record<string, unknown> }).params;
    if (!params) return;
    const geom = computeShootToWidgetGeometry(
      entity.rect.x, entity.rect.y, entity.rect.width, entity.rect.height,
      params.shootTo,
    );
    if (!geom) return;

    const cfg = SHOOT_TO_WIDGET_CONFIG;

    // Faint amber range disk
    if (geom.maxRange > 0) {
      ctx.beginPath();
      ctx.arc(geom.centerX, geom.centerY, geom.maxRange, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(251, 191, 36, 0.03)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.15)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Solid amber vector line
    ctx.beginPath();
    ctx.moveTo(geom.centerX, geom.centerY);
    ctx.lineTo(geom.endX, geom.endY);
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Arrowhead at endpoint
    const tipX = geom.endX;
    const tipY = geom.endY;
    const baseX = tipX - geom.dirX * cfg.arrowLength;
    const baseY = tipY - geom.dirY * cfg.arrowLength;
    const perpX = -geom.dirY;
    const perpY = geom.dirX;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(baseX + perpX * cfg.arrowHalfWidth, baseY + perpY * cfg.arrowHalfWidth);
    ctx.lineTo(baseX - perpX * cfg.arrowHalfWidth, baseY - perpY * cfg.arrowHalfWidth);
    ctx.closePath();
    ctx.fillStyle = '#fbbf24';
    ctx.fill();

    // Reticle handle — outer ring
    ctx.beginPath();
    ctx.arc(geom.endX, geom.endY, cfg.reticleOuterRadius, 0, Math.PI * 2);
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Reticle handle — inner dot
    ctx.beginPath();
    ctx.arc(geom.endX, geom.endY, cfg.reticleInnerRadius, 0, Math.PI * 2);
    ctx.fillStyle = '#fbbf24';
    ctx.fill();

    // Reticle crosshair ticks
    const tickLen = cfg.reticleOuterRadius + cfg.reticleTickLength;
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(geom.endX, geom.endY - cfg.reticleOuterRadius);
    ctx.lineTo(geom.endX, geom.endY - tickLen);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(geom.endX, geom.endY + cfg.reticleOuterRadius);
    ctx.lineTo(geom.endX, geom.endY + tickLen);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(geom.endX - cfg.reticleOuterRadius, geom.endY);
    ctx.lineTo(geom.endX - tickLen, geom.endY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(geom.endX + cfg.reticleOuterRadius, geom.endY);
    ctx.lineTo(geom.endX + tickLen, geom.endY);
    ctx.stroke();

    // Distance pill (dark-blue text on amber background)
    const midX = (geom.centerX + geom.endX) / 2;
    const midY = (geom.centerY + geom.endY) / 2;
    const pillX = midX + perpX * cfg.pillOffset;
    const pillY = midY + perpY * cfg.pillOffset;

    ctx.font = 'bold 10px monospace';
    const textWidth = ctx.measureText(geom.labelText).width;
    const pillW = textWidth + 12;
    const pillH = 18;
    const px = pillX - pillW / 2;
    const py = pillY - pillH / 2;

    // Pill background
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    const r = 4;
    ctx.moveTo(px + r, py);
    ctx.lineTo(px + pillW - r, py);
    ctx.quadraticCurveTo(px + pillW, py, px + pillW, py + r);
    ctx.lineTo(px + pillW, py + pillH - r);
    ctx.quadraticCurveTo(px + pillW, py + pillH, px + pillW - r, py + pillH);
    ctx.lineTo(px + r, py + pillH);
    ctx.quadraticCurveTo(px, py + pillH, px, py + pillH - r);
    ctx.lineTo(px, py + r);
    ctx.quadraticCurveTo(px, py, px + r, py);
    ctx.closePath();
    ctx.fill();

    // Pill text
    ctx.fillStyle = '#0f172a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(geom.labelText, pillX, pillY);
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  };

  /** Editor view: grid + entities + selection + ghost + path widget. */
  const renderEdit = (): void => {
    ctx.fillStyle = COLOR_BG;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    renderGrid();

    // Entities — drawn via the library's dispatcher with the playground palette.
    for (const entity of editorState.level.entities) {
      drawLevelEntity(ctx, entity, PLAYGROUND_DRAW_OPTIONS);
    }

    // Path widget for the selected entity with a path (movingPlatform or enemy).
    const selectedPath = selectedPathEntity();
    if (selectedPath !== null) {
      renderPathWidget(selectedPath);
    }

    // ShootTo widget for the selected turret (Treatment C).
    for (const id of editorState.selection.ids) {
      const e = editorState.level.entities.find((en) => en.id === id);
      if (e && shouldShowShootToWidget(e)) {
        renderShootToWidget(e);
      }
    }

    // Selection highlight (drawn after entities + path widget so it reads on top).
    for (const id of editorState.selection.ids) {
      const e = editorState.level.entities.find((en) => en.id === id);
      if (!e) continue;
      ctx.strokeStyle = COLOR_SELECTION;
      ctx.lineWidth = 2;
      ctx.strokeRect(e.rect.x - 1, e.rect.y - 1, e.rect.width + 2, e.rect.height + 2);
    }

    // Drag-draw ghost (place mode + sizeable kind + active drag).
    if (drawingRect !== null) {
      const r = boundingRect(drawingRect.start, drawingRect.current);
      ctx.strokeStyle = COLOR_GHOST;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(r.x, r.y, r.width, r.height);
      ctx.setLineDash([]);
    } else if (editMode === 'place' && mouseOverCanvas) {
      // Click-to-place ghost preview at the snapped cursor — uses the
      // catalog entry's default width/height so the user sees what will spawn.
      // For enemy, resolve the dedicated spinny/turret prefab so the ghost
      // matches the actual placement rect (16×16 either way, but this is
      // future-proof against a prefab with a non-default size).
      const entry =
        selectedKind === 'enemy'
          ? resolveEnemyCatalogEntry(DEFAULT_CATALOG, selectedEnemyArchetype)
          : findCatalogEntry(DEFAULT_CATALOG, selectedKind);
      if (entry) {
        ctx.strokeStyle = COLOR_GHOST;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(
          snappedMouse.x,
          snappedMouse.y,
          entry.defaultRect.width,
          entry.defaultRect.height,
        );
        ctx.setLineDash([]);
      }
    }
  };

  // =========================================================================
  // Rendering — Play mode
  // =========================================================================

  /**
   * Draw dust particles as alpha-faded filled circles. Reuses the
   * lava-pool section's particle-render pattern (`particleAlphaCurve` +
   * `particleSizeCurve`).
   */
  const drawDust = (
    ctx: CanvasRenderingContext2D,
    particles: readonly Particle[],
  ): void => {
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const alpha = particleAlphaCurve(p, 1.0, 0);
      const radius = particleSizeCurve(p, p.size, 1);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color ?? COLOR_DUST_LANDING;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(1, radius), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  };

  /**
   * Spawn a tiny per-step dust puff at a given world-space x (the planted
   * foot's position). Each visible step lands → one puff.
   */
  const spawnFootstepDust = (x: number): void => {
    if (runtimeState === null) return;
    const dust = spawn(x, runtimeState.core.y + runtimeState.core.height - 1, {
      count: 2,
      speed: 0.5,
      life: 12,
      size: 2.5,
      color: COLOR_DUST_FOOTSTEP,
    });
    dustParticles = [...dustParticles, ...dust];
  };

  /** Play view: level entities + dust + death particles + player + HUD. */
  const renderPlay = (): void => {
    const rm = shouldAnimate();
    const dying = deathState !== null && isDying(deathState);

    ctx.fillStyle = COLOR_BG;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    // Screen-shake offset (visual-only; never feeds back into state).
    // Death shake takes priority over landing shake when dying.
    let shakeX = 0;
    let shakeY = 0;
    if (dying && deathState !== null && !rm) {
      const envelope = shakeEnvelope(deathState.tick, DEATH_SHAKE_DURATION, DEATH_SHAKE_AMPLITUDE);
      const s = sineShake(deathState.tick, envelope, 0.8, 1.2);
      shakeX = s.x;
      shakeY = s.y;
    } else if (shakeMagnitude > 0) {
      const envelope = shakeEnvelope(shakeTick, SHAKE_DURATION, shakeMagnitude);
      const s = sineShake(shakeTick, envelope, SHAKE_FREQ_X, SHAKE_FREQ_Y);
      shakeX = s.x;
      shakeY = s.y;
      shakeTick += 1;
      if (shakeTick > SHAKE_DURATION) {
        shakeMagnitude = 0;
      }
    }

    ctx.save();
    ctx.translate(shakeX, shakeY);

    // Level entities — drawn from the playtest snapshot (the authoritative
    // shape of the level being played). Spawn is skipped — the player IS
    // at the spawn position; drawing the marker would duplicate it.
    // Authored enemy entities are skipped here because runtime
    // `drawEnemies` (called below) is the sole enemy renderer: it draws
    // per-archetype treatments (spinny sawblade, turret indicator) at the
    // RUNTIME position, whereas `drawLevelEntity` would draw a static
    // rectangle at the authored position. Moving platforms render at their
    // advanced runtime position so the user sees them move; other kinds
    // render at their authored rect.
    const level = playtestSnapshot;
    if (level !== null) {
      for (const entity of level.entities) {
        if (!shouldRenderEntityInPlay(entity)) continue;
        const mp = runtimePlatforms.find((p) => p.entity.id === entity.id);
        if (mp !== undefined) {
          drawLevelEntity(
            ctx,
            {
              ...entity,
              rect: {
                x: mp.x,
                y: mp.y,
                width: entity.rect.width,
                height: entity.rect.height,
              },
            },
            PLAYGROUND_DRAW_OPTIONS,
          );
        } else {
          drawLevelEntity(ctx, entity, PLAYGROUND_DRAW_OPTIONS);
        }
      }
    }

    // Dust (behind the player).
    drawDust(ctx, dustParticles);

    // Death particles — drawn during dying phase with fade + size curve.
    if (deathParticles.length > 0) {
      for (const p of deathParticles) {
        const age = p.maxLife > 0 ? 1 - p.life / p.maxLife : 1;
        const alpha = Math.max(0, 1 - age);
        const radius = p.size * (1 - age * 0.5);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color ?? DEATH_PARTICLE_COLOR;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(1, radius), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // Enemies.
    drawEnemies(ctx, runtimeEnemies, renderTick, ENEMY_PALETTE);

    // Projectiles.
    drawProjectiles(ctx, runtimeProjectiles, ENEMY_PALETTE);

    // Player — hidden during dying, rendered with pop-scale during respawn.
    if (runtimeState !== null) {
      if (dying) {
        // Player hidden during dying phase.
      } else if (respawnPopTick >= 0 && respawnPopTick < DEATH_RESPAWN_POP_TICKS) {
        // Respawn pop-scale: squash-stretch spring recovery.
        const popScale = respawnPopScale(respawnPopTick);
        const core = runtimeState.core;
        ctx.save();
        ctx.translate(core.x + core.width / 2, core.y + core.height);
        ctx.scale(popScale.scaleX, popScale.scaleY);
        ctx.translate(-(core.x + core.width / 2), -(core.y + core.height));
        drawPlayer();
        ctx.restore();
        respawnPopTick += 1;
        if (respawnPopTick >= DEATH_RESPAWN_POP_TICKS) {
          respawnPopTick = -1;
          updateStatus();
        }
      } else {
        drawPlayer();
      }
    }

    ctx.restore();

    // Flash overlay — screen-space, first 3 ticks of dying (unless reduced motion).
    if (dying && deathState !== null && shouldFlash(deathState, rm)) {
      const alpha = flashAlpha(deathState);
      if (alpha > 0) {
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.7})`;
        ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      }
    }

    // HUD — screen-space.
    drawHUD();
    renderTick += 1;
  };

  /**
   * Draw the slime-knight player with all game-feel polish: squash/stretch,
   * launch stretch, breathing, simple feet (with idle blend), additive glow,
   * cyclops eye (with blink), expressive mouth.
   */
  const drawPlayer = (): void => {
    if (runtimeState === null) return;
    const core = runtimeState.core;

    // Volume-preserving scale from the single squashOffset each frame.
    const scale = volumeScale(squashOffset);
    const breath = breathe(renderTick, DEFAULT_BREATH);

    // Pure geometry: compute body rect + feet baseY from core, scales,
    // foot dims, and clearance.  Tested invariants guarantee:
    //   - feet bottom at platform surface (local y=0)
    //   - body bottom `clearance` px above platform surface
    //   - body overlaps the upper portion of the feet
    const FOOT_CLEARANCE = 3;
    const vis = computePlayerVisuals({
      coreX: core.x,
      coreY: core.y,
      coreW: core.width,
      coreH: core.height,
      scaleX: scale.scaleX,
      scaleY: scale.scaleY,
      breathScaleX: breath.scaleX,
      breathScaleY: breath.scaleY,
      footH: IK_PARITY_FEET.footH,
      clearance: FOOT_CLEARANCE,
    });

    // Subtle additive glow under the character.
    drawGlow(
      ctx,
      core.x + core.width / 2,
      core.y + core.height / 2,
      20,
      COLOR_PLAYER,
      0.15,
    );

    // Simple feet (drawn before body so the body covers their tops).
    // `blendLocomotionToStance` blends the walk-cycle pose toward a neutral
    // standing stance (feet at ±PLAYGROUND_IDLE_FOOT_SPREAD/2, foot Y = 0,
    // hip = 0) by `idleBlend`. At idle, the feet settle slightly apart
    // rather than overlapping at the midline (the bug the helper fixes —
    // see docs/design/idle-foot-stance-decision.md). The playground has no
    // airborne tuck (airborneBlendRampUp/Down = 0 in
    // PLAYGROUND_PLATFORMER_CONFIG), so no `blendAirborneTuck` composition
    // is needed here. The foot-plant detector (in the step() loop) reads
    // the RAW `locoPose`, not this blended one, so foot-plant edges stay
    // driven by the actual walk-cycle lift (the documented ordering).
    const locoPose = evaluateLocomotion(loco, PLAYGROUND_GAIT);
    const blendedPose: LocomotionPose = blendLocomotionToStance(
      locoPose,
      idleBlend,
      PLAYGROUND_IDLE_FOOT_SPREAD,
    );
    ctx.save();
    ctx.translate(core.x + core.width / 2, core.y + core.height);
    ctx.scale(core.facing, 1);
    drawSimpleFeet(ctx, blendedPose, {
      ...IK_PARITY_FEET,
      baseY: vis.feetBaseY,
      color: COLOR_PLAYER,
    });
    ctx.restore();

    // Body rect.
    ctx.fillStyle = COLOR_PLAYER;
    ctx.fillRect(vis.bodyX, vis.bodyY, vis.bodyW, vis.bodyH);

    // --- Face features (cute cyclops eye + expressive mouth) ---
    blinkCountdown -= 1;
    if (blinkCountdown <= 0) {
      blinkRemaining = 5;
      blinkCountdown = 120 + Math.floor(Math.random() * 120);
    }
    const blinking = blinkRemaining > 0;
    if (blinking) blinkRemaining -= 1;

    ctx.save();
    ctx.translate(vis.bodyX + vis.bodyW / 2, vis.bodyY + vis.bodyH * 0.35);
    ctx.scale(core.facing, 1);

    ctx.fillStyle = COLOR_FACE;
    if (blinking) {
      ctx.fillRect(-3, -1, 6, 1);
    } else {
      ctx.fillRect(-3, -3, 6, 5);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(1, -2, 2, 2);
      ctx.fillStyle = COLOR_FACE;
    }

    if (!core.onGround) {
      ctx.fillRect(-1, 4, 3, 2);
    } else {
      ctx.strokeStyle = COLOR_FACE;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-3, 4);
      ctx.quadraticCurveTo(0, 7, 3, 4);
      ctx.stroke();
    }

    ctx.restore();
  };

  /** Draw the heads-up display — a status line at the top-left. */
  const drawHUD = (): void => {
    ctx.font = '11px ui-monospace, "SF Mono", "Fira Code", monospace';
    ctx.fillStyle = COLOR_HUD;
    const frozen = isHitStopActive(hitStop) ? '  [FROZEN]' : '';
    const dying = deathState !== null && isDying(deathState)
      ? `  [DYING: ${deathState.reason}]`
      : '';
    const respawning = respawnPopTick >= 0 && respawnPopTick < DEATH_RESPAWN_POP_TICKS
      ? '  [RESPAWNING]'
      : '';
    const px = runtimeState !== null ? Math.round(runtimeState.core.x) : 0;
    const py = runtimeState !== null ? Math.round(runtimeState.core.y) : 0;
    const gd = runtimeState !== null && runtimeState.core.onGround ? 'grounded' : 'airborne';
    ctx.fillText(`x:${px}  y:${py}  ${gd}${frozen}${dying}${respawning}  ·  playing`, 8, 16);
  };

  /** Dispatch the active view. Called on demand from mouse/keyboard handlers
   *  in Edit mode, and once per render frame by the game loop in Play mode. */
  const render = (): void => {
    if (mode === 'play') renderPlay();
    else renderEdit();
  };

  // =========================================================================
  // UI updaters
  // =========================================================================

  /** Refresh the validation + status panel. */
  const updateStatus = (): void => {
    if (mode === 'play') {
      if (deathState !== null && isDying(deathState)) {
        statusPanel.textContent = `Dying (${deathState.reason}) — respawning in ${DEATH_ANIM_TICKS - deathState.tick} ticks.`;
        statusPanel.classList.add('playground-status--invalid');
      } else if (respawnPopTick >= 0 && respawnPopTick < DEATH_RESPAWN_POP_TICKS) {
        statusPanel.textContent = 'Respawning…';
        statusPanel.classList.add('playground-status--invalid');
      } else {
        statusPanel.textContent = 'Playing — click ✎ Edit to modify the level.';
        statusPanel.classList.remove('playground-status--invalid');
      }
      return;
    }
    const errors = editorState.validation.errors;
    const errs = errors.filter((e) => e.severity === 'error');
    const warns = errors.filter((e) => e.severity === 'warning');
    if (errors.length === 0) {
      statusPanel.textContent = 'Level valid.';
      statusPanel.classList.remove('playground-status--invalid');
    } else {
      const first = errors[0];
      statusPanel.textContent =
        `${errs.length} error(s), ${warns.length} warning(s) — ${first.path}: ${first.message}`;
      statusPanel.classList.add('playground-status--invalid');
    }
  };

  /** Refresh toolbar button states: which kind is active, whether select
   *  mode is on, and whether undo is available. */
  const updateToolbar = (): void => {
    for (const btn of kindBtns) {
      const kind = btn.dataset.kind as EntityKind;
      const archetype = btn.dataset.archetype ?? null;
      // Use the pure helper so enemy-kind buttons (Spinny / Turret) are
      // distinguished by archetype — otherwise both light up at once
      // whenever an enemy is selected (they share `data-kind="enemy"`).
      const active =
        editMode === 'place' &&
        isEnemyToolbarButtonActive(selectedKind, selectedEnemyArchetype, kind, archetype);
      btn.classList.toggle('playground-btn--active', active);
      btn.setAttribute('aria-pressed', String(active));
    }
    const selectActive = editMode === 'select';
    selectBtn.classList.toggle('playground-btn--active', selectActive);
    selectBtn.setAttribute('aria-pressed', String(selectActive));
    undoBtn.disabled = editorState.undoStack.length === 0;
  };

  /** Update the section-level data-mode attribute + the toggle button label.
   *  CSS uses [data-mode] to show/hide the toolbar + touch buttons. */
  const updateModeChrome = (): void => {
    container.setAttribute('data-mode', mode);
    modeToggleBtn.textContent = mode === 'play' ? '✎ Edit' : '▶ Play';
    modeToggleBtn.classList.toggle('playground-btn--active', mode === 'edit');
    modeToggleBtn.setAttribute('aria-pressed', String(mode === 'edit'));
  };

  // =========================================================================
  // Mouse handlers — Edit mode only
  // =========================================================================

  const onMouseDown = (e: MouseEvent): void => {
    if (mode !== 'edit') return;
    const mouse = canvasMouse(e);
    snappedMouse = snapToGrid(mouse.x, mouse.y, GRID_SIZE);

    // 1. ShootTo endpoint hit-test for the currently selected turret.
    //    Takes priority so the reticle handle is grabbable even when
    //    overlapping the entity body.
    if (editMode === 'select' && editorState.selection.ids.size > 0) {
      const selId = [...editorState.selection.ids][0];
      const selEntity = editorState.level.entities.find((en) => en.id === selId);
      if (selEntity && shouldShowShootToWidget(selEntity)) {
        const params = (selEntity.props as { params?: Record<string, unknown> }).params;
        if (params) {
          const cx = selEntity.rect.x + selEntity.rect.width / 2;
          const cy = selEntity.rect.y + selEntity.rect.height / 2;
          if (hitTestShootToEndpoint(mouse, cx, cy, params.shootTo, SHOOT_TO_WIDGET_CONFIG.hitRadius)) {
            draggingShootTo = { entityId: selId };
            editorState = beginTransaction(editorState);
            inTransaction = true;
            return;
          }
        }
      }
    }

    // 2. Waypoint hit-test for the currently selected entity with a path
    //    (movingPlatform or enemy with patrolPath). Takes priority over
    //    entity hit-test so a waypoint sitting on top of the entity body
    //    is grabbable.
    const pathEntity = selectedPathEntity();
    if (editMode === 'select' && pathEntity !== null) {
      const data = getPathWidgetData(pathEntity);
      if (data) {
        const wpIdx = hitTestWaypoint(mouse, data.path, data.rect, WAYPOINT_HIT_RADIUS);
        if (wpIdx >= 0) {
          draggingWaypoint = { entityId: pathEntity.id, index: wpIdx };
          editorState = beginTransaction(editorState);
          inTransaction = true;
          return;
        }
      }
    }

    if (editMode === 'select') {
      // 2. Entity hit-test → select + start drag.
      const hit = entityAtPoint(editorState.level, mouse);
      if (hit) {
        editorState = select(editorState, hit.id, 'replace');
        draggingEntityId = hit.id;
        dragLastSnapped = snappedMouse;
      } else {
        editorState = clearSelection(editorState);
      }
      afterEdit();
      return;
    }

    // 3. Place mode — start a drag-draw for sizeable kinds, or click-to-place
    // for non-sizeable kinds.
    const entry = findCatalogEntry(DEFAULT_CATALOG, selectedKind);
    if (!entry) return;
    if (SIZEABLE_KINDS.has(selectedKind)) {
      // Begin a drag-draw transaction. The commit happens on mouseup; if the
      // user never moves the mouse, the drag bounding box is 0×0 and we fall
      // back to the catalog default size on commit.
      editorState = beginTransaction(editorState);
      inTransaction = true;
      drawingRect = { start: snappedMouse, current: snappedMouse };
      render();
    } else {
      // Click-to-place — single op, single undo step (no transaction needed).
      // For movingPlatform, use `instantiateMovingPlatformAt` so the
      // default path is translated to the placement point (otherwise
      // path[0] stays at the catalog default and the platform snaps to
      // (0, 0) on play because the kernel compiles path[0] as its home).
      // For enemy, resolve the dedicated spinny/turret prefab by archetype
      // key (so the default `params.patrolPath` is honored) and translate
      // the patrol so point[0] = placement.
      //
      // For path-bearing entities (movingPlatform and Spinny), use
      // addEntityAndSelect to immediately select the new entity and switch
      // to select mode so the path widget is interactive. For other kinds
      // (including Turret and ordinary paint tools), stay in sticky place
      // mode.
      let op: EditorOperation;
      let isPathBearing = false;
      if (selectedKind === 'movingPlatform') {
        const placed = instantiateMovingPlatformAt(entry, snappedMouse);
        op = {
          type: 'addEntity',
          kind: entry.kind,
          rect: placed.rect,
          props: placed.props,
        };
        isPathBearing = true;
      } else if (selectedKind === 'enemy') {
        // Resolve the dedicated enemy prefab (entries.spinny / entries.turret)
        // via the pure helper — falling back to the generic enemy entry for
        // unknown archetypes. `instantiateEnemyAt` translates the default
        // patrol so a freshly placed Spinny's path[0] matches the placement.
        const enemyEntry = resolveEnemyCatalogEntry(DEFAULT_CATALOG, selectedEnemyArchetype);
        const placed = instantiateEnemyAt(enemyEntry, snappedMouse, selectedEnemyArchetype);
        op = {
          type: 'addEntity',
          kind: 'enemy',
          rect: placed.rect,
          props: placed.props,
        };
        // Spinny (with patrolPath) is path-bearing; Turret is widget-bearing
        // (shootTo endpoint widget). Both use addEntityAndSelect + Select mode.
        isPathBearing = selectedEnemyArchetype === 'spinny' || selectedEnemyArchetype === 'turret';
      } else {
        op = instantiateCatalogEntry(entry, snappedMouse).op;
      }
      if (isPathBearing) {
        // addEntityAndSelect applies the op and selects the new entity so
        // the path widget is immediately visible and interactive.
        editorState = addEntityAndSelect(editorState, op);
        editMode = 'select';
      } else {
        editorState = applyOp(editorState, op);
      }
      afterEdit();
    }
  };

  const onMouseMove = (e: MouseEvent): void => {
    if (mode !== 'edit') return;
    const mouse = canvasMouse(e);
    snappedMouse = snapToGrid(mouse.x, mouse.y, GRID_SIZE);

    // 1. ShootTo endpoint drag — update the relative shootTo vector.
    if (draggingShootTo !== null) {
      const stId = draggingShootTo.entityId;
      const entity = editorState.level.entities.find((en) => en.id === stId);
      if (entity !== undefined) {
        const cx = entity.rect.x + entity.rect.width / 2;
        const cy = entity.rect.y + entity.rect.height / 2;
        // Snap endpoint to grid for consistency with existing UX
        const snapped = snapToGrid(mouse.x, mouse.y, GRID_SIZE);
        const raw = computeShootToFromEndpoint(snapped.x, snapped.y, cx, cy);
        const oldParams = (entity.props as { params?: Record<string, unknown> }).params ?? {};
        editorState = applyOp(editorState, {
          type: 'updateEntityProps',
          id: stId,
          propsPatch: { params: { ...oldParams, shootTo: raw } },
        });
        render();
      }
      return;
    }

    // 2. Waypoint drag — apply an updateEntityProps op for the new path.
    //    The waypoint handles render at the platform's CENTER (top-left +
    //    half rect), so offset the mouse by half the rect to keep the
    //    handle under the cursor (otherwise the waypoint jumps by
    //    (half-width, half-height) the moment the drag begins). When the
    //    dragged waypoint is path[0], also sync the entity's body rect via
    //    a setEntityRect op so the home position stays coherent with the
    //    body the user is dragging (otherwise play would compile a body
    //    rect that no longer matches path[0] and the platform snaps).
    const wp = draggingWaypoint;
    if (wp !== null) {
      const entity = editorState.level.entities.find((en) => en.id === wp.entityId);
      if (entity !== undefined) {
        // Convert mouse → waypoint top-left, then snap top-left so that the
        // rendered handle center (topLeft + halfSize) lands on cell centers
        // (n*grid + grid/2). This preserves parallel motion after edits.
        const rawTopLeft = mouseToWaypointTopLeft(mouse, entity.rect);
        const wpTopLeft = {
          x: Math.round(rawTopLeft.x / GRID_SIZE) * GRID_SIZE,
          y: Math.round(rawTopLeft.y / GRID_SIZE) * GRID_SIZE,
        };

        if (entity.kind === 'movingPlatform') {
          const props = entity.props as MovingPlatformProps;
          if (wp.index === 0) {
            // Waypoint 0 = body home position. Use ONLY setEntityRect which
            // translates path[0] to the new body top-left and preserves the
            // relative offsets of other waypoints. Using updateEntityProps
            // BEFORE setEntityRect would double-translate waypoint 0 (the
            // setEntityRect patrolPath coherence code translates ALL
            // waypoints by the body delta, including the one we just set).
            editorState = applyOp(editorState, {
              type: 'setEntityRect',
              id: wp.entityId,
              rect: {
                x: wpTopLeft.x,
                y: wpTopLeft.y,
                width: entity.rect.width,
                height: entity.rect.height,
              },
            });
          } else {
            // Non-zero waypoint: update only the path via updateEntityProps.
            const newPath = props.path.map((p, i) =>
              i === wp.index ? { x: wpTopLeft.x, y: wpTopLeft.y } : p,
            );
            editorState = applyOp(editorState, {
              type: 'updateEntityProps',
              id: wp.entityId,
              propsPatch: { path: newPath },
            });
          }
        } else if (entity.kind === 'enemy') {
          const params = (entity.props as { params?: Record<string, unknown> }).params ?? {};
          if (wp.index === 0) {
            // Waypoint 0 = body home position. Use ONLY setEntityRect which
            // translates every patrolPath waypoint by the body delta. Using
            // updateEntityProps BEFORE setEntityRect would double-translate
            // waypoint 0.
            editorState = applyOp(editorState, {
              type: 'setEntityRect',
              id: wp.entityId,
              rect: {
                x: wpTopLeft.x,
                y: wpTopLeft.y,
                width: entity.rect.width,
                height: entity.rect.height,
              },
            });
          } else {
            // Non-zero waypoint: update only the patrolPath.
            const oldPath = Array.isArray(params.patrolPath) ? params.patrolPath as { x: number; y: number }[] : [];
            const newPath = oldPath.map((p, i) =>
              i === wp.index ? { x: wpTopLeft.x, y: wpTopLeft.y } : p,
            );
            editorState = applyOp(editorState, {
              type: 'updateEntityProps',
              id: wp.entityId,
              propsPatch: { params: { ...params, patrolPath: newPath } },
            });
          }
        }
        render();
      }
      return;
    }

    // 2. Entity drag — apply moveEntities ops with the per-tick delta.
    if (draggingEntityId !== null && dragLastSnapped !== null) {
      const dx = snappedMouse.x - dragLastSnapped.x;
      const dy = snappedMouse.y - dragLastSnapped.y;
      if (dx !== 0 || dy !== 0) {
        // First drag delta opens a transaction so the whole drag is one
        // undo step (commitTransaction collapses accumulated moveEntities
        // ops into a single batch history entry on mouseup).
        if (!inTransaction) {
          editorState = beginTransaction(editorState);
          inTransaction = true;
        }
        editorState = applyOp(editorState, {
          type: 'moveEntities',
          ids: [draggingEntityId],
          dx,
          dy,
        });
        dragLastSnapped = snappedMouse;
        render();
      }
      return;
    }

    // 3. Drag-draw — update the current corner of the bounding box.
    if (drawingRect !== null) {
      drawingRect = { start: drawingRect.start, current: snappedMouse };
      render();
      return;
    }

    // 4. Otherwise just refresh the ghost preview (place mode only).
    if (editMode === 'place') render();
  };

  const onMouseUp = (): void => {
    if (mode !== 'edit') return;

    // ShootTo endpoint drag — commit the transaction.
    if (draggingShootTo !== null) {
      if (inTransaction) {
        editorState = commitTransaction(editorState, 'Move shootTo endpoint');
        inTransaction = false;
      }
      draggingShootTo = null;
      afterEdit();
      return;
    }

    // Waypoint drag — commit the transaction.
    if (draggingWaypoint !== null) {
      if (inTransaction) {
        editorState = commitTransaction(editorState, 'Move waypoint');
        inTransaction = false;
      }
      draggingWaypoint = null;
      afterEdit();
      return;
    }

    // Entity drag — commit the transaction (if one was opened).
    if (draggingEntityId !== null) {
      if (inTransaction) {
        editorState = commitTransaction(editorState, 'Drag entity');
        inTransaction = false;
      }
      draggingEntityId = null;
      dragLastSnapped = null;
      afterEdit();
      return;
    }

    // Drag-draw — commit the addEntity op with the bounding box (or default size).
    if (drawingRect !== null) {
      const entry = findCatalogEntry(DEFAULT_CATALOG, selectedKind);
      if (entry) {
        // `buildDrawnEntityOp` is the same helper tested in
        // showcase/tests/playground-helpers.test.ts: if the drag is smaller
        // than `MIN_DRAW_SIZE` in either dimension, it falls back to the
        // catalog default size at the start corner so a click places an
        // entity rather than producing a degenerate 0×0 rect.
        const op = buildDrawnEntityOp(
          entry,
          drawingRect.start,
          drawingRect.current,
          MIN_DRAW_SIZE,
        );
        editorState = applyOp(editorState, op);
      }
      if (inTransaction) {
        editorState = commitTransaction(editorState, `Draw ${selectedKind}`);
        inTransaction = false;
      }
      drawingRect = null;
      afterEdit();
    }
  };

  const onMouseEnter = (): void => {
    mouseOverCanvas = true;
    if (mode === 'edit' && editMode === 'place') render();
  };
  const onMouseLeave = (): void => {
    mouseOverCanvas = false;
    if (mode === 'edit' && editMode === 'place') render();
  };

  // Cancel any in-flight drag if Esc is pressed (defensive — also fires on
  // mouseleave via window blur in some edge cases).
  const cancelDrag = (): void => {
    if (mode !== 'edit') return;
    if (drawingRect !== null || draggingEntityId !== null || draggingWaypoint !== null || draggingShootTo !== null) {
      // Roll back the in-flight transaction by re-creating editorState from
      // the last committed level (the pre-transaction level is preserved on
      // the EditorState as `transactionStartSnapshot` while in a transaction;
      // if we exit that state abnormally we can roll back to it directly).
      if (inTransaction && editorState.transactionStartSnapshot !== null) {
        editorState = {
          ...editorState,
          level: editorState.transactionStartSnapshot,
          pendingTransaction: null,
          transactionStartSnapshot: null,
        };
      }
      inTransaction = false;
      drawingRect = null;
      draggingEntityId = null;
      dragLastSnapped = null;
      draggingWaypoint = null;
      draggingShootTo = null;
      afterEdit();
    }
  };

  const onKeyDownCancel = (e: KeyboardEvent): void => {
    if (mode !== 'edit' || !onscreen) return;
    if (e.code === 'Escape') cancelDrag();
  };
  window.addEventListener('keydown', onKeyDownCancel);

  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mouseenter', onMouseEnter);
  canvas.addEventListener('mouseleave', onMouseLeave);
  // mousemove + mouseup on window so dragging beyond the canvas edge doesn't
  // strand the mouse — the drag continues until release anywhere on the page.
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);

  // =========================================================================
  // Toolbar handlers
  // =========================================================================

  for (const btn of kindBtns) {
    btn.addEventListener('click', () => {
      if (mode !== 'edit') return;
      selectedKind = btn.dataset.kind as EntityKind;
      // If this is an enemy archetype button, also set the archetype.
      if (btn.dataset.archetype) {
        selectedEnemyArchetype = btn.dataset.archetype;
      }
      editMode = 'place';
      updateToolbar();
      render();
    });
  }
  selectBtn.addEventListener('click', () => {
    if (mode !== 'edit') return;
    editMode = 'select';
    updateToolbar();
    render();
  });
  undoBtn.addEventListener('click', () => {
    if (mode !== 'edit' || draggingEntityId !== null || drawingRect !== null) return;
    editorState = undo(editorState);
    afterEdit();
  });
  modeToggleBtn.addEventListener('click', () => {
    if (mode === 'play') enterEdit();
    else enterPlay();
  });

  // =========================================================================
  // Mode transitions
  // =========================================================================

  /**
   * Enter Play mode: snapshot the editor, compile the runtime level,
   * reset transient FX state, drain stale keyboard edges, render the
   * initial frame, and (unless reduced motion) start the loop.
   *
   * Idempotent on initial boot: the section opens in `mode === 'play'`
   * but with `compiled === null` (no level has been compiled yet). The
   * guard therefore allows the call through whenever the runtime hasn't
   * been initialized, so the very first `enterPlay()` from the boot
   * sequence actually compiles, paints, and starts the loop instead of
   * silently no-op'ing.
   */
  const enterPlay = (): void => {
    if (mode === 'play' && compiled !== null) return;
    // Roll back any in-flight edit drag before snapshotting so the snapshot
    // is clean (the user clicks Play mid-drag — drop the pending drag).
    cancelDrag();
    // `startSession` is the pure helper tested in
    // showcase/tests/playground-session.test.ts: deep-clones the editor's
    // level (sandbox boundary), compiles the kernel inputs from the clone,
    // and returns the runtime state marked grounded at spawn.
    const session = startSession(editorState, {
      platformerConfig: PLAYGROUND_PLATFORMER_CONFIG,
      playerWidth: PLAYER_W,
      playerHeight: PLAYER_H,
    });
    playtestSnapshot = session.snapshot;
    compiled = session.compiled;
    runtimeState = session.runtimeState;
    runtimePlatforms = session.movingPlatforms;
    // Compile enemies from the snapshot.
    runtimeEnemies = compileEnemies(session.snapshot);
    runtimeProjectiles = [];
    enemyRegistry = createEnemyBehaviorRegistry();
    deathState = null;
    respawnPopTick = -1;
    deathParticles = [];
    // Reset FX.
    hitStop = createHitStop();
    squashOffset = 0;
    dustParticles = [];
    shakeMagnitude = 0;
    shakeTick = 0;
    loco = { phase: 0 };
    plantState = createFootPlantState();
    idleBlend = 0;
    mode = 'play';
    updateModeChrome();
    updateToolbar();
    updateStatus();
    render();
    // Drain any stale keyboard edges latched since the last poll so the
    // player doesn't auto-jump if the user pressed Space while editing.
    keyboard.poll();
    if (shouldAnimate()) {
      // Reduced motion — render a single static frame, no loop.
      return;
    }
    loop.start();
  };

  /**
   * Exit Play mode: stop the loop, restore the editor from the snapshot
   * (full undo history preserved), and resume editor rendering.
   */
  const enterEdit = (): void => {
    if (mode !== 'play') return;
    loop.stop();
    if (playtestSnapshot !== null) {
      // `stopSession` is the pure helper tested in the session suite —
      // restores the editor from the deep-cloned snapshot taken on
      // enterPlay, with the full undo history preserved.
      editorState = stopSession(editorState, playtestSnapshot);
    }
    mode = 'edit';
    playtestSnapshot = null;
    compiled = null;
    runtimeState = null;
    runtimePlatforms = [];
    runtimeEnemies = [];
    runtimeProjectiles = [];
    enemyRegistry = null;
    deathState = null;
    respawnPopTick = -1;
    deathParticles = [];
    updateModeChrome();
    afterEdit();
  };

  // =========================================================================
  // Game loop (drives Play-mode sim + render)
  // =========================================================================

  const loop: GameLoop = createGameLoop({
    fixedDt: 1 / 60,
    step: () => {
      if (mode !== 'play' || runtimeState === null || compiled === null) return;

      const rm = shouldAnimate();

      // 1. Advance hit-stop timer regardless of the freeze so the freeze
      //    actually ends. When active, skip gameplay but still advance death
      //    state so the death animation progresses during hit-stop freeze.
      hitStop = stepHitStop(hitStop, 1);
      if (isHitStopActive(hitStop)) {
        // Death timer and particles advance during hit-stop (visual freeze
        // is the point — effects keep running while gameplay is frozen).
        if (deathState !== null && isDying(deathState)) {
          deathState = advanceDeath(deathState);
          deathParticles = stepParticles(deathParticles, 1, { drag: DEATH_PARTICLE_DRAG });
          if (shouldRespawn(deathState)) {
            resetPlayer();
            deathState = null;
            respawnPopTick = 0;
            updateStatus();
          }
        }
        return;
      }

      // 2. Death progression — advance death timer, step death particles.
      //    Gameplay remains frozen during the dying phase.
      if (deathState !== null && isDying(deathState)) {
        deathState = advanceDeath(deathState);
        deathParticles = stepParticles(deathParticles, 1, { drag: DEATH_PARTICLE_DRAG });
        if (shouldRespawn(deathState)) {
          resetPlayer();
          deathState = null;
          respawnPopTick = 0;
          updateStatus();
        }
        return;
      }

      // 3. Poll input — drain edge latches once per fixed tick. Keyboard +
      //    touch are OR-merged per action. Onscreen gate: only respond to
      //    movement input while this section is visible (both this section
      //    + the hero listen on window; without this gate pressing arrows
      //    drives both simultaneously).
      const kb = keyboard.poll();
      const t = touch.poll();
      const leftEdge = orEdges(kb['left'] ?? IDLE_EDGE, t[0] ?? IDLE_EDGE);
      const rightEdge = orEdges(kb['right'] ?? IDLE_EDGE, t[1] ?? IDLE_EDGE);
      const jumpEdge = orEdges(kb['jump'] ?? IDLE_EDGE, t[2] ?? IDLE_EDGE);

      // 4. Reset (R-key) — instant teleport back to spawn. Edge-triggered.
      //    Works even during respawn pop (manual reset always wins).
      if (kb['reset']?.pressed) {
        deathState = null;
        respawnPopTick = -1;
        deathParticles = [];
        resetPlayer();
        updateStatus();
      }

      // 5. Compose PlatformerInput from polled edges.
      const moveX: -1 | 0 | 1 = !onscreen
        ? 0
        : leftEdge.held === rightEdge.held
          ? 0
          : leftEdge.held
            ? -1
            : 1;
      const jumpInput: PolledEdge = onscreen ? jumpEdge : IDLE_EDGE;
      const input: PlatformerInput = { moveX, jump: jumpInput, dash: null };

      // 6. Capture pre-step vy for impact-velocity reconstruction.
      const preVy = runtimeState.core.vy;

      // 7. Advance moving platforms BEFORE composing per-tick solids so the
      //    platforms are at their new positions when collision resolution
      //    runs. The carry provider compares `advanced` (this tick's new
      //    positions) against `runtimePlatforms` (the pre-advance positions
      //    the platform had entering this tick) — i.e. exactly one tick of
      //    motion. (Previously this threaded a `prevRuntimePlatforms` value
      //    that lagged by one assignment, so the displacement provider
      //    compared against two-ticks-old positions and over-counted carry.)
      const advanced = runtimePlatforms.map((p) => advanceMovingPlatform(p, 1 / 60));
      const displacement = createMovingPlatformDisplacementProvider(
        advanced,
        runtimePlatforms,
      );
      const platformSolids = advanced.map(movingPlatformToSolid);
      runtimePlatforms = advanced;

      // 8. Compose per-tick solids: static geometry + current platform rects.
      const tickSolids: Solid[] = [...compiled.staticSolids, ...platformSolids];

      // 9. Step the platformer kernel — the single authoritative call.
      const result = stepPlatformer(
        runtimeState,
        input,
        tickSolids,
        1 / 60,
        PLAYGROUND_PLATFORMER_CONFIG,
        displacement,
      );
      runtimeState = result.state;

      // 9b. Step enemies — advances behaviors, collects spawned projectiles.
      if (enemyRegistry !== null) {
        const enemyCtx = {
          dt: 1 / 60,
          solids: tickSolids,
          tileQuery: null,
          tileSize: TILE_SIZE,
          playerRect: runtimeState !== null
            ? { x: runtimeState.core.x, y: runtimeState.core.y, width: runtimeState.core.width, height: runtimeState.core.height }
            : null,
        };
        const enemyResult = stepEnemies(runtimeEnemies, enemyRegistry, enemyCtx);
        runtimeEnemies = enemyResult.enemies;
        // Append newly spawned projectiles to the live pool.
        runtimeProjectiles = [...runtimeProjectiles, ...enemyResult.projectiles];
      }

      // 9c. Step projectiles — move, check solid collision, check player overlap.
      //     The hitting projectile is already deactivated by stepProjectile
      //     (hitPlayer flag set, alive=false), so it's naturally filtered from
      //     the alive pool. We still track the hit for death entry.
      const playerRect = runtimeState !== null
        ? { x: runtimeState.core.x, y: runtimeState.core.y, width: runtimeState.core.width, height: runtimeState.core.height }
        : undefined;
      const steppedProjectiles: ProjectileState[] = [];
      let projectileHitPlayer = false;
      for (const proj of runtimeProjectiles) {
        const stepped = stepProjectile(proj, 1 / 60, tickSolids, playerRect);
        if (stepped.alive) {
          steppedProjectiles.push(stepped);
        }
        if (stepped.hitPlayer) {
          projectileHitPlayer = true;
        }
      }
      runtimeProjectiles = steppedProjectiles;

      // 9d. Check player overlap with enemies (AABB test).
      let enemyHitPlayer = false;
      if (runtimeState !== null) {
        const pr = { x: runtimeState.core.x, y: runtimeState.core.y, width: runtimeState.core.width, height: runtimeState.core.height };
        for (const enemy of runtimeEnemies) {
          if (!enemy.state.alive) continue;
          const er = { x: enemy.state.x, y: enemy.state.y, width: 16, height: 16 };
          if (aabbOverlap(pr, er)) {
            enemyHitPlayer = true;
            break;
          }
        }
      }

      // 9e. Handle player death from enemy/projectile contact — enters the
      //     death pipeline instead of immediate reset. Guard: only trigger
      //     if not already dying (repeated hits must not retrigger).
      if (enemyHitPlayer || projectileHitPlayer) {
        if (deathState === null || !isDying(deathState)) {
          const reason = enemyHitPlayer ? 'enemy' as const : 'projectile' as const;
          const pcx = runtimeState.core.x + runtimeState.core.width / 2;
          const pcy = runtimeState.core.y + runtimeState.core.height / 2;
          const impactDirX = enemyHitPlayer ? 0 : -1;
          deathState = beginDeath(reason, pcx, pcy, impactDirX, 0);

          // One-shot: hit-stop freeze.
          hitStop = triggerHitStop(hitStop, DEATH_HIT_STOP_TICKS);

          // One-shot: deterministic radial burst at pre-death player center.
          const particleCount = rm ? DEATH_PARTICLE_COUNT_REDUCED : DEATH_PARTICLE_COUNT;
          const rng = mulberry32(DEATH_RNG_SEED);
          deathParticles = spawn(pcx, pcy, {
            count: particleCount,
            speed: DEATH_PARTICLE_SPEED,
            speedJitter: 0.2,
            life: DEATH_PARTICLE_LIFE,
            size: DEATH_PARTICLE_SIZE,
            color: DEATH_PARTICLE_COLOR,
            rng,
          });

          // One-shot: descending tone.
          audio.playTone('sawtooth', 300, 100, 120, 0.25);

          updateStatus();
        }
        return;
      }

      // 10. Fall-off-world — enters the same death pipeline.
      if (runtimeState.core.y > VIEW_H + RESPAWN_FALL_MARGIN) {
        if (deathState === null || !isDying(deathState)) {
          const pcx = runtimeState.core.x + runtimeState.core.width / 2;
          const pcy = runtimeState.core.y + runtimeState.core.height / 2;
          deathState = beginDeath('fall', pcx, pcy, 0, 1);

          hitStop = triggerHitStop(hitStop, DEATH_HIT_STOP_TICKS);

          const particleCount = rm ? DEATH_PARTICLE_COUNT_REDUCED : DEATH_PARTICLE_COUNT;
          const rng = mulberry32(DEATH_RNG_SEED);
          deathParticles = spawn(pcx, pcy, {
            count: particleCount,
            speed: DEATH_PARTICLE_SPEED,
            speedJitter: 0.2,
            life: DEATH_PARTICLE_LIFE,
            size: DEATH_PARTICLE_SIZE,
            color: DEATH_PARTICLE_COLOR,
            rng,
          });

          audio.playTone('sawtooth', 300, 100, 120, 0.25);

          updateStatus();
        }
        return;
      }

      // 11. Drive effects from kernel events.
      if (runtimeState.events.justLaunched) {
        squashOffset = LAUNCH_STRETCH;
        audio.playTone('sine', 200, 400, 80, 0.2);
      }
      if (runtimeState.events.justLanded) {
        const impactPerTick =
          Math.max(0, preVy + IMPACT_GRAVITY_PER_TICK_PX_PER_SEC) / 60;
        if (impactPerTick > 2) {
          squashOffset = -MAX_SQUASH * Math.min(1, impactPerTick / REFERENCE_VELOCITY_TICKS);
          const dustCount = Math.min(6, Math.floor(impactPerTick * 0.7));
          if (dustCount > 0) {
            const dust = spawn(
              runtimeState.core.x + runtimeState.core.width / 2,
              runtimeState.core.y + runtimeState.core.height - 2,
              {
                count: dustCount,
                speed: Math.max(1, impactPerTick * 0.25),
                life: 18,
                size: 3,
                color: COLOR_DUST_LANDING,
                angleOffset: -Math.PI / 2,
              },
            );
            dustParticles = [...dustParticles, ...dust];
          }
        }
        if (impactPerTick > HIT_STOP_THRESHOLD_TICKS) {
          hitStop = triggerHitStop(hitStop, HIT_STOP_DURATION);
          shakeTick = 0;
          shakeMagnitude = Math.min(
            SHAKE_MAX_MAGNITUDE,
            impactPerTick * SHAKE_MAGNITUDE_PER_IMPACT,
          );
        }
        if (impactPerTick > HIT_STOP_THRESHOLD_TICKS) {
          audio.playNoise(80, 'lowpass', 300, 0.3);
        } else if (impactPerTick > 2) {
          audio.playNoise(50, 'lowpass', 250, 0.18);
        }
      }

      // 12. Idle feet blend — ease toward neutral standing stance when still.
      if (
        runtimeState.core.onGround &&
        Math.abs(runtimeState.core.vx) < FOOTSTEP_MIN_SPEED_TICKS * 60
      ) {
        idleBlend = Math.min(1, idleBlend + 0.08);
      } else {
        idleBlend = Math.max(0, idleBlend - 0.2);
      }

      // 12. Step dust particles.
      dustParticles = stepParticles(dustParticles, 1, {
        gravity: DUST_GRAVITY,
        drag: DUST_DRAG,
      });

      // 13. Advance locomotion phase by actual horizontal displacement.
      if (runtimeState.core.onGround) {
        const localDx = (runtimeState.core.vx / 60) * runtimeState.core.facing;
        loco = advanceLocomotionByDisplacement(loco, localDx, PLAYGROUND_GAIT);
      }
      const locoPose = evaluateLocomotion(loco, PLAYGROUND_GAIT);

      // 14. Per-step dust + audio via the foot-plant detector.
      const footstepMinSpeedPxPerSec = FOOTSTEP_MIN_SPEED_TICKS * 60;
      const plant = advanceFootPlant(
        plantState,
        locoPose.leftFootOffset.y,
        locoPose.rightFootOffset.y,
      );
      plantState = plant.state;
      if (
        plant.events.leftPlanted &&
        Math.abs(runtimeState.core.vx) > footstepMinSpeedPxPerSec
      ) {
        spawnFootstepDust(
          runtimeState.core.x + runtimeState.core.width / 2 - runtimeState.core.facing * 5,
        );
        audio.playNoise(FOOTSTEP_SOUND_DUR, 'lowpass', FOOTSTEP_SOUND_FREQ, FOOTSTEP_SOUND_PEAK);
      }
      if (
        plant.events.rightPlanted &&
        Math.abs(runtimeState.core.vx) > footstepMinSpeedPxPerSec
      ) {
        spawnFootstepDust(
          runtimeState.core.x + runtimeState.core.width / 2 + runtimeState.core.facing * 5,
        );
        audio.playNoise(FOOTSTEP_SOUND_DUR, 'lowpass', FOOTSTEP_SOUND_FREQ, FOOTSTEP_SOUND_PEAK);
      }

      // 15. Decay squash back to neutral.
      squashOffset *= SQUASH_DECAY;
    },
    render: () => {
      render();
    },
  });

  // =========================================================================
  // Reset (R-key + fall-off respawn)
  // =========================================================================

  /**
   * Reset the runtime state to spawn + clear all transient FX. Shared by
   * the R-key manual reset and the delayed respawn after the death anim.
   */
  const resetPlayer = (): void => {
    if (compiled === null) return;
    const reset = resetToInitialState(compiled);
    runtimeState = reset.runtimeState;
    runtimePlatforms = reset.movingPlatforms;
    if (playtestSnapshot !== null) {
      runtimeEnemies = compileEnemies(playtestSnapshot);
    }
    runtimeProjectiles = [];
    squashOffset = 0;
    dustParticles = [];
    shakeMagnitude = 0;
    shakeTick = 0;
    loco = { phase: 0 };
    plantState = createFootPlantState();
    idleBlend = 0;
  };

  // =========================================================================
  // Initial paint + UI
  // =========================================================================

  updateModeChrome();
  updateToolbar();
  updateStatus();

  // =========================================================================
  // Teardown
  // =========================================================================

  const dispose = (): void => {
    loop.dispose();
    keyboard.dispose();
    touch.dispose();
    observer.disconnect();
    window.removeEventListener('keydown', onKeyDownSuppress, { capture: true });
    window.removeEventListener('keydown', onKeyDownEditor);
    window.removeEventListener('keydown', onKeyDownCancel);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    window.removeEventListener('keydown', unlockAudio);
    window.removeEventListener('pointerdown', unlockAudio);
    canvas.removeEventListener('mousedown', onMouseDown);
    canvas.removeEventListener('mouseenter', onMouseEnter);
    canvas.removeEventListener('mouseleave', onMouseLeave);
  };

  // =========================================================================
  // Motion gate + initial mode boot
  // =========================================================================

  // Default mode is Play. Enter Play mode (compiles the level, renders the
  // initial frame). If reduced motion is preferred, the loop is NOT started
  // (a single static frame is rendered).
  enterPlay();
  // enterPlay already rendered; if reduced-motion, loop is not started and
  // the single frame stands.

  return dispose;
}
