# API Proposal: Procedural Spider Locomotion

> Target pillar: 1 (Primitives / Animation). Module: `src/animation/spider/`.
> Builds on research: `docs/research/procedural-spider-locomotion.md`.
> Status: DRAFT.

## Consumer Need

Spitekeep (IMP - Not a Troll) and future Clone-to-Jest siblings need terrifying, procedurally-animated multi-legged spider enemies. Without this, the only option is pre-baked spritesheet animation — which costs memory, looks stiff, and can't adapt to terrain. This unlocks:

- **Zero-Asset Scary Enemies:** Procedural scuttling reads as far more organic and creepy than pre-baked sprites, making spider-like enemies genuinely scary while keeping asset sizes at zero.
- **Dynamic Procedural Variety:** Swapping leg counts, leg lengths, body segmentation, eye counts, and colors allows generating infinite arachnid/insectoid variety from a single codebase.
- **Terrain-Adaptive Foot Placement:** Feet sample the tile grid via `TileSolidityQuery`, planting realistically on uneven platforms without sprite-level foot-sliding.

The spider will eventually register a `'spider'` archetype handler in the enemy behavior registry (`src/platformer/enemy/registry.ts`), where the behavior handler DRIVES the gait/stepping solver and the renderer draws the result.

---

## Scope (LOCKED by user)

- **Gait modes:** Both `'coordinated'` (alternating tetrapod) and `'frantic'` (free-stepping with neighbor-lock) ship, switchable via config.
- **Leg count:** 4 foreground + 4 background (drawn darker, offset). Full 8-leg silhouette.
- **Climbing scope v1:** Floor/platform walking ONLY. Feet sample downward using `TileSolidityQuery`. Design for multi-surface extension (sampling-direction strategy) but don't build it now.
- **Body:** Full segmented body — cephalothorax + lagging abdomen (volume-preserving squash/stretch), 8 eyes of varied size, chelicerae, twitchy pedipalps via `spring-rod`. Seeded jitter on body outline for per-spider uniqueness.

---

## Approach A: Monolithic Spider Module

**Source pattern:** The simplest consumer API — one module with one factory, one step function, one draw function. Mirrors the existing `src/animation/simple-feet.ts` pattern (single file, self-contained).

**File location:** `src/animation/spider/`

**Signature sketch:**

