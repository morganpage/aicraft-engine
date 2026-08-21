import {
  advance as advanceParticles,
  DEFAULT_FIXED_DT,
  step as stepParticles,
  type AdvanceOptions,
  type Particle,
} from 'aicraft-engine';

/**
 * The default shared "air" medium, in ENGINE TICK UNITS: gravity is px/tick²
 * and drag is a per-tick velocity multiplier. Tuned by a real build's
 * particle pass (a landing puff that hangs at the feet wants roughly this
 * buoyancy envelope under per-particle `gravityScale`/`dragScale` overrides).
 */
export const DEFAULT_PARTICLE_AIR: Readonly<AdvanceOptions> = { gravity: 0.1, drag: 0.9 };

/** Options for {@link createParticleSystem}. */
export interface ParticleSystemOptions {
  /**
   * The fixed timestep in SECONDS (e.g. `1/60`) — the conversion anchor. The
   * system converts your per-step seconds dt into the ENGINE's tick units
   * (`dt / fixedDt`), which is the one conversion this recipe exists to own.
   */
  readonly fixedDt: number;
  /** Shared air medium in tick units. Default {@link DEFAULT_PARTICLE_AIR}. */
  readonly air?: Readonly<AdvanceOptions>;
}

/** A seconds-facing particle system (see {@link createParticleSystem}). */
export interface ParticleSystem {
  /** Advance without culling. `dt` is SECONDS. */
  advance(particles: readonly Particle[], dt: number, opts?: Readonly<AdvanceOptions>): Particle[];
  /** Advance and cull dead particles — the standard per-step pipeline. `dt` is SECONDS. */
  step(particles: readonly Particle[], dt: number, opts?: Readonly<AdvanceOptions>): Particle[];
  /** The tick count for a seconds dt — spawn-site math helper. */
  ticksFrom(dt: number): number;
}

/**
 * Own the seconds→ticks conversion for the engine's particle pillar.
 *
 * The engine's particle API is **tick-unit throughout**: `advance` treats
 * `dt` as ticks, velocities are px/tick, `life` is ticks. A game whose fixed
 * step is in seconds (most) must convert once per step — and a real build
 * forgot, passing `1/60` straight into `advance`: life burned 60× too slow,
 * nothing ever died, and every effect drifted for most of a minute reading
 * as "particles shooting off across the screen." The unit was documented;
 * documentation did not save it. This recipe makes the mismatch impossible
 * at the call site: its API TAKES seconds and converts internally, and it
 * warns (once) if handed a dt that looks like ticks (`>= 1`) — the reverse
 * mistake.
 *
 * **Engine versions past this recipe's promotion ship the conversion
 * natively** as `advanceSeconds` / `stepSeconds` (+ `DEFAULT_PARTICLE_AIR`)
 * in `src/particles/seconds.ts` — prefer those directly when your brief's
 * pin has them. This file remains the copy-in back-port for briefs pinned to
 * engine versions before that export existed (0.20.0 and earlier), so it
 * imports only long-stable symbols (`advance`, `step`, `DEFAULT_FIXED_DT`).
 *
 * Per-effect feel rides the engine's per-particle `gravityScale`/`dragScale`
 * fields against one shared air profile: e.g. landing dust at
 * `gravityScale: -0.15` (buoyant, billows sideways), gem sparkle at `0`
 * (weightless, twinkles in place), death burst at `0.45` (arcs down).
 * Spawn speeds are authored in px/tick, exactly as the engine's own presets
 * are tuned.
 *
 * @example
 * ```ts
 * const fx = createParticleSystem({ fixedDt: DEFAULT_FIXED_DT });
 * // in the fixed step:
 * particles = fx.step(particles, dt); // dt is your SECONDS fixed step
 * ```
 */
export function createParticleSystem(
  options: Readonly<ParticleSystemOptions>,
): ParticleSystem {
  const fixedDt =
    Number.isFinite(options.fixedDt) && options.fixedDt > 0
      ? options.fixedDt
      : DEFAULT_FIXED_DT;
  const air = options.air ?? DEFAULT_PARTICLE_AIR;

  let warnedTicksDt = false;
  const ticksFrom = (dt: number): number => {
    if (!Number.isFinite(dt) || dt <= 0) return 0;
    if (dt >= 1 && !warnedTicksDt) {
      warnedTicksDt = true;
      try {
        console.warn(
          'particle-system: dt >= 1 looks like TICKS, but this API takes SECONDS ' +
            '(a 60 Hz fixed step passes ~0.0167). Treating it as seconds either way ' +
            `(${dt} s = ${dt / fixedDt} ticks).`,
        );
      } catch {
        // A hostile host console must not break the sim.
      }
    }
    return dt / fixedDt;
  };

  return {
    advance(particles, dt, opts = air) {
      return advanceParticles(particles, ticksFrom(dt), opts);
    },
    step(particles, dt, opts = air) {
      return stepParticles(particles, ticksFrom(dt), opts);
    },
    ticksFrom,
  };
}
