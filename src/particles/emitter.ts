import type { Particle } from './types';
import { DEFAULT_RATE_SCALE } from './constants';
import { sampleRegion, type SpawnRegion } from './regions';
import { sampleConeVelocity, type ConeConfig } from './cone';
import { advance } from './advance';

/**
 * Pure state of a continuous emitter's rate accumulator. Persists across
 * ticks; the fractional remainder is what prevents particle loss when
 * `rate · dt < 1`.
 */
export interface EmissionState {
  /** Accumulated fractional particles waiting to spawn. Always in `[0, 1)`. */
  accumulator: number;
}

/**
 * Rate configuration for `advanceEmission`. `rateScale` is the per-call
 * override used for reduced-motion adaptation (consumer passes
 * `prefersReducedMotion() ? 0.25 : 1`). It lives here so the standalone
 * `advanceEmission` primitive mirrors what `stepEmitters` does internally.
 */
export interface EmissionRateConfig {
  /** Particles per unit time. Fractional OK (`0.1` = 1 particle per 10 ticks at dt=1). */
  rate: number;
  /** Per-call rate multiplier. Defaults to `DEFAULT_RATE_SCALE` (1.0). */
  rateScale?: number;
}

/**
 * Pure progression of an emitter's rate accumulator. Integrates
 * `rate · rateScale · dt` into the accumulator, then emits the integer floor.
 * The fractional remainder is preserved across ticks so the long-run average
 * emission rate matches `rate · rateScale` exactly (no particle loss).
 *
 * Defensive (pure-ops discipline): never throws. Negative rates or dt values
 * clamp `spawnCount` to `0` and reset the accumulator — the consumer gets a
 * silent no-op rather than a crash.
 *
 * @param state - current accumulator state
 * @param dt - timestep
 * @param config - rate config
 * @returns `{ next, spawnCount }` — `spawnCount` is a non-negative integer,
 *   `next` is a brand-new `EmissionState` (input never mutated)
 *
 * @example
 * ```ts
 * let state: EmissionState = { accumulator: 0 };
 * for (let i = 0; i < 100; i++) {
 *   const out = advanceEmission(state, 1, { rate: 0.3 });
 *   state = out.next;
 *   // spawn `out.spawnCount` particles this tick...
 * }
 * ```
 */
export function advanceEmission(
  state: EmissionState,
  dt: number,
  config: EmissionRateConfig,
): { next: EmissionState; spawnCount: number } {
  const scale = config.rateScale ?? DEFAULT_RATE_SCALE;
  const total = state.accumulator + config.rate * scale * dt;
  const spawnCount = Math.max(0, Math.floor(total));
  return {
    next: { accumulator: Math.max(0, total - spawnCount) },
    spawnCount,
  };
}

/**
 * Declarative emitter configuration. Describes WHAT to emit (region, cone,
 * rate, per-particle physics profile), not HOW (world gravity/drag, which are
 * world-space and live on `StepEmittersOptions` instead — fire and smoke share
 * world gravity; they differ only in their per-particle `gravityScale`).
 *
 * The `rng` is an isolated stream for this emitter. The consumer creates it
 * once at setup time (e.g. `mulberry32(42)`) and passes the same function
 * reference each frame; recreating it would reset the seed and re-emit the
 * same sequence. Matches the existing `SpawnOptions.rng` convention.
 */
export interface EmitterConfig {
  /** Particles per unit time. Fractional OK. */
  rate: number;
  /** Spawn region shape. */
  region: SpawnRegion;
  /** Velocity cone for initial particle direction. */
  cone: ConeConfig;
  /** Per-particle gravity multiplier applied to every spawned particle. Defaults to `DEFAULT_GRAVITY_SCALE` (1.0). */
  gravityScale?: number;
  /** Per-particle drag multiplier applied to every spawned particle. Defaults to `DEFAULT_DRAG_SCALE` (1.0). */
  dragScale?: number;
  /** Initial particle life in ticks. */
  life: number;
  /** Particle render size. */
  size: number;
  /** Particle color override. */
  color?: string;
  /**
   * Seeded RNG for this emitter's isolated stream. Consumer creates it once
   * and passes the same function reference each frame.
   */
  rng: () => number;
}

/**
 * Bundled emitter state: config (immutable ref) + rate accumulator + live
 * particles. Each `Emitter` owns its particles, so renderers iterate
 * `emitter.particles` directly — no parallel arrays, no index-desync bugs.
 * Pure ops: `stepEmitters` returns new `Emitter` objects; inputs are never
 * mutated.
 */
