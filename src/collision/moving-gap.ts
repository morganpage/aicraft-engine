/**
 * Moving-gap-on-platform primitive — a traveling absence of floor.
 *
 * Splits a platform span into 0–2 solid {@link Solid} fragments around a gap
 * (hole) whose center may move along the span. A body standing on the platform
 * falls through when the gap reaches it — the kill is by **consequence**
 * (pit-fall), not by overlap hitbox.
 *
 * ## Architecture: motion and geometry are separated
 *
 * The bug this module exists to prevent (the reference `movingVoid` handler,
 * GDD §6.13) coupled gap motion and gap geometry in one handler, producing
 * fragments from a raw, unclamped `gapCenterX`. In `chase` mode the center
 * followed the player past the span edge, so the rendered void extended over
 * a still-colliding static platform — the player appeared to stand on the void.
 *
 * The fix is structural: the **clamp** (which keeps the gap inside the span)
 * lives in the geometry half ({@link gapSolids}), not the motion half
 * ({@link advanceGapMotion}). No caller — whether using the motion machine,
 * hand-driving `centerX`, or writing a custom motion mode — can produce
 * fragments that escape the span. The "void is never standable" invariant is
 * true by construction.
 *
 * ## Determinism contract
 *
 * Same `(state, dt, config, targetX?)` → byte-identical returned state, forever.
 * No `Math.random`, no `Date.now`, no DOM reads, no global mutable state. The
 * caller MUST use a fixed `dt` for trajectory determinism (variable `dt` causes
 * integration drift — caller's responsibility). Mirrors `src/animation/jump.ts`.
 *
 * @module
 *
 * @see docs/design/moving-gap-decision.md — the locked spec + orchestrator rulings.
 * @see docs/design/moving-gap-proposal.md — full design rationale + clamp algorithm.
 */

import type { Solid, TileSolidityQuery } from './types';

// ---------------------------------------------------------------------------
// Named constants (no magic numbers — every tunable is a named export)
// ---------------------------------------------------------------------------

/**
 * Default gap width in pixels. Matches GDD §6.13 (`movingVoid`).
 * Consumers override per-instance via `GapMotionConfig.gapWidth`.
 */
export const DEFAULT_GAP_WIDTH = 64;

/**
 * Default movement speed in px/tick. Matches GDD §6.13.
 *
 * **Tunneling note:** the library does not own `dt` and is not a physics
 * enforcer. The consumer should keep per-tick gap movement (`speed * dt`)
 * below the player's body width so the gap cannot jump past the player in a
 * single tick (mirrors `tiles.ts` / `jump.ts` documentation-only discipline).
 */
export const DEFAULT_GAP_SPEED = 2;

/**
 * Default give-up radius for chase mode in pixels (~3× the default gap width:
 * 64 × 3 ≈ 200). Chase disengages cleanly when the player escapes beyond the
 * gap's reach, mirroring a chase-disengage feel.
 */
export const DEFAULT_CHASE_GIVE_UP_RADIUS = 200;

/** Default expand grow-cycle length in ticks. */
const DEFAULT_EXPAND_TICKS = 60;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Configuration for the platform span that owns the gap. Immutable after
 * creation. All fragments produced by {@link gapSolids} inherit `passthrough`
 * from this span, so a one-way platform with a moving gap works identically to
 * a fully-solid platform with a moving gap.
 */
export interface GapSpanConfig {
  /** World X of the span's top-left corner. */
  readonly x: number;
  /** World Y of the span's top-left corner (the platform surface). */
  readonly y: number;
  /** Span width in world units. */
  readonly width: number;
  /** Span height in world units (platform thickness). */
  readonly height: number;
  /** Inherited by fragments. Default: `false` / unset (fully solid). */
  readonly passthrough?: boolean;
}

/**
 * Geometric snapshot of where the gap is right now. Named `GapGeometry` (not
 * `GapState`) to avoid confusion with {@link GapMotionState}.
 *
 * `centerX` is the world-space center of the gap; `width` is the full gap
 * width. Both are world-space pixels.
 */
