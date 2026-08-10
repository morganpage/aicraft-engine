/**
 * Particle type. Pure data — no methods, no behavior.
 *
 * Reference shape:
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
  /**
   * Per-particle gravity multiplier applied to the world gravity in `advance`.
   * Missing/undefined → `DEFAULT_GRAVITY_SCALE` (1.0, no override). Negative
   * values invert gravity (smoke rising); `0` cancels it entirely. Enables
   * heterogeneous physics — a single particle array can mix fire (positive
   * scale, falls back) and smoke (negative scale, rises).
   */
  gravityScale?: number;
  /**
   * Per-particle drag multiplier applied to the world drag in `advance`.
   * Missing/undefined → `DEFAULT_DRAG_SCALE` (1.0, no override).
   */
  dragScale?: number;
}