```ts
// In src/animation/spider/spider.ts

import type { Vec2 } from '../types';
import type { TileSolidityQuery } from '../../collision/types';

/**
 * Spider gait mode selector.
 * 'coordinated' = strict alternating tetrapod (stable predatory stalk).
 * 'frantic' = free-stepping with neighbor-lock (chaotic scuttle).
 */
export type SpiderGaitMode = 'coordinated' | 'frantic';

/**
 * Spider body palette. All hex strings.
 * Every color is a config field — no magic colors in the renderer.
 */
export interface SpiderPalette {
  /** Cephalothorax fill. */
  readonly cephFill: string;
  /** Abdomen fill. */
  readonly abdFill: string;
  /** Foreground leg color. */
  readonly legFg: string;
  /** Background leg color (darker shade). */
  readonly legBg: string;
  /** Eye fill (high-contrast). */
  readonly eyeFill: string;
  /** Chelicerae (fang) fill. */
  readonly cheliceraeFill: string;
  /** Pedipalp fill. */
  readonly palpFill: string;
  /** Outline color (shared). */
  readonly outline: string;
}

/**
 * Spider configuration. Every tunable value is a field — no magic numbers.
 * Spread `DEFAULT_SPIDER` and override what you need.
 */
export interface SpiderConfig {
  /** Gait mode: 'coordinated' (alternating tetrapod) or 'frantic' (free-stepping). */
  readonly gaitMode: SpiderGaitMode;
  /** Leg count per side (default 4). Foreground + background = legCount * 2 total. */
  readonly legCount: number;
  /** Thigh length in px (upper leg segment). */
  readonly thighLength: number;
  /** Shin length in px (lower leg segment). */
  readonly shinLength: number;
  /** Distance between leg attachment points on the cephalothorax (px). */
  readonly legSpacing: number;
  /** Comfort radius — foot must be this far from rest position before stepping (px). */
  readonly comfortRadius: number;
  /** How far ahead of rest position to step, as a fraction of velocity (0-1). */
  readonly overshootFactor: number;
  /** Height of the parabolic step arc in px. */
  readonly stepHeight: number;
  /** Step duration in seconds (time to complete one foot lift-and-plant). */
  readonly stepDuration: number;
  /** Step frequency multiplier for 'frantic' mode. */
  readonly franticFrequency: number;
  /** Cephalothorax radius in px. */
  readonly cephRadius: number;
  /** Abdomen base rx (horizontal radius) in px. */
  readonly abdRx: number;
  /** Abdomen base ry (vertical radius) in px. */
  readonly abdRy: number;
  /** Abdomen offset from cephalothorax center (px, facing-relative). */
  readonly abdOffsetX: number;
  /** Breathing frequency (radians per tick). */
  readonly breathFrequency: number;
  /** Breathing amplitude (fractional scale variation). */
  readonly breathAmplitude: number;
  /** Leg joint radius (visual thickness in px). */
  readonly jointRadius: number;
  /** Body outline jitter amplitude (px). Uses seeded RNG for per-spider uniqueness. */
  readonly bodyJitterAmplitude: number;
  /** Pedipalp segment length (px). */
  readonly palpSegmentLength: number;
  /** Pedipalp stiffness (0-1, mapped to spring-rod internals). */
  readonly palpStiffness: number;
  /** Scale factor for reduced-motion accessibility (0 = no animation, 1 = full). */
  readonly motionScale: number;
  /** Body palette. */
  readonly palette: SpiderPalette;
  /** Number of sub-sample steps when sampling ground downward (1 = simple, 3+ = thorough). */
  readonly groundSampleSteps: number;
}

/**
 * Per-leg persistent state. Carried across ticks via EnemyState.data.
 */
export interface SpiderLegState {
  /** Unique leg identifier (e.g. 'L1', 'R2'). */
  readonly id: string;
  /** Gait set assignment: 'A' or 'B' (for coordinated mode). */
  readonly set: 'A' | 'B';
  /** Current foot world position. */
  readonly footX: number;
  readonly footY: number;
  /** Rest position local to the body (relative to attachment point). */
  readonly restLocalX: number;
  readonly restLocalY: number;
  /** Phase within the current step animation [0, 1]. 0 = planted, >0 = mid-step. */
  readonly stepPhase: number;
  /** Start position of the current step arc (world space). */
  readonly stepStartX: number;
  readonly stepStartY: number;
  /** End position of the current step arc (world space). */
  readonly stepEndX: number;
  readonly stepEndY: number;
  /** Mid position of the current step arc (world space, lifted). */
  readonly stepMidX: number;
  readonly stepMidY: number;
  /** Whether this leg is currently in swing phase. */
  readonly isSwinging: boolean;
  /** Ground-sample result: has solid ground below? */
  readonly hasGround: boolean;
}

/**
 * Full spider state. Stored in EnemyState.data as a single JSON-serializable blob.
 */
export interface SpiderState {
  /** Per-leg states, ordered L1-L4, R1-R4. */
  readonly legs: readonly SpiderLegState[];
  /** Global gait phase (radians, [0, 2π)). */
  readonly gaitPhase: number;
  /** Pedipalp spring-rod nodes (from advanceSpringRod). */
  readonly palpNodesL: readonly import('../spring').VerletNode[];
  readonly palpNodesR: readonly import('../spring').VerletNode[];
  /** Body jitter seed (for per-spider uniqueness via mulberry32). */
  readonly jitterSeed: number;
}

/**
 * Spider rendering pose — pre-computed from SpiderState + body position.
 * Passed to the draw function. Renderer-adjacent only.
 */
export interface SpiderPose {
  /** Cephalothorax center in world space. */
  readonly cephalothorax: { readonly x: number; readonly y: number; readonly radius: number };
  /** Abdomen center + radii in world space. */
  readonly abdomen: { readonly x: number; readonly y: number; readonly rx: number; readonly ry: number };
  /** Eye positions and sizes (8 eyes). */
  readonly eyes: readonly { readonly x: number; readonly y: number; readonly radius: number }[];
  /** Chelicerae (fang) positions. */
  readonly chelicerae: readonly { readonly x: number; readonly y: number; readonly angle: number }[];
  /** Per-leg IK results: root → joint → end. */
  readonly legPoses: readonly {
    readonly rootX: number; readonly rootY: number;
    readonly jointX: number; readonly jointY: number;
    readonly endX: number; readonly endY: number;
    readonly isBg: boolean;
  }[];
  /** Pedipalp node chains. */
  readonly palpChains: readonly (readonly Vec2[][]);
  /** Body jitter offsets for the outline (per-vertex). */
  readonly jitterOffsets: readonly number[];
}

/**
 * Default spider config. Matches a Sokpop-scale side-view spider.
 * Spread and override fields for your specific creature.
 */
export const DEFAULT_SPIDER: Readonly<SpiderConfig>;

/**
 * Create initial spider state for 8 legs (L1-L4, R1-R4).
 *
 * Legs are arranged symmetrically: L-series on the left, R-series on the right.
 * Each leg's restLocal position is computed from config.legSpacing and config.legCount.
 * Pedipalp chains are created via createSpringRod.
 *
 * @param config - spider configuration
 * @param jitterSeed - seed for per-spider body jitter (use mulberry32 for variety)
 * @returns fresh SpiderState
 */
export function createSpiderState(config: SpiderConfig, jitterSeed: number): SpiderState;

/**
 * Advance spider gait by one tick. Pure deterministic core.
 *
 * Evaluates step triggers for each leg, advances swing-phase interpolation,
 * and coordinates the gait (coordinated or frantic mode). Samples ground
 * downward via TileSolidityQuery only when a leg is about to step (lazy).
 *
 * Same (state, bodyX, bodyY, vx, vy, facing, dt, config, tileQuery, tileSize, tick)
 * → byte-identical output. No Math.random, no Date.now().
 *
 * @param state - current spider state (immutable, fresh copy returned)
 * @param bodyX - body center X in world space
 * @param bodyY - body center Y in world space
 * @param vx - body horizontal velocity (px/s)
 * @param vy - body vertical velocity (px/s)
 * @param facing - +1 right, -1 left
 * @param dt - fixed timestep
 * @param config - spider configuration
 * @param tileQuery - tile solidity query (pure, no host access)
 * @param tileSize - tile grid cell size in px
 * @param tick - current simulation tick (for phase accumulator)
 * @returns fresh SpiderState
 */
export function advanceSpiderState(
  state: SpiderState,
  bodyX: number,
  bodyY: number,
  vx: number,
  vy: number,
  facing: 1 | -1,
  dt: number,
  config: SpiderConfig,
  tileQuery: TileSolidityQuery,
  tileSize: number,
  tick: number,
): SpiderState;

/**
 * Compute the spider's rendering pose from state + body position.
 *
 * Evaluates body segment positions (cephalothorax, abdomen lag + breathing),
 * solves IK for each leg using solveLimb, positions eyes and chelicerae,
 * and evaluates pedipalp spring-rods. Pure function of state + config.
 *
 * Renderer-adjacent: composes IK solvers + spring-rods + body math.
 * No simulation mutation.
 *
 * @param state - current spider state
 * @param bodyX - body center X
 * @param bodyY - body center Y
 * @param facing - +1 right, -1 left
 * @param tick - current render tick (for breathing oscillation)
 * @param config - spider configuration
 * @returns pre-computed SpiderPose for the draw function
 */
export function evaluateSpiderPose(
  state: SpiderState,
  bodyX: number,
  bodyY: number,
  facing: 1 | -1,
  tick: number,
  config: SpiderConfig,
): SpiderPose;

/**
 * Draw the spider at the given pose. Renderer-adjacent.
 *
 * Draws in this order:
 * 1. Background legs (darker, slightly offset)
 * 2. Abdomen (with jittered outline)
 * 3. Cephalothorax (with jittered outline)
 * 4. Eyes (high-contrast dots of varied size)
 * 5. Chelicerae (fang pincers)
 * 6. Foreground legs (full color)
 * 7. Pedipalps (spring-rod chains, drawn as polylines)
 *
 * Saves/restores ctx state. No simulation mutation. Never throws.
 *
 * @param ctx - canvas 2D context (caller owns transform/state)
 * @param pose - pre-computed spider pose from evaluateSpiderPose
 * @param config - spider configuration (for palette + sizes)
 */
export function drawSpider(
  ctx: CanvasRenderingContext2D,
  pose: SpiderPose,
  config: SpiderConfig,
): void;
```

**Usage example:**

```ts
// In the 'spider' archetype behavior handler:
import {
  createSpiderState,
  advanceSpiderState,
  evaluateSpiderPose,
  drawSpider,
  DEFAULT_SPIDER,
} from 'aicraft-engine/src/animation/spider';
import { shade } from 'aicraft-engine/src/primitives/color';

// --- Behavior handler (deterministic core) ---
const spiderBehavior: EnemyBehaviorHandler = {
  step(state, ctx, params) {
    const spiderState = state.data.spiderState as SpiderState;
    const config = { ...DEFAULT_SPIDER, gaitMode: params.gaitMode as SpiderGaitMode };

    const nextSpider = advanceSpiderState(
      spiderState,
      state.x + 8, state.y + 8, // body center (offset from top-left)
      state.vx, state.vy,
      state.facing,
      ctx.dt,
      config,
      ctx.tileQuery as TileSolidityQuery,
      ctx.tileSize,
      (state.data.tick as number) + 1,
    );

    return {
      ...state,
      x: state.x, y: state.y,
      vx: state.vx, vy: state.vy,
      facing: state.facing,
      alive: state.alive,
      data: { ...state.data, spiderState: nextSpider, tick: (state.data.tick as number) + 1 },
    };
  },
};

// --- Renderer (renderer-adjacent) ---
function renderSpiderEnemy(ctx: CanvasRenderingContext2D, enemy: CompiledEnemy, tick: number) {
  const spiderState = enemy.state.data.spiderState as SpiderState;
  const config: SpiderConfig = {
    ...DEFAULT_SPIDER,
    palette: {
      cephFill: '#4a2d6b',
      abdFill: '#3d2458',
      legFg: '#5c3d8a',
      legBg: shade('#5c3d8a', 0.6),
      eyeFill: '#ff2222',
      cheliceraeFill: '#2a1a3d',
      palpFill: '#5c3d8a',
      outline: '#1d1128',
    },
  };

  const pose = evaluateSpiderPose(
    spiderState,
    enemy.state.x + 8, enemy.state.y + 8,
    enemy.state.facing,
    tick,
    config,
  );

  drawSpider(ctx, pose, config);
}
```

