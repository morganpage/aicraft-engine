import type { Particle } from './types';
import { isHexColor, mixHex } from '../primitives/color';

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

/**
 * The particle's draw color: `color` at spawn, lerping toward `colorEnd` as it
 * dies (dust greying out, embers cooling), via the engine's `mixHex`. The
 * color-fade companion to {@link particleAlphaCurve} — this reader plus the
 * `colorEnd` field retire the copy-in recipe that re-stamped a side-channel
 * tag onto every particle after every `advance` (which drops unknown fields).
 *
 * Falls back gracefully, never throws (`mixHex` parses strictly, so both
 * endpoints are pre-checked with the engine's `isHexColor` — `#rrggbb` only):
 *  - no `colorEnd` → `color` unchanged (a plain one-color particle);
 *  - a missing/unparseable endpoint → the other endpoint, constant;
 *  - neither endpoint usable → `fallback` (`'#ffffff'` default — match your
 *    renderer's default if it differs).
 *
 * Pure reader; evaluate at draw time.
 *
 * @param p - the particle to read
 * @param fallback - color returned when neither endpoint is usable
 * @returns a `#rrggbb` color string for the particle's current age
 */
export function particleColorAt(p: Particle, fallback = '#ffffff'): string {
  const from = p.color !== undefined && isHexColor(p.color) ? p.color : null;
  const to = p.colorEnd !== undefined && isHexColor(p.colorEnd) ? p.colorEnd : null;
  if (from === null && to === null) return fallback;
  if (to === null) return from as string;
  if (from === null) return to;
  if (from === to) return from;
  return mixHex(from, to, particleAge(p));
}
