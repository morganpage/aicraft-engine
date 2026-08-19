/**
 * Analytic motion primitives for the camera brain.
 *
 * `converge` is a capped-exponential response solver used by both the follow
 * body and the lens; `followPosition` is one pure deadzone-follow step. The
 * small clamp/band helpers here are shared with `brain.ts`.
 *
 * All functions are pure and deterministic: same inputs → same output, no
 * `Math.random`, no `Date.now`, inputs never mutated.
 *
 * `converge` is re-exported via the camera barrel; `followPosition` and the
 * helpers are intentionally file-level (used by `brain.ts` and focused unit
 * tests, but not part of the package's public API).
 *
 * @module
 */

import type {
  Camera,
  CameraBounds,
  CameraTarget,
  CameraViewport,
  DampedMotionConfig,
  FollowBand,
  FollowBodyConfig,
} from './types';
import {
  DEFAULT_CAMERA_MOTION,
  DEFAULT_FOLLOW_BODY,
} from './constants';

// --- numeric guards -------------------------------------------------------

/** `true` when `v` is a finite, strictly-positive number. */
function isFinitePositive(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/** `true` when `v` is a finite, non-negative number. */
function isFiniteNonNegative(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

/**
 * Resolve a partial damped-motion config against a complete fallback,
 * field-by-field. Per the plan's defensive numeric policy: non-finite or
 * non-positive `halfLife`/`maxSpeed`, and negative or non-finite
 * `snapThreshold`, use the fallback.
 */
export function mergeMotion(
  partial: Readonly<DampedMotionConfig> | undefined,
  fallback: Readonly<Required<DampedMotionConfig>>,
): Required<DampedMotionConfig> {
  return {
    halfLife: isFinitePositive(partial?.halfLife) ? partial!.halfLife : fallback.halfLife,
    maxSpeed: isFinitePositive(partial?.maxSpeed) ? partial!.maxSpeed : fallback.maxSpeed,
    snapThreshold: isFiniteNonNegative(partial?.snapThreshold)
      ? partial!.snapThreshold
      : fallback.snapThreshold,
  };
}

/**
 * Validate a per-axis deadzone band. A band is valid only when both values are
 * finite and `0 <= trail <= lead <= 1`; otherwise the supplied fallback is
 * used (the entire axis falls back, never a mix).
 */
export function resolveBand(
  band: Readonly<FollowBand> | undefined,
  fallback: Readonly<FollowBand>,
): Readonly<FollowBand> {
  const t = band?.trail;
  const l = band?.lead;
  if (
    typeof t === 'number' &&
    typeof l === 'number' &&
    Number.isFinite(t) &&
    Number.isFinite(l) &&
    t >= 0 &&
    l <= 1 &&
    t <= l
  ) {
    return { trail: t, lead: l };
  }
  return { trail: fallback.trail, lead: fallback.lead };
}

// --- bounds/letterbox clamp ----------------------------------------------

/**
 * Clamp a viewport top-left on one axis against the level bound.
 *
 * - `bound > visible`: clamp to `[-padding, bound - visible + padding]`
 *   (padding permits deliberate overscan).
 * - `bound <= visible`: return the letterbox centre `(bound - visible) / 2`
 *   and ignore padding (a world smaller than the view is centred, not shifted).
 */
export function clampTopLeft(
  topLeft: number,
  bound: number,
  visible: number,
  padding: number,
): number {
  if (bound <= visible) return (bound - visible) / 2;
  const lo = -padding;
  const hi = bound - visible + padding;
  const r = topLeft < lo ? lo : topLeft > hi ? hi : topLeft;
  return r === 0 ? 0 : r; // canonicalize -0 → +0 (avoids surprising sign in serialized state)
}

// --- device-pixel snap threshold -------------------------------------------

/**
 * The largest world-unit snap threshold that is invisible on screen: ONE
 * device pixel, expressed in world units (`1 / (zoom · dpr)`).
 *
 * A follow solver's snap threshold exists to terminate the exponential's
 * asymptote — without it, catch-up decays through ever-smaller increments and
 * stalls a fraction short of the clamp bound. But the threshold is in WORLD
 * units while its effect is on SCREEN: the terminal snap jumps
 * `zoom · threshold` device pixels in ONE tick. The old fixed
 * `0.5`-world-pixel default is therefore display-invisible at zoom 1 and a
 * MULTI-PIXEL lurch at zoom 3+ — the camera settles to near-stillness and
 * then clicks into place, a defect a real build shipped and hunted. Below one
 * device pixel the renderer's own quantization absorbs the jump, so this is
 * exactly the boundary: the largest threshold that cannot be seen, and the
 * natural companion to `cameraTransform`'s device-pixel render snapping.
 *
 * Non-finite or non-positive `zoom`/`dpr` resolve to
 * {@link DEFAULT_CAMERA_MOTION.snapThreshold} (`0.5`) — the shipped default,
 * so garbage inputs degrade to prior behavior rather than a zero threshold
 * that would never snap. Pure; never throws.
 */
export function devicePixelSnapThreshold(zoom: number, dpr: number): number {
  if (!isFinitePositive(zoom) || !isFinitePositive(dpr)) {
    return DEFAULT_CAMERA_MOTION.snapThreshold;
  }
  return 1 / (zoom * dpr);
}

// --- converge -------------------------------------------------------------

/**
 * Analytic capped-exponential convergence: move `current` toward `desired` by
 * one `dt` step, obeying a max-speed cap and a snap threshold.
 *
 * Solves the ODE `dr/dt = -min(maxSpeed, λ·r)` (where `r` is the remaining
 * distance and `λ = ln2 / halfLife`) exactly for the step, rather than taking
 * an Euler `speed * dt` approximation. In the capped region the value moves at
 * a constant `maxSpeed`; once the remaining distance drops below
 * `capDistance = maxSpeed / λ` it crosses into the exponential region and
 * eases the rest of the way.
 *
 * Properties:
 *   - Never overshoots: the result always lies between `current` and `desired`.
 *   - Never moves on a zero-time step: a non-positive or non-finite `dt`
 *     returns `current` unchanged, even when already within `snapThreshold`.
 *   - Snaps exactly: with a positive `dt`, returns `desired` when within
 *     `snapThreshold`.
 *   - Partition-invariant in exact arithmetic for a static target (the capped
 *     ODE has the semigroup property), including a step that crosses the cap
 *     boundary. The monotone snap projection preserves that in exact
 *     arithmetic too. Finite precision can flip the snap comparison only when
 *     the true result sits essentially on the threshold, bounded by
 *     `snapThreshold`; callers comparing partitioned trajectories should stay
 *     a clear epsilon outside the snap band.
 *
 * Omitted/invalid config fields fall back to {@link DEFAULT_CAMERA_MOTION}.
 * Non-finite or non-positive `dt` advances by zero (returns `current`). A
 * non-finite `desired` holds `current`.
 */
export function converge(
  current: number,
  desired: number,
  dt: number,
  config: Readonly<DampedMotionConfig> = {},
): number {
  const m = mergeMotion(config, DEFAULT_CAMERA_MOTION);
  const t = Number.isFinite(dt) && dt > 0 ? dt : 0;
  if (!Number.isFinite(desired)) return Number.isFinite(current) ? current : 0;
  const cur = Number.isFinite(current) ? current : 0;
  const diff = desired - cur;
  const r = Math.abs(diff);
  if (t === 0) return cur; // no time elapsed → no movement (takes precedence over snap)
  if (r <= m.snapThreshold) return desired;

  const lambda = Math.LN2 / m.halfLife;
  const capDistance = m.maxSpeed / lambda;
  let rNext: number;
  if (r > capDistance) {
    // Capped region: move at maxSpeed until the boundary, then exponentiate.
    const tCap = (r - capDistance) / m.maxSpeed;
    if (t <= tCap) {
      rNext = r - m.maxSpeed * t;
    } else {
      rNext = capDistance * Math.exp(-lambda * (t - tCap));
    }
  } else {
    rNext = r * Math.exp(-lambda * t);
  }

  if (rNext <= m.snapThreshold) return desired;
  // `rNext` is the decayed REMAINING distance, so the new position is the
  // target minus that remaining distance (i.e. we covered `r - rNext`).
  return desired - Math.sign(diff) * rNext;
}

// --- follow body ---------------------------------------------------------

/**
 * Advance the deadzone follow body one pure step.
 *
 * For one axis, with `cam` the live top-left, `p` the target centre, `visible`
 * the screen dimension divided by live zoom, and `{trail, lead}` the band:
 *
 * 1. If the bound is no larger than `visible`, aim at the letterbox centre and
 *    skip the band (padding ignored on that axis).
 * 2. Compute `s = (p - cam) / visible`.
 * 3. `s > lead` → aim at `p - lead·visible` (forward catch-up).
 * 4. `s < trail` → aim at `p - trail·visible` (backward catch-up).
 * 5. Otherwise aim at `cam` (the deadzone hold).
 * 6. Clamp the aim to `[-padding, bound - visible + padding]`.
 * 7. Analytically converge `cam` toward the aim.
 *
 * This is an implementation helper used by `brain.ts` and by focused unit
 * tests; it is intentionally NOT re-exported from the camera barrel. The
 * `targetKey` field of {@link FollowBodyConfig} is unused here — the brain
 * resolves the target from its table and passes the rect in directly.
 */
export function followPosition(
  camera: Readonly<Camera>,
  target: Readonly<CameraTarget>,
  bounds: Readonly<CameraBounds>,
  viewport: Readonly<CameraViewport>,
  zoom: number,
  dt: number,
  config: Readonly<FollowBodyConfig> = {},
): Camera {
  const z = isFinitePositive(zoom) ? zoom : 1;
  const vw = isFinitePositive(viewport.width) ? viewport.width : 1;
  const vh = isFinitePositive(viewport.height) ? viewport.height : 1;
  const visibleW = vw / z;
  const visibleH = vh / z;
  const bw = isFiniteNonNegative(bounds.width) ? bounds.width : 0;
  const bh = isFiniteNonNegative(bounds.height) ? bounds.height : 0;
  const padding = isFiniteNonNegative(config.padding) ? config.padding : 0;
  const motion = config.motion ?? {};
  const bandX = resolveBand(config.followX, DEFAULT_FOLLOW_BODY.followX);
  const bandY = resolveBand(config.followY, DEFAULT_FOLLOW_BODY.followY);

  const px = target.x + target.width / 2;
  const py = target.y + target.height / 2;
  const cx = Number.isFinite(camera.x) ? camera.x : 0;
  const cy = Number.isFinite(camera.y) ? camera.y : 0;

  return {
    x: followAxis(cx, px, bw, visibleW, bandX, padding, dt, motion),
    y: followAxis(cy, py, bh, visibleH, bandY, padding, dt, motion),
  };
}

/** Per-axis deadzone step (see {@link followPosition}). */
function followAxis(
  cam: number,
  p: number,
  bound: number,
  visible: number,
  band: Readonly<FollowBand>,
  padding: number,
  dt: number,
  motion: Readonly<DampedMotionConfig>,
): number {
  // Letterbox: level no larger than the view on this axis → centre it.
  if (bound <= visible) {
    return converge(cam, (bound - visible) / 2, dt, motion);
  }
  const s = (p - cam) / visible;
  let aim: number;
  if (s > band.lead) {
    aim = p - band.lead * visible;
  } else if (s < band.trail) {
    aim = p - band.trail * visible;
  } else {
    aim = cam; // deadzone hold
  }
  aim = clampTopLeft(aim, bound, visible, padding);
  return converge(cam, aim, dt, motion);
}