export interface Emitter {
  /** Immutable emitter configuration (same reference across ticks). */
  readonly config: EmitterConfig;
  /** Rate accumulator, persisted across ticks. */
  accumulator: number;
  /** Live particles owned by this emitter. */
  particles: Particle[];
}

/**
 * Per-call options for `stepEmitters`. World-space properties (`gravity`,
 * `drag`) and global concerns (`rateScale`) live here — NOT on
 * `EmitterConfig`. Fire and smoke share the same world gravity; they differ
 * only in their per-particle `gravityScale`/`dragScale` (which is on
 * `EmitterConfig`). `rateScale` is the reduced-motion hook: the consumer
 * reads `prefersReducedMotion()` in their renderer and passes the scale here,
 * applied uniformly to every emitter in the call.
 */
export interface StepEmittersOptions {
  /** World gravity (px/tick²) applied to all emitters. Default `0`. */
  gravity?: number;
  /** World drag multiplier applied to all emitters. Default `1` (no drag). */
  drag?: number;
  /** Per-call rate multiplier applied to all emitters (reduced-motion). Defaults to `DEFAULT_RATE_SCALE` (1.0). */
  rateScale?: number;
}

/**
 * Create an initial `Emitter` from a config. The emitter starts with a zero
 * accumulator and no live particles.
 *
 * @param config - declarative emitter configuration
 * @returns a fresh `Emitter` ready to step
 */
export function createEmitter(config: EmitterConfig): Emitter {
  return { config, accumulator: 0, particles: [] };
}

/**
 * Advance all emitters by one tick: integrate emission rates, spawn new
 * particles via region + cone sampling, advance all live particles with
 * heterogeneous physics, and cull dead ones. Pure: returns a new `Emitter[]`
 * with updated accumulators and particle arrays; inputs are never mutated.
 *
 * Each emitter's RNG stream is independent — the `config.rng` reference is
 * threaded through directly. Spawning particles for one emitter does not
 * affect the RNG sequence of another.
 *
 * @param emitters - current emitter states
 * @param dt - timestep
 * @param opts - per-call world options (gravity, drag, rateScale)
 * @returns new `Emitter[]` with advanced state
 *
 * @example
 * ```ts
 * import { mulberry32 } from '../rng';
 * import { createEmitter, stepEmitters } from './emitter';
 *
 * const fire = createEmitter({
 *   rate: 2.0,
 *   region: { type: 'line', x1: 0, y1: 0, x2: 60, y2: 0 },
 *   cone: { baseAngle: -Math.PI / 2, spread: 0.5, speedMin: 1, speedMax: 2.5 },
 *   gravityScale: 0.6, dragScale: 0.98,
 *   life: 30, size: 3,
 *   rng: mulberry32(42),
 * });
 *
 * let emitters = [fire];
 * for (let i = 0; i < 90; i++) {
 *   emitters = stepEmitters(emitters, 1, { gravity: 0.5 });
 * }
 * for (const p of emitters[0].particles) { /* render p *\/ }
 * ```
 */
export function stepEmitters(
  emitters: readonly Emitter[],
  dt: number,
  opts: StepEmittersOptions = {},
): Emitter[] {
  const rateScale = opts.rateScale ?? DEFAULT_RATE_SCALE;
  const gravity = opts.gravity ?? 0;
  const drag = opts.drag ?? 1;
  return emitters.map((emitter) => {
    const { config } = emitter;

    const emit = advanceEmission(
      { accumulator: emitter.accumulator },
      dt,
      { rate: config.rate, rateScale },
    );

    const spawned: Particle[] = [];
    for (let i = 0; i < emit.spawnCount; i++) {
      const pos = sampleRegion(config.region, config.rng);
      const vel = sampleConeVelocity(config.cone, config.rng);
      spawned.push({
        x: pos.x,
        y: pos.y,
        vx: vel.vx,
        vy: vel.vy,
        life: config.life,
        maxLife: config.life,
        size: config.size,
        color: config.color,
        gravityScale: config.gravityScale,
        dragScale: config.dragScale,
      });
    }

    const advanced = advance(
      [...emitter.particles, ...spawned],
      dt,
      { gravity, drag },
    );
    const nextParticles = advanced.filter((p) => p.life > 0);

    return {
      config,
      accumulator: emit.next.accumulator,
      particles: nextParticles,
    };
  });
}
