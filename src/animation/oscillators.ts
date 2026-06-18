import type { Vec2 } from './types';

/**
 * Deterministic animation oscillators.
 *
 * All functions are pure: the same inputs always produce the same output.
 * Use these for repeating motion patterns (bobs, pulses, ambient shake)
 * where replay-perfect determinism matters — recorded footage, save replays,
 * and seeded procedural generation all reproduce exactly.
 *
 * For one-shot random-feeling shake (Spitekeep's death shake), use `sineShake`
 * for determinism, or call `Math.random` directly in the renderer if the
 * result never feeds back into the simulation.
 *
 * Migrated verbatim from `src/primitives/animation.ts` (now deleted). Behavior
 * is unchanged — only the import path and `Vec2` source moved.
 */

/**
 * Sine-based bobbing motion. Returns a signed displacement in range
 * `[-amplitude, +amplitude]`. At `tick=0` returns `0`.
 *
 * @param tick - current tick or time value
 * @param speed - cycles per unit of tick (e.g. 0.05 = one cycle every 20 ticks)
 * @param amplitude - peak displacement from 0
 */
export function bob(tick: number, speed: number, amplitude: number): number {
  const v = Math.sin(tick * speed * Math.PI * 2) * amplitude;
  return v === 0 ? 0 : v;
}

/**
 * Sine-based pulse in range `[0, amplitude]`. Output goes
 * `0 → amplitude → 0 → amplitude → 0...` Useful for "breathing" highlights,
 * door glows, idle scale animations.
 */
export function pulse(tick: number, speed: number, amplitude: number): number {
  const v = (Math.sin(tick * speed * Math.PI * 2) * 0.5 + 0.5) * amplitude;
  return v === 0 ? 0 : v;
}

/**
 * Deterministic screen-shake offset using two decorrelated sine waves.
 * Reproducible across frames given the same `tick`.
 *
 * @param tick - current tick (advance by 1 per frame for visible shake)
 * @param magnitude - peak displacement in pixels per axis
 * @param frequencyX - x-axis cycles per tick (default 0.7)
 * @param frequencyY - y-axis cycles per tick (default 0.5)
 */
export function sineShake(
  tick: number,
  magnitude: number,
  frequencyX: number = 0.7,
  frequencyY: number = 0.5,
): Vec2 {
  return {
    x: Math.sin(tick * frequencyX * Math.PI * 2) * magnitude,
    y: Math.sin(tick * frequencyY * Math.PI * 2 + 1.3) * magnitude,
  };
}

/**
 * Linear-decay envelope for shake magnitude. Returns the current magnitude
 * given ticks-elapsed, total duration, and initial magnitude.
 *
 * Returns `0` for `tick >= duration`. Use with `sineShake`:
 *
 * ```ts
 * const m = shakeEnvelope(tickSinceDeath, 30, 6);
 * const offset = sineShake(tickSinceDeath, m);
 * ```
 */
export function shakeEnvelope(tick: number, duration: number, initialMagnitude: number): number {
  if (duration <= 0) return 0;
  if (tick >= duration) return 0;
  if (tick <= 0) return initialMagnitude;
  return initialMagnitude * (1 - tick / duration);
}