**Composition map:**

| What | Reused from existing? | What's new? |
|---|---|---|
| Gait coordinator (alternating/frantic) | ❌ New | `advanceSpiderState` — core gait logic |
| Step trigger + parabolic arc | ❌ New | `advanceSpiderState` — comfort-radius + overshoot |
| Ground sampling | ✅ `TileSolidityQuery` from `collision/types.ts`, `worldToTile` from `collision/tiles.ts` | Lazy sampling wrapper |
| Leg IK | ✅ `solveLimb` from `animation/ik/limb.ts` | Called inside `evaluateSpiderPose` |
| Pedipalp physics | ✅ `createSpringRod`, `advanceSpringRod` from `animation/spring-rod.ts` | Inside `advanceSpiderState` + `evaluateSpiderPose` |
| Abdomen breathing | ✅ `breathe` from `animation/squash-stretch.ts` | Inside `evaluateSpiderPose` |
| Volume-preserving scale | ✅ `volumeScale` from `animation/squash-stretch.ts` | Inside `evaluateSpiderPose` |
| Fail-safe leg dangling | ❌ New | Inside `advanceSpiderState` |
| Body jitter | ❌ New | Seeded `mulberry32` jitter in `evaluateSpiderPose` |
| Body drawing | ❌ New | `drawSpider` — vector primitives |
| Eye drawing | ❌ New | Inside `drawSpider` |

**Determinism + layering analysis:**

- **Deterministic core:** `createSpiderState`, `advanceSpiderState` — pure functions taking tick/dt/state/config/tileQuery, returning fresh state. No `Math.random`, no `Date.now()`. TDD-able. Ground sampling is lazy (only when a leg steps). Body jitter uses seeded `mulberry32` from the `jitterSeed` field.
- **Renderer-adjacent:** `evaluateSpiderPose`, `drawSpider` — composes IK solvers + spring-rods + body math. Reads cached state freely. Restores ctx state. No simulation mutation. `Math.sin`/`Math.cos` acceptable (renderer-adjacent visual transforms).
- **Reduced motion:** `config.motionScale` scales gait amplitude, palp twitch, and breathing. Consumer reads `prefersReducedMotion()` and passes `motionScale: reducedMotion ? 0.2 : 1`.

**Trade-offs:**
- **Ergonomics:** ★★★★★ — One import, one create call, one step call, one draw call. The simplest possible consumer API.
- **Determinism:** ★★★★ — Core gait is deterministic and TDD-able. But everything is in one module — no separate gait-solver to test in isolation without the body/IK overhead.
- **Runtime cost:** ★★★ — One module, but evaluateSpiderPose does IK for 8 legs + spring-rod physics + body math every frame. Acceptable for one spider; might matter for swarms.
- **Consumer complexity:** ★★★★★ — Minimal. Spread config, call 3 functions.
- **Future-extendability:** ★★★ — Wall-climbing requires modifying `advanceSpiderState` to accept a sampling-direction strategy. Possible but the monolithic structure makes it a large change. Adding a second creature type (crab) means either duplicating or extracting — YAGNI until then.
- **Convention fit:** ★★★★★ — `createSpiderState`/`advanceSpiderState` follows `createX`/`advanceX`. Config-as-spread with `DEFAULT_SPIDER`. Pure ops, never throws.

**What this makes easy:** A consumer gets a fully procedural spider with 5 lines of setup code. The enemy behavior handler is trivial: call `advanceSpiderState` in `step`, call `evaluateSpiderPose` + `drawSpider` in render.

**What this makes hard:** Testing the gait logic in isolation requires constructing the full SpiderState (legs + palps + jitter seed). No way to test "does the alternating tetrapod coordination work?" without also testing body rendering. The monolithic structure resists extracting the gait solver for reuse by a different creature type.

---

## Approach B: Layered — Pure Gait-Solver + Renderer, with Deterministic Facade (RECOMMENDED, refined hybrid)

**Source pattern:** Mirrors the library's established split between pure deterministic core (`src/animation/locomotion.ts` phase accumulator) and renderer-adjacent composition (`src/animation/ik/` solvers + `src/animation/skin.ts` draw). The gait solver is a standalone deterministic module; the spider renderer composes it with IK + spring-rod + body drawing. A thin deterministic-core facade (`stepSpider`) bundles gait + pedipalp advancement for ergonomic call sites, giving Approach A's simplicity with B's layering — this is the refined hybrid.

**File location:** `src/animation/spider/` (same module directory, but with clear file separation)

```
src/animation/spider/
├── types.ts           # Shared types (SpiderConfig, SpiderPalette, leg types, etc.)
├── gait.ts            # Pure deterministic core: gait coordinator + step trigger + fail-safe
├── ground-sample.ts   # Pure deterministic: lazy ground sampling via TileSolidityQuery
├── spider-state.ts    # Pure deterministic facade: createSpiderState + stepSpider (bundles gait + pedipalp)
├── spider.ts          # Renderer-adjacent: pose evaluation + body/leg drawing
├── constants.ts       # Named constants (DEFAULT_SPIDER, etc.)
└── index.ts           # Barrel export
```

**Signature sketch — `gait.ts` (deterministic core):**

