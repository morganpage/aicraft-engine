/**
 * Seconds-facing entry points for the tick-unit particle pillar.
 *
 * The solver (`advance` / `step` / the emitters) is TICK-unit throughout:
 * `dtTicks` is ticks, velocities are px/tick, `life` is ticks — the units the
 * engine's presets are tuned in. Most games, however, hold their fixed step
 * in SECONDS (`DEFAULT_FIXED_DT = 1/60`), and passing it straight into
 * `advance` is a silent 60× unit error: life burns 60× too slow, nothing
 * ever dies, and every effect drifts for most of a minute — the defect
 * shipped in a real build as "particles shooting off across the screen".
 * The tick contract was documented on every symbol and documentation did not
 * save it. These functions own the conversion (`dtSeconds / fixedDt`) so the
 * mismatch cannot happen at the call site: the parameter name carries the
 * unit, and the conversion happens exactly once, here.
 *
 * @module
 */

import { DEFAULT_FIXED_DT } from '../game-loop';
import { advance, type AdvanceOptions } from './advance';
import { cull } from './cull';
import type { Particle } from './types';

/**
 * The shared "air" medium every effect scales via the per-particle
 * `gravityScale`/`dragScale` fields, in TICK UNITS: `gravity` is px/tick² and
 * `drag` is a per-tick velocity multiplier. Tuned by a real build's particle
 * pass — under it, landing dust at `gravityScale: -0.15` hangs around the
 * feet, a gem sparkle at `0` twinkles in place, and a death burst at `0.45`
 * arcs down. Pass as the options to {@link advanceSeconds} /
 * {@link stepSeconds} (or plain `advance`/`step`).
 */
export const DEFAULT_PARTICLE_AIR: Readonly<AdvanceOptions> = { gravity: 0.1, drag: 0.9 };

/** Options for {@link advanceSeconds} / {@link stepSeconds}. */
export interface AdvanceSecondsOptions extends AdvanceOptions {
  /**
   * The fixed timestep in SECONDS the dt converts against — the conversion
   * anchor. Default `DEFAULT_FIXED_DT` (1/60). A 30 Hz sim passes `1/30`.
   */
  readonly fixedDt?: number;
}

/**
 * Convert a seconds duration to particle ticks: `dtSeconds / fixedDt`.
 * Non-finite or non-positive input yields `0` (an identity step); a
 * non-positive `fixedDt` falls back to `DEFAULT_FIXED_DT`. Pure.
 */
export function secondsToTicks(dtSeconds: number, fixedDt: number = DEFAULT_FIXED_DT): number {
  if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return 0;
  const fd = Number.isFinite(fixedDt) && fixedDt > 0 ? fixedDt : DEFAULT_FIXED_DT;
  return dtSeconds / fd;
}

/**
 * `advance` for a SECONDS dt: converts `dtSeconds / opts.fixedDt` to ticks
 * internally (default `1/60`), then advances exactly as `advance` does.
 * A 60 Hz game passing its fixed-step `dt` gets exactly one tick per step.
 * Physics output is byte-identical to `advance(particles, 1, opts)` at
 * `fixedDt = 1/60`.
 */
export function advanceSeconds(
  particles: readonly Particle[],
  dtSeconds: number,
  opts: AdvanceSecondsOptions = {},
): Particle[] {
  const { fixedDt, ...air } = opts;
  return advance(particles, secondsToTicks(dtSeconds, fixedDt ?? DEFAULT_FIXED_DT), air);
}

/**
 * Convenience: `cull(advanceSeconds(...))` — the standard per-step pipeline
 * for a game whose fixed step is in seconds. The seconds twin of `step`.
 */
export function stepSeconds(
  particles: readonly Particle[],
  dtSeconds: number,
  opts: AdvanceSecondsOptions = {},
): Particle[] {
  return cull(advanceSeconds(particles, dtSeconds, opts));
}
