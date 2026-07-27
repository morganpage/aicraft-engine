/**
 * Squash & stretch: volume-preserving scale transforms for breathing, jumps,
 * landings, and orthographic (Sokpop-style) turning.
 *
 * All functions are pure and stateless: each returns a fresh record. Compose
 * effects by multiplying scale pairs (e.g. `breath × jump-squash`) before
 * applying them via `ctx.scale(sx, sy)`. Never throws.
 *
 * Reduced-motion: the consumer reads `prefersReducedMotion()` and calls
 * `scaledBreath(config, ~0.2)`. The deterministic core never touches the host
 * probe.
 */

/**
 * A 2-axis scale pair for volume-preserving transforms. Apply via
 * `ctx.scale(scaleX, scaleY)`.
 */
export interface Scale2D {
  /** Horizontal scale factor. */
  readonly scaleX: number;
  /** Vertical scale factor. */
  readonly scaleY: number;
}

/**
 * Breathing configuration. All tunable; no magic numbers.
 */
export interface BreathConfig {
  /** Breathing cycles per tick. Period in ticks = `1 / frequency`. */
  frequency: number;
  /** Peak vertical stretch amplitude (e.g. `0.05` = ±5% vertical stretch). */
  amplitude: number;
}

/**
 * Default idle breathing config. Tunable; consumers spread this into their own.
 */
export const DEFAULT_BREATH: Readonly<BreathConfig> = {
  frequency: 0.03,
  amplitude: 0.05,
};

/**
 * Result of an orthographic turning projection: a child element's projected
 * position plus the horizontal/vertical scale to apply to its drawn shape.
 */
export interface TurnedProjection {
  /** Projected X position of the child. */
  readonly x: number;
  /** Projected Y position of the child (unchanged from input). */
  readonly y: number;
  /** Horizontal scale (`|cos(facingAngle)|`); `1` front-on, `0` in profile. */
  readonly sx: number;
  /** Vertical scale (always `1` — turning squashes horizontally only). */
  readonly sy: number;
}

/**
 * Lower bound on `scaleY` to prevent scale inversion (mirror flip) or division
 * by zero. A defensive invariant, not a consumer-tunable parameter.
 */
const MIN_SCALE_Y = 0.05;

/**
 * Upper bound on `scaleY` to prevent unbounded stretch. A defensive invariant,
 * not a consumer-tunable parameter.
 */
const MAX_SCALE_Y = 3.0;

/**
 * Volume-preserving scale from a vertical delta.
 *
 * `deltaY` is an additive vertical-scale offset: `+0.1` stretches 10% taller
 * (and squashes narrower to compensate), `-0.1` squashes 10% shorter (and
 * stretches wider). The product `scaleX * scaleY` is held at exactly `1`
 * (area / volume invariant), so characters look organic instead of simply
 * growing or shrinking.
 *
 * `scaleY` is clamped to `[MIN_SCALE_Y, MAX_SCALE_Y]` before the compensating
 * `scaleX = 1 / scaleY` is computed, which prevents inversion (`scaleY ≤ 0`)
 * and unbounded blow-up. The clamp is the only place the volume invariant can
 * be marginally violated (by design — a degenerate input is clamped to a safe
 * value rather than producing `Infinity`).
 *
 * Pure: returns a fresh `Scale2D`.
 *
 * @param deltaY - vertical scale offset (`0` = identity, `+0.1` = taller, `-0.1` = shorter)
 * @returns volume-preserving scale pair
 *
 * @example
 * ```ts
 * const jump = volumeScale(0.08); // stretch vertically on jump
 * ctx.scale(jump.scaleX, jump.scaleY);
 * ```
 */
export function volumeScale(deltaY: number): Scale2D {
  const raw = 1 + deltaY;
  const scaleY = raw < MIN_SCALE_Y ? MIN_SCALE_Y : raw > MAX_SCALE_Y ? MAX_SCALE_Y : raw;
  return { scaleX: 1 / scaleY, scaleY };
}

/**
 * Ambient breathing oscillation.
 *
 * Returns a volume-preserving `Scale2D` that oscillates sinusoidally over
 * `tick`: the shape stretches slightly taller then squashes slightly shorter,
 * approximating idle "breathing". The oscillation is a pure function of `tick`
 * and `config` — fully deterministic, no state.
 *
 * @param tick - current tick (deterministic time input)
 * @param config - breathing parameters
 * @returns volume-preserving `Scale2D` for this tick
 */
export function breathe(tick: number, config: BreathConfig): Scale2D {
  const deltaY = Math.sin(tick * config.frequency * Math.PI * 2) * config.amplitude;
  return volumeScale(deltaY);
}

/**
 * Scale a `BreathConfig`'s amplitude by a factor.
 *
 * Scales `amplitude` only; `frequency` is left unchanged (reduced motion should
 * shrink the breathing excursion, not change its pace). Primary use:
 * `scaledBreath(DEFAULT_BREATH, prefersReducedMotion() ? 0.2 : 1)`.
 *
 * Pure: returns a new `BreathConfig`; the input is never mutated.
 *
 * @param config - source breathing config
 * @param scale - amplitude multiplier
 * @returns a new `BreathConfig` with scaled amplitude and unchanged frequency
 */
export function scaledBreath(config: BreathConfig, scale: number): BreathConfig {
  return {
    frequency: config.frequency,
    amplitude: config.amplitude * scale,
  };
}

/**
 * Orthographic turning projection (Sokpop-style faked depth).
 *
 * Squashes a part horizontally based on its facing angle and offsets child
 * elements to simulate 3D rotation on a 2D canvas. At `facingAngle = 0` the
 * part faces the camera (full width); at `π/2` it is in full profile
 * (collapsed to zero width); at `π` it faces away / is mirrored.
 *
 * The horizontal scale is `|cos(facingAngle)|` (non-negative so the part never
 * inverts through zero) and the projected X is `localX * cos(facingAngle)`
 * (signed, so children slide past the center line as the part turns). Vertical
 * position and scale are unaffected.
 *
 * Pure: returns a fresh `TurnedProjection`.
 *
 * @param localX - local X offset of the child element
 * @param localY - local Y offset of the child element
 * @param facingAngle - radians; `0` = front, `π/2` = right profile, `π` = back
 * @returns projected position and scale for the child
 *
 * @example
 * ```ts
 * const p = projectTurnedPart(armX, armY, facing);
 * ctx.save();
 * ctx.translate(p.x, p.y);
 * ctx.scale(p.sx, p.sy);
 * drawArm();
 * ctx.restore();
 * ```
 */
export function projectTurnedPart(
  localX: number,
  localY: number,
  facingAngle: number,
): TurnedProjection {
  const cos = Math.cos(facingAngle);
  return {
    x: localX * cos,
    y: localY,
    sx: Math.abs(cos),
    sy: 1,
  };
}