```ts
// In src/animation/spider/gait.ts

import type { Vec2 } from '../types';
import type { TileSolidityQuery } from '../../collision/types';

/**
 * Spider gait mode.
 * 'coordinated' = strict alternating tetrapod (Set A vs Set B, 180° phase offset).
 * 'frantic' = free-stepping with neighbor-lock (step when comfort radius exceeded,
 *   unless an adjacent leg is already swinging).
 */
export type SpiderGaitMode = 'coordinated' | 'frantic';

/**
 * Per-leg state within the gait solver. Pure data, no rendering concerns.
 */
export interface GaitLegState {
  /** Leg identifier (e.g. 'L1', 'R3'). */
  readonly id: string;
  /** Gait set: 'A' or 'B' (for coordinated mode). */
  readonly set: 'A' | 'B';
  /** Current foot world position. */
  readonly footX: number;
  readonly footY: number;
  /** Step animation phase [0, 1]. 0 = planted. */
  readonly stepPhase: number;
  /** Step arc start (world). */
  readonly startX: number;
  readonly startY: number;
  /** Step arc end (world). */
  readonly endX: number;
  readonly endY: number;
  /** Step arc mid (world, lifted). */
  readonly midX: number;
  readonly midY: number;
  /** Whether this leg is in swing phase. */
  readonly isSwinging: boolean;
  /** Index in the legs array (for neighbor lookups). */
  readonly index: number;
}

/**
 * Gait solver state. Carried across ticks.
 */
export interface GaitState {
  /** Per-leg states. Length = legCount * 2. */
  readonly legs: readonly GaitLegState[];
  /** Global gait phase (radians, [0, 2π)). */
  readonly phase: number;
}

/**
 * Gait solver configuration.
 */
export interface GaitConfig {
  /** Gait mode. */
  readonly mode: SpiderGaitMode;
  /** Number of legs per side. */
  readonly legCount: number;
  /** Comfort radius (px) — foot must drift this far from rest before stepping. */
  readonly comfortRadius: number;
  /** Overshoot factor (0-1) — how far ahead of rest to step based on velocity. */
  readonly overshootFactor: number;
  /** Step arc height (px). */
  readonly stepHeight: number;
  /** Step duration (seconds). */
  readonly stepDuration: number;
  /** Phase advance rate for coordinated mode (radians per unit speed per tick). */
  readonly phaseAdvanceRate: number;
}

/**
 * Create initial gait state for N legs per side.
 *
 * Legs are arranged symmetrically. Each leg's rest position is computed
 * from legSpacing. Sets are assigned alternately (L1=A, R1=B, L2=B, R2=A, ...).
 *
 * @param config - gait configuration
 * @param legRestPositions - world-space rest positions for each leg (length = legCount * 2)
 * @returns fresh GaitState
 */
export function createGaitState(
  config: GaitConfig,
  legRestPositions: readonly Vec2[],
): GaitState;

/**
 * Advance the gait solver by one tick. Pure, deterministic, never throws.
 *
 * In 'coordinated' mode: Set A legs step while Set B are planted (180° offset).
 * In 'frantic' mode: each leg steps independently when comfort radius is exceeded,
 *   unless an adjacent leg is already swinging.
 *
 * Step arcs are quadratic Bezier (start → mid → end) sampled by stepPhase.
 *
 * Ground sampling is **lazy**: `sampleGround` is called ONLY for legs whose
 * comfort-radius check triggers a step this tick, never for all legs every tick.
 * For v1, the sampling direction is hard-coded downward `{x:0, y:1}` (floor-only
 * scope). Future wall/ceiling support is a non-breaking config-field strategy
 * (e.g. a `samplingDirection` field on `GaitConfig`), NOT built now.
 *
 * Same `(state, bodyX, bodyY, vx, vy, facing, dt, config, tileQuery, tileSize, tick)`
 * → byte-identical output. No `Math.random`, no `Date.now()`. `TileSolidityQuery`
 * is pure, so determinism holds.
 *
 * @param state - current gait state (fresh copy returned)
 * @param bodyX - body center X
 * @param bodyY - body center Y
 * @param vx - body velocity X (px/s)
 * @param vy - body velocity Y (px/s)
 * @param facing - +1 right, -1 left (needed for per-leg rest positions in world space and overshoot direction)
 * @param dt - fixed timestep
 * @param config - gait configuration
 * @param tileQuery - tile solidity query (pure, no host access — OK in deterministic core)
 * @param tileSize - tile grid cell size in px
 * @param tick - simulation tick
 * @returns fresh GaitState
 */
export function advanceGait(
  state: GaitState,
  bodyX: number,
  bodyY: number,
  vx: number,
  vy: number,
  facing: 1 | -1,
  dt: number,
  config: GaitConfig,
  tileQuery: TileSolidityQuery,
  tileSize: number,
  tick: number,
): GaitState;

/**
 * Get the current foot world position for a leg (sample the step arc).
 *
 * Pure reader. If the leg is planted, returns footX/footY.
 * If swinging, samples the quadratic Bezier arc at stepPhase.
 *
 * @param leg - leg state
 * @returns world-space foot position
 */
export function getGaitFootPosition(leg: GaitLegState): Vec2;

/**
 * Quadratic Bezier sample for parabolic step arc.
 * Pure: same (start, mid, end, t) → same output. Never throws.
 */
export function sampleStepArc(
  start: Vec2,
  mid: Vec2,
  end: Vec2,
  t: number,
): Vec2;
```

**Signature sketch — `ground-sample.ts` (deterministic core):**

```ts
// In src/animation/spider/ground-sample.ts

import type { Vec2 } from '../types';
import type { TileSolidityQuery, TileType } from '../../collision/types';

/**
 * Result of a ground sample query.
 */
export interface GroundSampleResult {
  /** World-space point where solid ground was found. */
  readonly point: Vec2;
  /** Surface normal (pointing away from solid). For floor: {x:0, y:-1}. */
  readonly normal: Vec2;
  /** Whether solid ground was found. */
  readonly hasGround: boolean;
}

/**
 * Sample the nearest solid tile downward from an origin point.
 *
 * Steps through the tile grid in the given direction, checking solidity
 * via the provided TileSolidityQuery. Stops at the first solid tile.
 *
 * Pure, deterministic, no host access. Only called when a leg is about
 * to step (lazy sampling — not every frame for every leg). Never throws.
 *
 * @param originX - world-space X to sample from
 * @param originY - world-space Y to sample from
 * @param directionX - sample direction X (normalized)
 * @param directionY - sample direction Y (normalized)
 * @param maxDistance - maximum sample distance in px
 * @param tileSize - tile grid cell size in px
 * @param tileQuery - tile solidity query
 * @returns ground sample result
 */
export function sampleGround(
  originX: number,
  originY: number,
  directionX: number,
  directionY: number,
  maxDistance: number,
  tileSize: number,
  tileQuery: TileSolidityQuery,
): GroundSampleResult;
```

**Signature sketch — `spider.ts` (renderer-adjacent):**

