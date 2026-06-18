/**
 * Particle type. Pure data — no methods, no behavior.
 *
 * Matches Spitekeep `config/types.ts:140`:
 *   `{ x, y, vx, vy, life, maxLife, size }` with an optional color.
 *
 * Particles are treated as immutable by `advance()` and `cull()`: operations
 * return new arrays of new particle objects. Callers must not mutate particles
 * in place unless they own them exclusively (e.g. inside a render frame).
 */
export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Remaining ticks of life. When <= 0 the particle is dead. */
  life: number;
  /** Initial life, for fade/scale calculations. */
  maxLife: number;
  size: number;
  /** Optional color override. When omitted, the renderer picks a default. */
  color?: string;
}