export interface GapGeometry {
  /** World-space center X of the gap (pixels). */
  readonly centerX: number;
  /** Full width of the gap in world units. */
  readonly width: number;
}

/** How the gap center moves. See {@link GapMotionConfig}. */
export type GapTravelMode = 'sweep' | 'chase' | 'expand';

/** Sweep-only: how the gap behaves at the path endpoints. */
export type GapLoopMode = 'loop' | 'pingpong';

/**
 * Motion parameters. Mode-specific fields are OPTIONAL with documented defaults
 * — chase/expand consumers need not supply sweep-only fields and vice versa.
 *
 * **Ruling 5:** `initialCenterX` is optional. When omitted, the default derives
 * per mode: sweep starts at `path[0].x`; chase/expand start at `0` (the config
 * deliberately carries no span reference — the motion layer is span-agnostic).
 * Chase/expand consumers typically pass `initialCenterX: span.x + span.width/2`
 * to center the gap on the span.
 *
 * **Ruling 6:** `path` is a Vec2 polyline. The arc-length parametrization uses
 * both components; only `.x` feeds `centerX` today. This future-proofs for 2D
 * gap motion without a v2 breaking change. v1 consumers pass horizontal paths.
 */
export interface GapMotionConfig {
  /** How the gap center moves. */
  readonly travelMode: GapTravelMode;
  /**
   * Movement speed in px/tick. Along the path (sweep) or toward the target
   * (chase). Ignored for expand (width-driven, not position-driven).
   */
  readonly speed: number;
  /** Full width of the gap. The constant width for sweep/chase. */
  readonly gapWidth: number;
  /**
   * Polyline (Vec2) of gap-center positions. Sweep only; ignored for other
   * modes. Defaults to `[]`. See the ruling-6 note on {@link GapMotionConfig}.
   */
  readonly path?: readonly { readonly x: number; readonly y: number }[];
  /** Sweep only: wrap vs reflect at endpoints. Defaults to `'loop'`. */
  readonly loopMode?: GapLoopMode;
  /** Chase only: disengage once the target is past this radius. Defaults to 200. */
  readonly giveUpRadius?: number;
  /** Expand only: width starts here each cycle. Defaults to `0`. */
  readonly minWidth?: number;
  /** Expand only: width grows toward here. Defaults to `gapWidth`. */
  readonly maxWidth?: number;
  /** Expand only: ticks for one grow cycle. Defaults to 60. */
  readonly expandTicks?: number;
  /**
   * Optional initial center X for `createGapMotion`. Removes the
   * `{ ...createGapMotion(cfg), centerX: X }` override dance. See ruling 5.
   */
  readonly initialCenterX?: number;
}

/**
 * Plain-data motion state. The consumer owns it; `advanceGapMotion` returns a
 * new copy (pure-progression-ops discipline — the input is never mutated).
 */