```ts
// In src/animation/spider/spider.ts

import type { Vec2 } from '../types';
import type { GaitState, GaitConfig } from './gait';
import type { SpiderConfig, SpiderPalette } from './types';

/**
 * Full spider rendering pose. Pre-computed from gait state + body position.
 * Renderer-adjacent: composes IK + spring-rod + body math.
 */
export interface SpiderPose {
  /** Cephalothorax center + radius (world). */
  readonly cephalothorax: { readonly x: number; readonly y: number; readonly radius: number };
  /** Abdomen center + radii (world). */
  readonly abdomen: { readonly x: number; readonly y: number; readonly rx: number; readonly ry: number };
  /** 8 eyes: position + radius. */
  readonly eyes: readonly { readonly x: number; readonly y: number; readonly radius: number }[];
  /** Chelicerae (fang) endpoints. */
  readonly chelicerae: readonly { readonly x: number; readonly y: number; readonly angle: number }[];
  /** Per-leg IK results. */
  readonly legPoses: readonly LegPose[];
  /** Pedipalp node chains. */
  readonly palpChains: readonly (readonly Vec2[])[];
  /** Body outline jitter offsets (per vertex). */
  readonly jitterOffsets: readonly number[];
}

/**
 * Single leg IK result.
 */
export interface LegPose {
  /** Hip/root attachment point (world). */
  readonly rootX: number;
  readonly rootY: number;
  /** Knee joint (world, from solveLimb). */
  readonly jointX: number;
  readonly jointY: number;
  /** Foot end (world). */
  readonly endX: number;
  readonly endY: number;
  /** Whether this is a background leg (drawn darker). */
  readonly isBg: boolean;
}

/**
 * Spider body palette. All hex strings — no magic colors.
 */
export interface SpiderPalette {
  readonly cephFill: string;
  readonly abdFill: string;
  readonly legFg: string;
  readonly legBg: string;
  readonly eyeFill: string;
  readonly cheliceraeFill: string;
  readonly palpFill: string;
  readonly outline: string;
}

/**
 * Spider visual configuration. Subset of SpiderConfig for rendering only.
 * Separate from GaitConfig to keep deterministic core clean.
 */
export interface SpiderVisualConfig {
  /** Cephalothorax radius (px). */
  readonly cephRadius: number;
  /** Abdomen horizontal radius (px). */
  readonly abdRx: number;
  /** Abdomen vertical radius (px). */
  readonly abdRy: number;
  /** Abdomen X offset from ceph (px, facing-relative). */
  readonly abdOffsetX: number;
  /** Breathing frequency (radians/tick). */
  readonly breathFrequency: number;
  /** Breathing amplitude (fractional scale). */
  readonly breathAmplitude: number;
  /** Leg joint visual radius (px). */
  readonly jointRadius: number;
  /** Body outline jitter amplitude (px). */
  readonly bodyJitterAmplitude: number;
  /** Pedipalp segment length (px). */
  readonly palpSegmentLength: number;
  /** Pedipalp stiffness (0-1). */
  readonly palpStiffness: number;
  /** Thigh length (px). */
  readonly thighLength: number;
  /** Shin length (px). */
  readonly shinLength: number;
  /** Body palette. */
  readonly palette: SpiderPalette;
}

/**
 * Pedipalp state (spring-rod nodes). Carried in EnemyState.data.
 */
export interface PedipalpState {
  readonly nodesL: readonly import('../spring').VerletNode[];
  readonly nodesR: readonly import('../spring').VerletNode[];
}

/**
 * Compute the spider's rendering pose from gait state + body position.
 *
 * Evaluates:
 * - Body segments (cephalothorax, abdomen lag + breathing)
 * - Eye positions (8 eyes, varied sizes)
 * - Chelicerae (fang pincers)
 * - Per-leg IK via solveLimb
 * - Pedipalp spring-rod evaluation
 * - Body outline jitter (seeded via mulberry32)
 *
 * Renderer-adjacent: composes IK + spring-rod + body math. No simulation mutation.
 *
 * Body-outline jitter is seeded from `jitterSeed` ALONE (no `tick`) so each
 * spider's outline is stable across frames, not wriggling. The RNG is re-created
 * from the same seed each call → identical offsets → stable outline.
 *
 * @param gaitState - current gait state
 * @param palpState - pedipalp spring-rod state
 * @param bodyX - body center X
 * @param bodyY - body center Y
 * @param facing - +1 right, -1 left
 * @param vx - body velocity X (for abdomen lag)
 * @param vy - body velocity Y
 * @param tick - render tick (for breathing)
 * @param visualConfig - visual configuration
 * @param jitterSeed - per-spider jitter seed
 * @returns pre-computed SpiderPose
 */
export function evaluateSpiderPose(
  gaitState: GaitState,
  palpState: PedipalpState,
  bodyX: number,
  bodyY: number,
  facing: 1 | -1,
  vx: number,
  vy: number,
  tick: number,
  visualConfig: SpiderVisualConfig,
  jitterSeed: number,
): SpiderPose;

/**
 * Draw the spider at the given pose. Renderer-adjacent.
 *
 * Drawing order:
 * 1. Background legs (darker, offset)
 * 2. Abdomen (jittered outline)
 * 3. Cephalothorax (jittered outline)
 * 4. Eyes (high-contrast, varied size)
 * 5. Chelicerae (fang pincers)
 * 6. Foreground legs (full color)
 * 7. Pedipalps (spring-rod polylines)
 *
 * Saves/restores ctx state. No simulation mutation. Never throws.
 *
 * @param ctx - canvas 2D context
 * @param pose - pre-computed spider pose
 * @param visualConfig - visual configuration (palette + sizes)
 */
export function drawSpider(
  ctx: CanvasRenderingContext2D,
  pose: SpiderPose,
  visualConfig: SpiderVisualConfig,
): void;
```

**Signature sketch — combined config for the consumer:**

```ts
// In src/animation/spider/types.ts

import type { SpiderGaitMode, GaitConfig } from './gait';
import type { SpiderVisualConfig, SpiderPalette } from './spider';

/**
 * Combined spider config. Consumers spread DEFAULT_SPIDER and override fields.
 * Internally split into GaitConfig (deterministic core) and SpiderVisualConfig (renderer).
 */
export interface SpiderConfig extends GaitConfig, SpiderVisualConfig {}

/**
 * Default spider config. Sokpop-scale side-view spider.
 */
export const DEFAULT_SPIDER: Readonly<SpiderConfig>;

/**
 * Split a SpiderConfig into GaitConfig + SpiderVisualConfig.
 * Internal helper for the factory functions.
 */
export function splitSpiderConfig(config: SpiderConfig): {
  gait: GaitConfig;
  visual: SpiderVisualConfig;
};
```

**Signature sketch — `spider-state.ts` (deterministic core facade):**

