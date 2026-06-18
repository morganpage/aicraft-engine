import type { Particle } from './types';

export interface AdvanceOptions {
  /** Per-tick downward acceleration. Default `0`. */
  gravity?: number;
  /**
   * Per-tick velocity multiplier. `1` = no drag, `0.9` = 10% energy lost
   * per tick. Default `1`. Applied symmetrically to both axes.
   */
  drag?: number;
}

/**
 * Advance all particles by `dt` ticks. Pure: returns a new array of new
 * particle objects; the input array and its particles are not mutated.
 *
 * Dead particles (`life <= 0` after advance) are NOT culled here — use
 * `cull()` or the convenience `step()` to remove them.
 *
 * Physics order per tick:
 *   1. Apply gravity to `vy`.
 *   2. Apply drag multiplier to both `vx` and `vy`.
 *   3. Apply velocity to position.
 *   4. Decrement `life` by `dt`.
 */
export function advance(
  particles: readonly Particle[],
  dt: number,
  opts: AdvanceOptions = {},
): Particle[] {
  const { gravity = 0, drag = 1 } = opts;
  const dragFactor = Math.pow(drag, dt);
  return particles.map((p) => {
    const vx = p.vx * dragFactor;
    const vy = (p.vy + gravity * dt) * dragFactor;
    return {
      x: p.x + vx * dt,
      y: p.y + vy * dt,
      vx,
      vy,
      life: p.life - dt,
      maxLife: p.maxLife,
      size: p.size,
      color: p.color,
    };
  });
}