export interface GapMotionState {
  /** Current world-space center X of the gap. */
  readonly centerX: number;
  /** Current gap width (constant for sweep/chase; varies for expand). */
  readonly width: number;
  /** Cumulative signed distance along the path polyline (sweep). */
  readonly dist: number;
  /** +1 forward / -1 backward (sweep pingpong direction). */
  readonly dir: number;
  /** Expand only: elapsed ticks in the current grow cycle. */
  readonly expandElapsed: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function clamp(v: number, min: number, max: number): number {
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

function segLen(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function polylineLength(path: readonly { x: number; y: number }[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += segLen(path[i - 1], path[i]);
  return total;
}

/** Walk the polyline to find the point at signed distance `dist`. */
function polylinePointAt(
  path: readonly { x: number; y: number }[],
  dist: number,
): { x: number; y: number } {
  let remaining = dist;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const len = segLen(a, b);
    if (len === 0) continue;
    if (remaining <= len) {
      const t = remaining / len;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    remaining -= len;
  }
  const last = path[path.length - 1];
  return { x: last.x, y: last.y };
}

// ---------------------------------------------------------------------------
// gapSolids — the invariant anchor (four-guard clamp)
// ---------------------------------------------------------------------------

/**
 * Pure geometry: split a span into 0–2 {@link Solid} fragments around a gap.
 *
 * The four-guard clamp makes the "void is never standable" invariant true by
 * construction — no caller can produce fragments that escape the span:
 *
 * 1. **NaN rejection** — throws (programmer error; matches `parseHex` discipline).
 *    NaN coordinates would propagate into fragment rects, producing nonsensical
 *    geometry that silently corrupts the resolver.
 * 2. **`gap.width ≤ 0`** — returns exactly 1 fragment equal to the full span
 *    (no gap). Fragments inherit the span's `passthrough` flag.
 * 3. **`gap.width ≥ span.width`** — returns `[]` (the span is fully voided).
 *    This guard runs BEFORE the clamp math because the naive `minCenter`/`
 *    maxCenter` formula inverts when `gapWidth ≥ span.width`.
 * 4. **Normal case** — clamp the center into `[span.x + half, span.x + span.width - half]`,
 *    then emit a left fragment (if it has positive width) and a right fragment
 *    (if it has positive width). Produces 0, 1, or 2 fragments.
 *
 * Every possible input — including pathological values like `gapWidth = Infinity`,
 * `centerX = -9999`, `gapWidth = span.width` exactly — maps to a correct
 * fragment set. The invariant is not something the caller must verify; it is a
 * property of the algorithm itself.
 *
 * @example
 * ```ts
 * const span = { x: 100, y: 200, width: 400, height: 16 };
 * const fragments = gapSolids(span, { centerX: 250, width: 64 });
 * const allSolids = [...staticPlatforms, ...fragments];
 * const r = resolveAxisY(player, player.vy, allSolids, prevBottom);
 * ```
 *
 * @param span - The owning platform span. Fragments inherit `passthrough`.
 * @param gap  - Where the gap is right now (world-space center + width).
 * @returns 0, 1, or 2 `Solid` fragments. Never mutates inputs.
 * @throws If `gap.centerX` or `gap.width` is `NaN` (programmer error).
 */
export function gapSolids(span: GapSpanConfig, gap: GapGeometry): Solid[] {
  // GUARD 1: NaN rejection — programmer error, matches parseHex discipline.
  // NaN would propagate into fragment rects, silently corrupting the resolver.
  if (Number.isNaN(gap.centerX) || Number.isNaN(gap.width)) {
    throw new Error('gapSolids: gap.centerX and gap.width must be finite numbers (got NaN)');
  }
  // GUARD 2: Non-positive gap width → no gap → entire span is one solid fragment.
  if (gap.width <= 0) {
    return [
      {
        x: span.x,
        y: span.y,
        width: span.width,
        height: span.height,
        passthrough: span.passthrough,
      },
    ];
  }
  // GUARD 3: Gap wider than or equal to span → fully voided → 0 fragments.
  // Must run BEFORE the clamp: the min/max center formula inverts when
  // gapWidth >= span.width, which would produce a spurious fragment.
  if (gap.width >= span.width) {
    return [];
  }
  // GUARD 4: Normal case — gap fits within the span. Clamp the center, then
  // emit left/right fragments only if they have positive width.
  const half = gap.width / 2;
  const minCenter = span.x + half;
  const maxCenter = span.x + span.width - half;
  const clampedCenter = clamp(gap.centerX, minCenter, maxCenter);
  const gapLeft = clampedCenter - half;
  const gapRight = clampedCenter + half;
  const spanRight = span.x + span.width;

  const fragments: Solid[] = [];
  if (gapLeft > span.x) {
    fragments.push({
      x: span.x,
      y: span.y,
      width: gapLeft - span.x,
      height: span.height,
      passthrough: span.passthrough,
    });
  }
  if (spanRight > gapRight) {
    fragments.push({
      x: gapRight,
      y: span.y,
      width: spanRight - gapRight,
      height: span.height,
      passthrough: span.passthrough,
    });
  }
  return fragments;
}

// ---------------------------------------------------------------------------
// Motion state machine
// ---------------------------------------------------------------------------

/**
 * Initialize motion state from a config.
 *
 * Per-mode defaults (ruling 5):
 * - **sweep:** `centerX = initialCenterX ?? path[0].x` (or `0` if path is empty).
 * - **chase / expand:** `centerX = initialCenterX ?? 0`. Pass `initialCenterX`
 *   to position the gap (typically `span.x + span.width / 2`).
 *
 * `width` is `gapWidth` for sweep/chase, `minWidth` (default `0`) for expand.
 *
 * Pure: returns a fresh {@link GapMotionState}; never throws.
 *
 * @param config - Motion parameters.
 * @returns The initial state, ready for `advanceGapMotion`.
 */
export function createGapMotion(config: GapMotionConfig): GapMotionState {
  const path = config.path ?? [];
  const defaultCenterX = path.length > 0 ? path[0].x : 0;
  const centerX = config.initialCenterX ?? defaultCenterX;
  const width =
    config.travelMode === 'expand' ? (config.minWidth ?? 0) : config.gapWidth;
  return { centerX, width, dist: 0, dir: 1, expandElapsed: 0 };
}

/**
 * Pure: advance the gap motion state by `dt` ticks.
 *
 * Returns a brand-new {@link GapMotionState}; never mutates `state`. Does NOT
 * clamp — the clamp lives inside {@link gapSolids}. The motion machine may
 * produce a `centerX` outside the span; `gapSolids` clamps it before generating
 * fragments.
 *
 * Modes:
 * - **`'sweep'`**: advance `dist` by `speed * dt * dir` along the `path`
 *   polyline and resolve `centerX` from the polyline position. `'loop'` wraps
 *   `dist` into `[0, totalLen)`; `'pingpong'` reflects at endpoints and flips
 *   `dir`. Degenerate path (<2 points or zero total length) → state unchanged.
 * - **`'chase'`**: move `centerX` toward `targetX` by at most `speed * dt`. If
 *   `targetX` is `undefined` OR `|targetX - centerX| > giveUpRadius`, the gap
 *   holds its position (disengages). Missing `targetX` is a silent no-op (not a
 *   throw) — chase consumers supply a target each tick; `undefined` reads as
 *   "no chase this tick."
 * - **`'expand'`**: `width` grows linearly from `minWidth` to `maxWidth` over
 *   `expandTicks`, then resets to `minWidth` and the cycle repeats. `centerX`
 *   is preserved (the expand gap sits still while growing/shrinking).
 *
 * **Determinism contract:** same `(state, dt, config, targetX?)` →
 * byte-identical returned state, forever. No `Math.random`, no `Date.now`, no
 * DOM reads, no global mutable state.
 *
 * @param state   - Current motion state.
 * @param dt      - Fixed timestep (ticks). Caller MUST keep constant.
 * @param config  - Motion parameters.
 * @param targetX - Chase target (world X). `undefined` → chase no-op.
 * @returns The next {@link GapMotionState}.
 */
export function advanceGapMotion(
  state: GapMotionState,
  dt: number,
  config: GapMotionConfig,
  targetX?: number,
): GapMotionState {
  switch (config.travelMode) {
    case 'sweep':
      return advanceSweep(state, dt, config);
    case 'chase':
      return advanceChase(state, dt, config, targetX);
    case 'expand':
      return advanceExpand(state, dt, config);
  }
}

function advanceSweep(
  state: GapMotionState,
  dt: number,
  config: GapMotionConfig,
): GapMotionState {
  const path = config.path ?? [];
  if (path.length < 2) return state;
  const totalLen = polylineLength(path);
  if (totalLen === 0) return state;

  const loopMode = config.loopMode ?? 'loop';
  let dist = state.dist + config.speed * dt * state.dir;
  let dir = state.dir;

  if (loopMode === 'loop') {
    // Wrap into [0, totalLen). The double-modulo handles negative dist.
    dist = ((dist % totalLen) + totalLen) % totalLen;
  } else {
    // pingpong: reflect at both endpoints, flipping dir each bounce.
    // Loop guards (not `if`) so multiple reflections in a single huge step
    // resolve correctly.
    while (dist > totalLen) {
      dist = 2 * totalLen - dist;
      dir = -dir;
    }
    while (dist < 0) {
      dist = -dist;
      dir = -dir;
    }
  }

  const pt = polylinePointAt(path, dist);
  return { ...state, dist, dir, centerX: pt.x };
}

function advanceChase(
  state: GapMotionState,
  dt: number,
  config: GapMotionConfig,
  targetX: number | undefined,
): GapMotionState {
  if (targetX === undefined) return state;
  const giveUp = config.giveUpRadius ?? DEFAULT_CHASE_GIVE_UP_RADIUS;
  const dx = targetX - state.centerX;
  if (Math.abs(dx) > giveUp) return state;
  const maxStep = config.speed * dt;
  const step = Math.sign(dx) * Math.min(Math.abs(dx), maxStep);
  if (step === 0) return state;
  return { ...state, centerX: state.centerX + step };
}

function advanceExpand(
  state: GapMotionState,
  dt: number,
  config: GapMotionConfig,
): GapMotionState {
  const minW = config.minWidth ?? 0;
  const maxW = config.maxWidth ?? config.gapWidth;
  const ticks = config.expandTicks ?? DEFAULT_EXPAND_TICKS;
  if (ticks <= 0) return state;

  const elapsed = state.expandElapsed + dt;
  if (elapsed >= ticks) {
    return { ...state, expandElapsed: 0, width: minW };
  }
  const t = elapsed / ticks;
  const width = minW + (maxW - minW) * t;
  return { ...state, expandElapsed: elapsed, width };
}

// ---------------------------------------------------------------------------
// gapTileQuery — tile-grid wrapper (Approach C)
// ---------------------------------------------------------------------------

/**
 * Wrap a {@link TileSolidityQuery} so tiles inside the clamped gap report
 * `'empty'`. The clamp is internal — the gap never escapes the span.
 *
 * **Ruling 3:** v1 is single-row only — only tiles whose Y range overlaps the
 * span's single row are affected. Multi-row is a v2 extension.
 *
 * **Ruling 4 (membership test):** uses strict AABB overlap
 * (`tileWorldLeft < gapRight && tileWorldLeft + tileSize > gapLeft`), NOT the
 * proposal's left-edge test. The left-edge test misses tiles straddling
 * `gapLeft` (a tile whose left edge is left of the gap but whose body overlaps
 * it). AABB overlap is the same semantics as {@link aabbOverlap}.
 *
 * The clamped gap bounds are computed ONCE per `gapTileQuery` call (in the
 * closure setup), not per-tile. Each per-tile invocation is O(1): two
 * comparisons then defer to `base`.
 *
 * @example
 * ```ts
 * const wrapped = gapTileQuery(baseQuery, span, gap, 16);
 * const r = resolveTileY(player, player.vy, wrapped, 16, prevBottom);
 * ```
 *
 * @param base     - The underlying tile solidity query (wrapped).
 * @param span     - The owning platform span (world coords).
 * @param gap      - Where the gap is right now (world-space center + width).
 * @param tileSize - Pixel size of each (square) tile.
 * @returns A `TileSolidityQuery` that reports `'empty'` inside the clamped gap.
 * @throws If `gap.centerX` or `gap.width` is `NaN` (eager, at wrap time).
 */
export function gapTileQuery(
  base: TileSolidityQuery,
  span: GapSpanConfig,
  gap: GapGeometry,
  tileSize: number,
): TileSolidityQuery {
  // GUARD 1: eager NaN rejection (no per-tile throw surprises).
  if (Number.isNaN(gap.centerX) || Number.isNaN(gap.width)) {
    throw new Error('gapTileQuery: gap.centerX and gap.width must be finite numbers (got NaN)');
  }
  // GUARD 2: no gap → transparent wrapper.
  if (gap.width <= 0) return base;

  // GUARD 3 + 4: compute clamped gap bounds in world space (same math as gapSolids).
  let gapLeft: number;
  let gapRight: number;
  if (gap.width >= span.width) {
    gapLeft = span.x;
    gapRight = span.x + span.width;
  } else {
    const half = gap.width / 2;
    const minCenter = span.x + half;
    const maxCenter = span.x + span.width - half;
    const clampedCenter = clamp(gap.centerX, minCenter, maxCenter);
    gapLeft = clampedCenter - half;
    gapRight = clampedCenter + half;
  }

  const spanTop = span.y;
  const spanBottom = span.y + span.height;

  return (tileX: number, tileY: number) => {
    const tileWorldLeft = tileX * tileSize;
    const tileWorldTop = tileY * tileSize;
    // Single-row v1: skip tiles whose Y range doesn't overlap the span row.
    if (tileWorldTop + tileSize <= spanTop || tileWorldTop >= spanBottom) {
      return base(tileX, tileY);
    }
    // Ruling 4: strict AABB overlap between the tile's X span and the clamped
    // gap interval — NOT the proposal's left-edge test. A tile straddling
    // gapLeft (left edge left of gap, body overlapping) is correctly caught.
    if (tileWorldLeft < gapRight && tileWorldLeft + tileSize > gapLeft) {
      return 'empty';
    }
    return base(tileX, tileY);
  };
}

// ===========================================================================
// Sample data — NON-BARREL export (for @benchmarker; not in src/collision/index.ts)
// ===========================================================================
//
// Relocated from src/_prototype/moving-gap.ts (deleted when the production
// module shipped). Lives here so it stays colocated with the types/helpers it
// exercises. The collision barrel (src/collision/index.ts) does NOT re-export
// these — they are benchmark-only and imported via a direct relative path by
// benchmarks/_scripts/moving-gap-render.ts.

/** A colored rect the benchmarker can `fillRect` directly. */
export interface MovingGapSampleRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly color: string;
  readonly label?: string;
}

/** One snapshot of the span + gap + fragments + illustrative overlays. */
export interface MovingGapSampleFrame {
  readonly caption: string;
  readonly gap: GapGeometry;
  readonly fragments: readonly Solid[];
  readonly overlays: readonly MovingGapSampleRect[];
}

/** A titled sequence of frames sharing one span. */
export interface MovingGapSampleScene {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly span: GapSpanConfig;
  readonly frames: readonly MovingGapSampleFrame[];
}

/** Top-level sample sheet — what `sampleMovingGapScene` returns. */
export interface MovingGapSampleSheet {
  readonly scenes: readonly MovingGapSampleScene[];
  readonly palette: {
    readonly background: string;
    readonly spanOutline: string;
    readonly voidFill: string;
    readonly fragment: string;
    readonly fragmentPassthrough: string;
    readonly playerSafe: string;
    readonly playerFalling: string;
    readonly label: string;
  };
  readonly layout: {
    readonly canvasWidth: number;
    readonly canvasHeight: number;
    readonly frameHeight: number;
    readonly margin: number;
  };
}

const SAMPLE_PALETTE = {
  background: '#0f0f1a',
  spanOutline: '#3a3a4a',
  voidFill: '#1a0a0a',
  fragment: '#4a90d9',
  fragmentPassthrough: '#9d7edb',
  playerSafe: '#7ee787',
  playerFalling: '#f85149',
  label: '#e6edf3',
} as const;

const SAMPLE_LAYOUT = {
  canvasWidth: 960,
  canvasHeight: 1100,
  frameHeight: 90,
  margin: 60,
} as const;

/** Convenience: build a frame from a gap geometry + overlays; fragments via gapSolids. */
function frameFromGap(
  caption: string,
  span: GapSpanConfig,
  gap: GapGeometry,
  overlays: readonly MovingGapSampleRect[] = [],
): MovingGapSampleFrame {
  return { caption, gap, fragments: gapSolids(span, gap), overlays };
}

/**
 * Build the sample sheet for the benchmarker. NON-BARREL export — benchmark
 * tooling only; not part of the public API.
 *
 * Pure: returns a plain-data description; no canvas/DOM reads. The benchmarker
 * iterates `scenes`, lays each out as a horizontal strip of frames, and
 * `fillRect`s fragments + overlays using the palette.
 *
 * Scenes included:
 * 1. Sweep left→right (6 frames; middle frame shows 3 player positions)
 * 2. Chase mode (engaged → escaped/disengaged)
 * 3. Expand mode (5 frames across one grow cycle)
 * 4. Edge: gapWidth = span.width → 0 fragments
 * 5. Edge: gapWidth ≤ 0 → 1 full-span fragment
 * 6. Edge: centerX clamped (flush left, flush right, wildly out of bounds)
 */
export function sampleMovingGapScene(): MovingGapSampleSheet {
  const span: GapSpanConfig = { x: 120, y: 0, width: 720, height: 16 };
  const gapWidth = DEFAULT_GAP_WIDTH;
  const half = gapWidth / 2;
  const spanCenterX = span.x + span.width / 2;
  const playerW = 16;
  const playerH = 24;

  // --- Scene 1: sweep left → right (6 frames) ---
  // Hand-driven centerX values (validates that gapSolids is independently
  // usable without the motion machine — the geometry/motion separation).
  const sweepFrames: MovingGapSampleFrame[] = [];
  for (let i = 0; i < 6; i++) {
    const t = i / 5;
    const centerX = span.x + half + t * (span.width - gapWidth);
    const gap: GapGeometry = { centerX, width: gapWidth };
    const overlays: MovingGapSampleRect[] = [];
    if (i === 3) {
      const gapLeft = centerX - half;
      const gapRight = centerX + half;
      overlays.push(
        {
          x: gapLeft - playerW - 4,
          y: span.y - playerH,
          width: playerW,
          height: playerH,
          color: SAMPLE_PALETTE.playerSafe,
          label: 'safe',
        },
        {
          x: centerX - playerW / 2,
          y: span.y + 10,
          width: playerW,
          height: playerH,
          color: SAMPLE_PALETTE.playerFalling,
          label: 'falling',
        },
        {
          x: gapRight + 4,
          y: span.y - playerH,
          width: playerW,
          height: playerH,
          color: SAMPLE_PALETTE.playerSafe,
          label: 'safe',
        },
      );
    }
    sweepFrames.push(frameFromGap(`centerX=${centerX.toFixed(0)} (${i + 1}/6)`, span, gap, overlays));
  }

  // --- Scene 2: chase mode (2 frames via the motion API) ---
  const chaseConfig: GapMotionConfig = {
    travelMode: 'chase',
    speed: 4,
    gapWidth,
    initialCenterX: spanCenterX,
    giveUpRadius: DEFAULT_CHASE_GIVE_UP_RADIUS,
  };
  let chaseState = createGapMotion(chaseConfig);
  const chaseFrames: MovingGapSampleFrame[] = [];

  // Phase 1: player slightly right → gap chases.
  const target1 = chaseState.centerX + 60;
  for (let t = 0; t < 20; t++) {
    chaseState = advanceGapMotion(chaseState, 1, chaseConfig, target1);
  }
  chaseFrames.push(
    frameFromGap(
      `chase engaged: target=${target1.toFixed(0)} → center=${chaseState.centerX.toFixed(0)}`,
      span,
      { centerX: chaseState.centerX, width: gapWidth },
      [
        {
          x: target1 - playerW / 2,
          y: span.y - playerH,
          width: playerW,
          height: playerH,
          color: SAMPLE_PALETTE.playerSafe,
          label: 'target',
        },
      ],
    ),
  );

  // Phase 2: player teleports far past giveUpRadius → gap holds.
  const target2 = chaseState.centerX + DEFAULT_CHASE_GIVE_UP_RADIUS + 80;
  for (let t = 0; t < 20; t++) {
    chaseState = advanceGapMotion(chaseState, 1, chaseConfig, target2);
  }
  chaseFrames.push(
    frameFromGap(
      `target escaped (> ${DEFAULT_CHASE_GIVE_UP_RADIUS}px) → gap holds at ${chaseState.centerX.toFixed(0)}`,
      span,
      { centerX: chaseState.centerX, width: gapWidth },
      [
        {
          x: target2 - playerW / 2,
          y: span.y - playerH,
          width: playerW,
          height: playerH,
          color: SAMPLE_PALETTE.playerFalling,
          label: 'escaped',
        },
      ],
    ),
  );

  // --- Scene 3: expand mode (5 frames across one grow cycle) ---
  const expandConfig: GapMotionConfig = {
    travelMode: 'expand',
    speed: 0,
    gapWidth,
    minWidth: 16,
    maxWidth: 128,
    expandTicks: 60,
    initialCenterX: spanCenterX,
  };
  let expandState = createGapMotion(expandConfig);
  const expandFrames: MovingGapSampleFrame[] = [];
  const expandSnapTicks = [0, 15, 30, 45, 59];
  for (let t = 0; t <= 59; t++) {
    if (expandSnapTicks.includes(t)) {
      expandFrames.push(
        frameFromGap(`t=${t}  width=${expandState.width.toFixed(1)}`, span, {
          centerX: expandState.centerX,
          width: expandState.width,
        }),
      );
    }
    expandState = advanceGapMotion(expandState, 1, expandConfig);
  }

  // --- Scene 4: edge — gapWidth = span.width → 0 fragments ---
  const fullVoidGap: GapGeometry = { centerX: spanCenterX, width: span.width };
  const fullVoidFrames: MovingGapSampleFrame[] = [
    frameFromGap(`gap.width = span.width (${span.width}) → 0 fragments`, span, fullVoidGap),
  ];

  // --- Scene 5: edge — gapWidth ≤ 0 → 1 full-span fragment ---
  const zeroGap: GapGeometry = { centerX: spanCenterX, width: 0 };
  const negativeGap: GapGeometry = { centerX: spanCenterX, width: -50 };
  const noGapFrames: MovingGapSampleFrame[] = [
    frameFromGap('gap.width = 0 → 1 fragment (full span)', span, zeroGap),
    frameFromGap('gap.width = -50 → 1 fragment (full span)', span, negativeGap),
  ];

  // --- Scene 6: edge — centerX clamping ---
  const clampFrames: MovingGapSampleFrame[] = [
    frameFromGap(
      `flush L: centerX = span.x + half = ${(span.x + half).toFixed(0)} → 1 right frag`,
      span,
      { centerX: span.x + half, width: gapWidth },
    ),
    frameFromGap(
      `flush R: centerX = span.x + w - half = ${(span.x + span.width - half).toFixed(0)} → 1 left frag`,
      span,
      { centerX: span.x + span.width - half, width: gapWidth },
    ),
    frameFromGap('centerX = -9999 → clamped to flush L → 1 right frag', span, {
      centerX: -9999,
      width: gapWidth,
    }),
    frameFromGap('centerX = +9999 → clamped to flush R → 1 left frag', span, {
      centerX: 9999,
      width: gapWidth,
    }),
  ];

  return {
    scenes: [
      {
        id: 'sweep',
        title: 'Sweep (left → right)',
        description: '6 frames sweeping the gap across the span. Frame 4 shows 3 player positions.',
        span,
        frames: sweepFrames,
      },
      {
        id: 'chase',
        title: 'Chase (engage → escape)',
        description: 'Gap chases the player, then disengages when the player exceeds giveUpRadius.',
        span,
        frames: chaseFrames,
      },
      {
        id: 'expand',
        title: 'Expand (grow cycle)',
        description: 'Width grows from minWidth to maxWidth over expandTicks, then resets.',
        span,
        frames: expandFrames,
      },
      {
        id: 'edge-full-void',
        title: 'Edge: gap ≥ span',
        description: 'gapWidth = span.width → fully voided → 0 fragments.',
        span,
        frames: fullVoidFrames,
      },
      {
        id: 'edge-no-gap',
        title: 'Edge: gap ≤ 0',
        description: 'gapWidth ≤ 0 → no gap → 1 full-span fragment.',
        span,
        frames: noGapFrames,
      },
      {
        id: 'edge-clamp',
        title: 'Edge: centerX clamp',
        description: 'Out-of-bounds centerX clamped to span edges → single-fragment output.',
        span,
        frames: clampFrames,
      },
    ],
    palette: SAMPLE_PALETTE,
    layout: SAMPLE_LAYOUT,
  };
}
