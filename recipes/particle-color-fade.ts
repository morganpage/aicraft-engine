import { advance, mixHex, type AdvanceOptions, type Particle } from 'aicraft-engine';

/**
 * A {@link Particle} carrying an optional end color for a fade tag. The
 * engine's `Particle` has no color-over-lifetime field (alpha and size curves
 * exist; color does not), so games stamp one on — and the engine's `advance()`
 * rebuilds each particle from an explicit field list, dropping any extra
 * field after a single tick.
 */
export interface ColorFadeParticle extends Particle {
  /** Fade target; lerped from `color` over the particle's remaining life. */
  readonly colorEnd?: string;
}

/**
 * `advance()` that preserves `colorEnd` fade tags.
 *
 * The engine's `advance()` maps each particle to a fresh literal enumerating
 * exactly its ten fields (a deliberate engine decision), so a tag stamped at
 * spawn is destroyed on the first tick and games had to re-stamp it after
 * every advance. This recipe performs the advance, then re-stamps `colorEnd`
 * from the pre-advance particle by index — `advance()` is order-preserving,
 * so the zip is exact. Physics output is byte-identical to `advance()`.
 *
 * `dtTicks` is TICKS — the engine's `advance` unit since the 0.21.0 parameter
 * rename (passing a fixed step's SECONDS here burns life 60× too slow). For a
 * seconds-based step, advance via the engine's `advanceSeconds` and re-stamp
 * `colorEnd` over its output the same way.
 */
export function advanceWithColorFade(
  particles: readonly ColorFadeParticle[],
  dtTicks: number,
  opts: AdvanceOptions = {},
): ColorFadeParticle[] {
  const stepped = advance(particles, dtTicks, opts);
  return stepped.map((p, i) => {
    const colorEnd = particles[i].colorEnd;
    return colorEnd === undefined ? p : { ...p, colorEnd };
  });
}

/**
 * The particle's color at its current age: `color` → `colorEnd` over
 * remaining life. Render-time reader, mirroring `particleAlphaCurve` /
 * `particleSizeCurve` — call it while drawing, never store the result.
 *
 * Particles without `colorEnd` return their (possibly default) `color`
 * unchanged, so a mixed array fades selectively.
 */
export function particleColorAt(p: ColorFadeParticle): string {
  const start = p.color ?? '#ffffff';
  const end = p.colorEnd ?? start;
  if (start === end) return start;
  const age =
    p.maxLife > 0 ? 1 - p.life / p.maxLife : 1;
  const t = age < 0 ? 0 : age > 1 ? 1 : age;
  return mixHex(start, end, t);
}
