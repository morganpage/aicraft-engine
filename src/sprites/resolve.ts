/**
 * Deterministic sprite animation frame-player.
 *
 * Pure functions of accumulated time over a {@link CompiledAnim}'s per-frame
 * durations. This is the engine's "Deterministic Grid Frame-Player" — the one
 * sanctioned primitive flagged in `docs/research/spritesheet-pipelines.md` —
 * generalized to per-frame timings and Aseprite's `forward`/`reverse`/
 * `pingpong` directions.
 *
 * Determinism contract: the same `(state, anim, dt)` always yields the same
 * frame index. No `Math.random`, no `Date.now`, no global state. Driven by
 * the fixed-step `dt` from `createGameLoop`, frame stepping is byte-stable
 * across runs.
 *
 * The caller owns the {@link SpriteAnimState} and advances it each tick. This
 * mirrors how the rest of the engine treats visual state (see
 * `../character/humanoid/state.ts`).
 *
 * @module
 */

import type { CompiledAnim } from './compile';

/**
 * Mutable-by-convention animation clock. The caller holds one per animated
 * sprite and passes it to {@link advanceSpriteAnim} each tick. Holding the
 * accumulated time externally (rather than baking it into the anim) lets one
 * clip definition drive many independent sprites, and lets the caller reset
 * animation by constructing a fresh state.
 */
export interface SpriteAnimState {
  /** Accumulated animation time in milliseconds. */
  elapsedMs: number;
}

/** Create a fresh state at time 0. */
export function createSpriteAnimState(): SpriteAnimState {
  return { elapsedMs: 0 };
}

/**
 * Advance the animation clock by `dtMs`. Returns a new state (immutable
 * convention — the caller reassigns). Negative `dtMs` is clamped to 0.
 *
 * Note the animation's `direction`/`loop` are NOT applied here — the clock
 * just accumulates. {@link currentFrameIndex} maps the clock onto the
 * clip's frame list, which is where direction/loop live.
 */
export function advanceSpriteAnim(
  state: SpriteAnimState,
  dtMs: number,
): SpriteAnimState {
  const dt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;
  return { elapsedMs: state.elapsedMs + dt };
}

/**
 * Total cycle duration of an animation in ms: the sum of its per-frame
 * durations. For pingpong, the visible cycle is `(total * 2 - first - last)`
 * (the endpoints aren't dwelled on the reverse leg) — see {@link currentFrameIndex}.
 */
export function animTotalDuration(anim: CompiledAnim): number {
  let sum = 0;
  for (const d of anim.durations) sum += d;
  return sum;
}

/**
 * The index into `anim.frameIndices` currently on-screen at `state.elapsedMs`.
 *
 * Walks the per-frame duration list, looping (or clamping if `loop: false`).
 * `reverse` clips were already reversed at compile time, so they play forward
 * here. `pingpong` is handled by reflecting elapsed time within a doubled
 * cycle: the clip plays forward over `total`, then backward over `total`
 * (skipping the dwelled endpoints), then repeats.
 *
 * Returns `undefined` for an empty clip (no frames).
 */
export function currentFrameIndex(
  state: SpriteAnimState,
  anim: CompiledAnim,
): number | undefined {
  return currentFrameIndexAt(state.elapsedMs, anim);
}

/** Same as {@link currentFrameIndex} but for an explicit time, useful for
 * scrubbing / previewing. Pure. */
export function currentFrameIndexAt(
  elapsedMs: number,
  anim: CompiledAnim,
): number | undefined {
  const n = anim.frameIndices.length;
  if (n === 0) return undefined;
  if (n === 1) return 0;

  const t = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;

  // Pingpong plays forward then in reverse, dwelling endpoints once per cycle.
  // It's handled by a dedicated frame-walk over the doubled visit sequence.
  if (anim.direction === 'pingpong') {
    return pingpongIndex(t, anim);
  }

  // forward / reverse (reverse was pre-reversed at compile time → forward here)
  const forwardTotal = animTotalDuration(anim);
  let pos: number; // ms offset within the single forward cycle
  if (!anim.loop) {
    // Clamp to the last frame once the single playthrough completes.
    if (t >= forwardTotal) return n - 1;
    pos = t;
  } else {
    if (forwardTotal <= 0) return 0;
    pos = t % forwardTotal;
  }

  return walkDuration(pos, anim);
}

/** Walk the per-frame durations consuming `pos` ms; return the frame slot. */
function walkDuration(pos: number, anim: CompiledAnim): number {
  let remaining = pos;
  for (let i = 0; i < anim.durations.length; i++) {
    const d = anim.durations[i];
    if (remaining < d || d <= 0) return i;
    remaining -= d;
  }
  return anim.durations.length - 1;
}

/**
 * Compute the frame slot for a pingpong clip at time `t`. Builds a virtual
 * timeline: frames 0..n-1 forward, then n-2..1 backward, repeating. Each
 * frame's duration applies once per visit (endpoints visit once per cycle,
 * interior frames visit twice).
 */
function pingpongIndex(t: number, anim: CompiledAnim): number {
  const n = anim.durations.length;
  if (n <= 1) return 0;
  // Build the per-visit duration sequence: [d0, d1, ..., d(n-1), d(n-2), ..., d1]
  // and the frame sequence:      [0,  1,  ..., n-1,   n-2,     ..., 1].
  const visitDurations: number[] = [];
  const visitFrames: number[] = [];
  for (let i = 0; i < n; i++) {
    visitDurations.push(anim.durations[i]);
    visitFrames.push(i);
  }
  for (let i = n - 2; i >= 1; i--) {
    visitDurations.push(anim.durations[i]);
    visitFrames.push(i);
  }
  let cycle = 0;
  for (const d of visitDurations) cycle += d;
  if (cycle <= 0) return 0;
  let pos = t % cycle;
  for (let i = 0; i < visitDurations.length; i++) {
    const d = visitDurations[i];
    if (pos < d || d <= 0) return visitFrames[i];
    pos -= d;
  }
  return visitFrames[0];
}