```ts
// In src/animation/spider/spider-state.ts

import type { VerletNode } from '../spring';
import type { TileSolidityQuery } from '../../collision/types';
import type { GaitState } from './gait';
import type { SpiderConfig } from './types';

/**
 * Bundled spider state: gait + pedipalp spring-rod nodes + jitter seed.
 * Deterministic core — no Canvas2D, no renderer imports.
 *
 * This is a convenience facade over `advanceGait` + `advanceSpringRod`.
 * Both primitives remain independently available and TDD-able; the facade
 * exists for ergonomics and does NOT reduce testability.
 */
export interface SpiderState {
  /** Gait solver state (authoritative deterministic-core state, not renderer caching). */
  readonly gait: GaitState;
  /** Left pedipalp spring-rod nodes. */
  readonly palpL: readonly VerletNode[];
  /** Right pedipalp spring-rod nodes. */
  readonly palpR: readonly VerletNode[];
  /** Body jitter seed (for per-spider outline uniqueness via mulberry32). */
  readonly jitterSeed: number;
}

/**
 * Initialise bundled spider state: gait (via createGaitState) + both pedipalp
 * spring-rods (via createSpringRod). Pure, never throws.
 *
 * @param config - combined spider config (internally split into GaitConfig + SpiderVisualConfig)
 * @param jitterSeed - seed for per-spider body jitter
 * @param initialBodyX - initial body center X in world space
 * @param initialBodyY - initial body center Y in world space
 * @returns fresh SpiderState
 */
export function createSpiderState(
  config: SpiderConfig,
  jitterSeed: number,
  initialBodyX: number,
  initialBodyY: number,
): SpiderState;

/**
 * Advance the whole spider one tick: advanceGait + advanceSpringRod (both palps).
 * Pure composition of two deterministic primitives. Pure, deterministic, never throws.
 *
 * `advanceGait` and `advanceSpringRod` remain independently composable and testable;
 * this facade exists for ergonomics at the call site.
 *
 * Same `(state, bodyX, bodyY, vx, vy, facing, dt, config, tileQuery, tileSize, tick)`
 * → byte-identical output.
 *
 * @param state - current spider state (fresh copy returned)
 * @param bodyX - body center X in world space
 * @param bodyY - body center Y in world space
 * @param vx - body horizontal velocity (px/s)
 * @param vy - body vertical velocity (px/s)
 * @param facing - +1 right, -1 left
 * @param dt - fixed timestep
 * @param config - combined spider config
 * @param tileQuery - tile solidity query (pure, no host access)
 * @param tileSize - tile grid cell size in px
 * @param tick - current simulation tick
 * @returns fresh SpiderState
 */
export function stepSpider(
  state: SpiderState,
  bodyX: number, bodyY: number,
  vx: number, vy: number,
  facing: 1 | -1,
  dt: number,
  config: SpiderConfig,
  tileQuery: TileSolidityQuery,
  tileSize: number,
  tick: number,
): SpiderState;
```

**Usage example:**

```ts
import {
  createSpiderState,
  stepSpider,
  evaluateSpiderPose,
  drawSpider,
  DEFAULT_SPIDER,
  splitSpiderConfig,
  type SpiderState,
  type SpiderConfig,
} from 'aicraft-engine/src/animation/spider';
import type { TileSolidityQuery } from 'aicraft-engine/src/collision/types';

// --- Behavior handler (deterministic core) ---
const spiderBehavior: EnemyBehaviorHandler = {
  step(state, ctx, params) {
    const config: SpiderConfig = { ...DEFAULT_SPIDER, gaitMode: params.gaitMode as SpiderGaitMode };
    const prev = state.data.spider as SpiderState;

    const spider = stepSpider(
      prev,
      state.x + 8, state.y + 8,  // body center (offset from top-left)
      state.vx, state.vy,
      state.facing,
      ctx.dt,
      config,
      ctx.tileQuery as TileSolidityQuery,
      ctx.tileSize,
      (state.data.tick as number) + 1,
    );

    return {
      ...state,
      data: { ...state.data, spider, tick: (state.data.tick as number) + 1 },
    };
  },
};

// --- Renderer (renderer-adjacent) ---
function renderSpider(ctx: CanvasRenderingContext2D, enemy: CompiledEnemy, tick: number) {
  const spider = enemy.state.data.spider as SpiderState;
  const config = DEFAULT_SPIDER;
  const { visual } = splitSpiderConfig(config);

  const pose = evaluateSpiderPose(
    spider.gait,
    { nodesL: spider.palpL, nodesR: spider.palpR },
    enemy.state.x + 8, enemy.state.y + 8,
    enemy.state.facing,
    enemy.state.vx, enemy.state.vy,
    tick,
    visual,
    spider.jitterSeed,
  );

  drawSpider(ctx, pose, visual);
}
```

**Composition map:**

| What | Reused from existing? | What's new? |
|---|---|---|
| Gait coordinator (alternating/frantic) | ❌ New (but pure, testable in isolation) | `gait.ts` — `advanceGait` |
| Step trigger + parabolic arc | ❌ New (pure, testable) | `gait.ts` — comfort-radius + overshoot |
| Ground sampling | ✅ `TileSolidityQuery` from `collision/types.ts`, `worldToTile` from `collision/tiles.ts` | `ground-sample.ts` — `sampleGround` |
| Leg IK | ✅ `solveLimb` from `animation/ik/limb.ts` | Called inside `spider.ts` `evaluateSpiderPose` |
| Pedipalp physics | ✅ `createSpringRod`, `advanceSpringRod` | Bundled by `spider-state.ts` `stepSpider` (facade); also independently composable |
| Abdomen breathing | ✅ `breathe` from `animation/squash-stretch.ts` | Inside `spider.ts` |
| Volume-preserving scale | ✅ `volumeScale` from `animation/squash-stretch.ts` | Inside `spider.ts` |
| Fail-safe leg dangling | ❌ New (pure, in `gait.ts`) | Inside `advanceGait` |
| Body jitter | ❌ New | Seeded `mulberry32` in `spider.ts` |
| Body + leg drawing | ❌ New | `drawSpider` in `spider.ts` |
| Deterministic facade | ❌ New (pure, ergonomic wrapper) | `spider-state.ts` — `createSpiderState`, `stepSpider` |

**Determinism + layering analysis:**

- **Deterministic core (`gait.ts`, `ground-sample.ts`, `spider-state.ts`):** `createGaitState`, `advanceGait`, `getGaitFootPosition`, `sampleStepArc`, `sampleGround`, `createSpiderState`, `stepSpider` — all pure functions. Same inputs → byte-identical output. No `Math.random`, no `Date.now()`. TDD-able in complete isolation (no Canvas2D, no IK, no spring-rod). `GaitState` is authoritative deterministic-core state (persisted across ticks, input to next `advanceGait`), NOT renderer-caching. Ground sampling is lazy (only when a leg triggers a step). The `stepSpider` facade is pure composition of `advanceGait` + `advanceSpringRod`; both remain independently testable.
- **Renderer-adjacent (`spider.ts`):** `evaluateSpiderPose`, `drawSpider` — composes IK solvers + spring-rods + body math. Reads cached gait state freely. Restores ctx state. No simulation mutation. `Math.sin`/`Math.cos` acceptable (visual transforms).
- **Behavior handler (consumer-owned):** Uses the `stepSpider` facade (deterministic) in the step function. Calls `evaluateSpiderPose` + `drawSpider` in render. Clear separation. Alternatively, the consumer can compose `advanceGait` + `advanceSpringRod` directly for full control — both patterns are supported.
- **Reduced motion:** `config.motionScale` (or consumer applies `scaledGait` equivalent to gait config) scales amplitudes. Consumer reads `prefersReducedMotion()` and passes scaled config.

