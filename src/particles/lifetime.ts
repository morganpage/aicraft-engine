import type { Particle } from './types';

/**
 * Normalized age of a particle in `[0, 1]`: `0` = just spawned, `1` = about
 * to die. Pure reader over the particle's existing `life`/`maxLife` fields.
 *
 * Returns `0` when `maxLife` is `0` (safe for malformed / hand-constructed
 * particles). Never throws.
 *
 * @param p - the particle to read
 * @returns normalized age, clamped to `[0, 1]`
 */
export function particleAge(p: Particle): number {
  if (p.maxLife <= 0) return 0;
  const age = 1 - p.life / p.maxLife;
  if (age < 0) return 0;
  if (age > 1) return 1;
  return age;
}

/**
 * Linearly interpolate render size over a particle's lifetime. At age `0`
 * returns `startSize`; at age `1` returns `endSize`. Pure reader; does NOT
 * mutate or store the result on the particle (the renderer evaluates this at
 * draw time).
 *
 * @param p - the particle to read
 * @param startSize - size at spawn (age 0)
 * @param endSize - size at death (age 1)
 * @returns interpolated size for the particle's current age
 */
export function particleSizeCurve(
  p: Particle,
  startSize: number,
  endSize: number,
): number {
  const age = particleAge(p);
  return startSize + (endSize - startSize) * age;
}

/**
 * Linearly interpolate alpha over a particle's lifetime. At age `0` returns
 * `startAlpha`; at age `1` returns `endAlpha`. Pure reader; clamps the result
 * to `[0, 1]` so renderers can assign it directly to `ctx.globalAlpha`.
 *
 * Matches the reference linear-fade pattern (`alpha = life / maxLife`);
 * this helper formalizes it and makes the fade shape configurable without
 * touching the particle's physics fields.
 *
 * @param p - the particle to read
 * @param startAlpha - alpha at spawn (age 0), clamped to `[0, 1]`
 * @param endAlpha - alpha at death (age 1), clamped to `[0, 1]`
 * @returns interpolated alpha in `[0, 1]`
 */
export function particleAlphaCurve(
  p: Particle,
  startAlpha: number,
  endAlpha: number,
): number {
  const age = particleAge(p);
  const a = startAlpha + (endAlpha - startAlpha) * age;
  if (a < 0) return 0;
  if (a > 1) return 1;
  return a;
}