**Trade-offs:**
- **Ergonomics:** ★★★★★ — The `stepSpider` facade gives Approach A-level simplicity (one call in the step handler) while preserving the layered architecture. The consumer can also drop down to `advanceGait` + `advanceSpringRod` directly for full control.
- **Determinism:** ★★★★★ — Gait solver is a standalone deterministic module with zero rendering imports. Perfectly TDD-able. Can be tested with mock tile queries. Ground sampling is isolated.
- **Runtime cost:** ★★★★ — Same per-frame work as A, but the clear separation allows future optimization (e.g., skip IK for off-screen spiders, batch ground samples).
- **Consumer complexity:** ★★★★★ — The facade gives one-call simplicity; the layered split keeps the code readable and debuggable.
- **Future-extendability:** ★★★★★ — Wall-climbing: add a `samplingDirection` strategy to `sampleGround` (non-breaking config addition). Second creature type (crab): reuse `gait.ts` + `ground-sample.ts` directly with a different visual config. No duplication.
- **Convention fit:** ★★★★★ — Matches the library's established split: pure core (`locomotion.ts`) vs renderer-adjacent composition (`ik/` + `skin.ts`). `createGaitState`/`advanceGait` follows `createX`/`advanceX`. Config-as-spread. Pure ops, never throws.

**What this makes easy:** The gait solver can be unit-tested in complete isolation — no Canvas2D, no IK, no spring-rod. A test can construct a GaitState with mock leg positions, advance it with a mock tile query, and verify: "Set A legs swing while Set B are planted" or "frantic mode steps immediately when comfort radius is exceeded." The `stepSpider` facade gives consumers a one-call step handler, while the underlying primitives remain independently composable. The spider renderer is a clean composition of existing primitives.

**What this makes hard:** The two-file split means the consumer needs to understand both `GaitConfig` and `SpiderVisualConfig`. However, the `SpiderConfig` union type + `splitSpiderConfig` helper + the `stepSpider` facade mitigate this — most consumers only touch `SpiderConfig`.

---

## Approach C: Generic Multi-Legged Creature Primitive + Spider Preset

**Source pattern:** The elastic-rod / spring-rod history in this codebase: the library deferred generalisation until a second consumer materialised. Approach C inverts this — it generalises preemptively, creating a `LegSystem` primitive reusable for crabs/insects/centipedes, with the spider as one config preset.

**File location:** `src/animation/multi-leg/`

```
src/animation/multi-leg/
├── types.ts           # Generic types (LegConfig, GaitConfig, CreaturePreset)
├── leg-system.ts      # Generic N-leg gait solver + step trigger + ground sample
├── leg-renderer.ts    # Generic leg drawing (2-bone IK, foreground/background)
├── presets/
│   ├── spider.ts      # Spider preset (8 legs, alternating tetrapod)
│   ├── crab.ts        # Crab preset (6 legs, different gait)
│   └── centipede.ts   # Centipede preset (12+ legs, wave gait)
├── constants.ts       # DEFAULT_SPIDER, DEFAULT_CRAB, etc.
└── index.ts           # Barrel export
```

**Signature sketch (abbreviated — same structure as B but generic):**

```ts
// In src/animation/multi-leg/types.ts

/**
 * Leg arrangement: how legs are positioned relative to the body.
 */
export type LegArrangement = 'bilateral' | 'radial' | 'asymmetric';

/**
 * Generic leg configuration.
 */
export interface LegConfig {
  /** Thigh length (px). */
  readonly thighLength: number;
  /** Shin length (px). */
  readonly shinLength: number;
  /** Rest position local to the body attachment point. */
  readonly restLocalX: number;
  readonly restLocalY: number;
  /** Comfort radius (px). */
  readonly comfortRadius: number;
}

/**
 * Generic creature gait configuration.
 */
export interface CreatureGaitConfig {
  /** Gait mode (creature-specific string). */
  readonly mode: string;
  /** Phase advance rate. */
  readonly phaseAdvanceRate: number;
  /** Step duration (seconds). */
  readonly stepDuration: number;
  /** Step height (px). */
  readonly stepHeight: number;
  /** Overshoot factor. */
  readonly overshootFactor: number;
}

/**
 * Generic multi-leg creature state.
 */
export interface LegSystemState {
  readonly legs: readonly LegState[];
  readonly phase: number;
}

/**
 * Generic leg state.
 */
export interface LegState {
  readonly id: string;
  readonly group: number;
  readonly footX: number;
  readonly footY: number;
  readonly stepPhase: number;
  readonly isSwinging: boolean;
  // ... (same fields as GaitLegState in Approach B)
}

/**
 * Spider preset: maps the generic LegSystem to spider-specific values.
 */
export const SPIDER_PRESET: Readonly<{
  legCount: number;
  arrangement: LegArrangement;
  legs: readonly LegConfig[];
  gait: CreatureGaitConfig;
  // ... body config, palette, etc.
}>;
```

**Usage example:**

```ts
import {
  createLegSystem,
  advanceLegSystem,
  evaluateLegPoses,
  drawLegs,
  SPIDER_PRESET,
} from 'aicraft-engine/src/animation/multi-leg';
import { SPIDER_PRESET } from 'aicraft-engine/src/animation/multi-leg/presets/spider';

// Consumer uses the generic API with the spider preset
const legState = createLegSystem(SPIDER_PRESET, bodyX, bodyY);
const nextLegState = advanceLegSystem(legState, bodyX, bodyY, vx, vy, dt, tick);
const legPoses = evaluateLegPoses(nextLegState, bodyX, bodyY, facing, config);
drawLegs(ctx, legPoses, config);
```

**Trade-offs:**
- **Ergonomics:** ★★★ — The generic API requires understanding the abstraction layer. Consumer must know about `LegConfig`, `CreatureGaitConfig`, `LegArrangement`. More cognitive load than A or B.
- **Determinism:** ★★★★★ — Same as B (gait solver is pure and testable).
- **Runtime cost:** ★★★★ — Same work, but the generic indirection adds minor overhead (array lookups, group assignments).
- **Consumer complexity:** ★★★ — More concepts to learn. The preset helps, but the generic surface is wider.
- **Future-extendability:** ★★★★★ — Adding a crab or centipede is just a new preset file. No code duplication.
- **Convention fit:** ★★★ — Breaks the "defer generalisation until a second consumer" precedent. The elastic-rod history shows this library waits for a second use case before generalising. Premature generalisation adds surface area without proven demand.

**What this makes easy:** Adding a new creature type (crab, centipede, insect) is a config-only change. The gait solver handles any leg count and arrangement.

**What this makes hard:** The abstraction is harder to understand than B's concrete spider. The generic `LegSystemState` carries fields that are irrelevant for some creatures (e.g. `group` for radial arrangements). The preset system adds an extra indirection layer. Most critically: no second consumer exists yet, so this generalisation is speculative.

---

## Comparison Table

| Criterion | A: Monolithic | B: Layered (Gait + Renderer) | C: Generic Multi-Leg |
|---|---|---|---|
| **Ergonomics** | ★★★★★ (simplest) | ★★★★★ (facade matches A, primitives still available) | ★★★ (generic abstraction) |
| **Determinism clarity** | ★★★★ (all in one) | ★★★★★ (gait is standalone) | ★★★★★ (gait is standalone) |
| **Testability** | ★★★ (gait not isolated) | ★★★★★ (gait TDD-able alone) | ★★★★★ (gait TDD-able alone) |
| **Reuse** | ★★ (spider-specific) | ★★★★ (gait reusable by crab) | ★★★★★ (everything generic) |
| **Consumer complexity** | ★★★★★ (minimal) | ★★★★★ (facade = one call; drop-down available) | ★★★ (generic concepts) |
| **Future-extendability** | ★★★ (wall-climbing = refactor) | ★★★★★ (config extension) | ★★★★★ (preset system) |
| **Convention fit** | ★★★★★ (simple module) | ★★★★★ (matches library split) | ★★★ (premature generalisation) |
| **Risk** | Low | Low | Medium (over-engineering) |

---

## Recommendation

**Approach B: Layered — Pure Gait-Solver + Renderer, with Deterministic Facade (refined hybrid).**

This is the right level of abstraction for the library right now. Here's why:

1. **Matches the library's established pattern.** The animation pillar already splits pure deterministic core (`locomotion.ts` phase accumulator, `foot-lock.ts` state progression) from renderer-adjacent composition (`ik/` solvers, `skin.ts` draw). Approach B extends this pattern naturally: `gait.ts` is the pure core, `spider.ts` is the renderer-adjacent composition.

2. **Testability is non-negotiable.** The gait coordinator (alternating tetrapod vs frantic free-stepping) is genuinely new deterministic logic with subtle coordination rules. It MUST be testable in isolation — no Canvas2D, no IK, no spring-rod. Approach A lumps it all together, making isolated testing impossible. Approach B gives us a clean `advanceGait` function that can be TDD'd with mock tile queries.

3. **Defers generalisation correctly.** The library's convention (elastic-rod precedent) is to wait for a second consumer before generalising. No crab or centipede exists yet. Approach B's `gait.ts` IS reusable — a crab preset could call `advanceGait` with different `LegConfig` arrays — but we don't build the generic abstraction layer until we have a second creature to prove it. Approach C inverts this risk.

4. **Future-extendability is clean.** Wall-climbing for v2: add a `samplingDirection` config field to `sampleGround` (non-breaking addition to `GaitConfig`). The sampling direction defaults to `{x:0, y:1}` (downward) for v1, but the consumer can pass `{x:1, y:0}` (rightward) for wall-climbing later. No structural changes needed.

5. **Consumer complexity is manageable.** The `stepSpider` facade bundles gait + pedipalp advancement into a single call, matching Approach A's ergonomics. But the underlying `advanceGait` and `advanceSpringRod` remain independently available for consumers who want full control. The `SpiderConfig` union type + `splitSpiderConfig` helper keep the configuration ergonomic.

---

## What the Recommendation Ships

### New files (all in `src/animation/spider/`):

| File | Purpose | Layer |
|---|---|---|
| `types.ts` | `SpiderConfig`, `SpiderPalette`, `SpiderGaitMode`, `SpiderPose`, `LegPose`, `PedipalpState`, `splitSpiderConfig` | Shared types |
| `gait.ts` | `GaitState`, `GaitLegState`, `GaitConfig`, `createGaitState`, `advanceGait`, `getGaitFootPosition`, `sampleStepArc` | Deterministic core |
| `ground-sample.ts` | `GroundSampleResult`, `sampleGround` | Deterministic core |
| `spider-state.ts` | `SpiderState`, `createSpiderState`, `stepSpider` — deterministic facade bundling gait + pedipalp advancement | Deterministic core (facade) |
| `spider.ts` | `SpiderVisualConfig`, `evaluateSpiderPose`, `drawSpider` | Renderer-adjacent |
| `constants.ts` | `DEFAULT_SPIDER`, `DEFAULT_SPIDER_PALETTE` | Constants |
| `index.ts` | Barrel re-export | Barrel |

### New exports added to `docs/api-surface.md`:

All exports listed above, clearly marked as **PROPOSED (not shipped)**.

### Modified files:

- `src/animation/index.ts` — add `export * from './spider'`
- `src/index.ts` — re-exports via animation barrel (no change needed)
- `src/platformer/enemy/registry.ts` — Register a `'spider'` behavior handler alongside the existing `'spinny'`/`'turret'` handlers. The enemy-archetype system uses a free-string `archetype` field + a behavior-handler registry — there is NO closed `EnemyArchetype` union to expand (see `docs/design/platformer-enemy-archetypes-decision.md`). The spider renderer itself lives in `src/animation/spider/` and is imported by the handler — the renderer is decoupled from movement AI (body x/y/vx/vy are inputs).

### Tests:

- `src/tests/spider-gait.test.ts` — gait coordination (coordinated + frantic modes), step trigger, comfort radius, fail-safe dangling
- `src/tests/spider-ground-sample.test.ts` — ground sampling with mock tile queries
- `src/tests/spider-state.test.ts` — facade: createSpiderState + stepSpider composition, pedipalp advancement, deterministic output
- `src/tests/spider-spider.test.ts` — pose evaluation, body segment positions, IK leg solving
- `src/tests/spider-draw.test.ts` — smoke test (draw doesn't throw, restores ctx state)

---

## Open Questions for @architect — RULINGS

> Rulings below are from the orchestrator's critique pass (the `@architect` subagent was unavailable this session).

1. **Should `gait.ts` be a standalone top-level module (`src/animation/gait.ts`) instead of a spider sub-module?**
   **DECIDED → `src/animation/spider/gait.ts` (spider sub-module).** The elastic-rod precedent ("defer generalisation until a 2nd consumer") is decisive: no crab/insect/centipede consumer exists yet, and `locomotion.ts` already owns the biped gait space. Promote to `src/animation/gait.ts` later as a non-breaking move/re-export IF a second multi-legged creature materialises.

2. **Does the leg state belong in the deterministic core or is it renderer-adjacent caching?**
   **DECIDED → `GaitState` is authoritative deterministic-core state, NOT renderer-caching.** It is persisted across ticks (in `EnemyState.data`) and is the input to the next `advanceGait`; the next state depends only on (prev state + inputs). This is unlike `Rig.worldTransforms`, which is a DERIVED cache recomputed from `localPoses` each frame and never authoritative. Therefore: full pure-clone progression + TDD apply to `advanceGait`; the renderer READS `GaitState` but never writes it.

3. **Should the behavior handler drive pedipalp spring-rods, or should `advanceSpiderState` absorb them?**
   **DECIDED → hybrid: add the thin deterministic-core facade `createSpiderState`/`stepSpider` (see `spider-state.ts` above) that bundles gait + palp advancement.** This matches the library's pattern (consumer composes primitives — cf. `showcase/helpers/slime-knight.ts` antennae) WHILE giving Approach A's ergonomics. The pure `advanceGait` and `advanceSpringRod` remain independently composable and testable.

4. **Is the two-config split (`GaitConfig` + `SpiderVisualConfig`) worth the ergonomic cost?**
   **DECIDED → keep `GaitConfig` + `SpiderVisualConfig` as internal concerns.** The facade (`stepSpider`) takes the combined `SpiderConfig` and splits via `splitSpiderConfig`. Consumers mostly touch only `SpiderConfig`. The split keeps `gait.ts` free of palette/eye-radius fields (good layer hygiene for the deterministic core).
