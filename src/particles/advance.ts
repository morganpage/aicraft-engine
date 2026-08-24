import type { Particle } from './types';
import { DEFAULT_DRAG_SCALE, DEFAULT_GRAVITY_SCALE } from './constants';

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
 * Advance all particles by `dtTicks` ticks. Pure: returns a new array of new
 * particle objects; the input array and its particles are not mutated.
 *
 * ⚠ `dtTicks` is in TICKS (velocities are px/tick, `life` is ticks). For a
 * fixed step held in SECONDS use {@link advanceSeconds}, which converts —
 * passing a seconds dt here is a silent 60× unit error.
 *
 * Dead particles (`life <= 0` after advance) are NOT culled here — use
 * `cull()` or the convenience `step()` to remove them.
 *
 * Physics order per tick:
 *   1. Apply (world gravity × per-particle `gravityScale`) to `vy`.
 *   2. Apply (world drag × per-particle `dragScale`) to both `vx` and `vy`.
 *   3. Apply velocity to position.
 *   4. Decrement `life` by `dt`.
 *
 * Heterogeneous physics: optional per-particle `gravityScale`/`dragScale`
 * (default `1.0` via `??`) multiply the world-space gravity/drag for THAT
 * particle only. Particles without those fields produce byte-identical output
 * to the pre-extension math — the neutral scale is exactly `1.0`.
 *
 * ⚠ The return literal enumerates fields explicitly (it does NOT spread `...p`)
 * so that the optional `gravityScale`/`dragScale`/`color`/`colorEnd` fields
 * are copied through to the next tick. Dropping them here would silently
 * flatten every particle's physics profile back to neutral after one tick.
 */
export function advance(
  particles: readonly Particle[],
  dtTicks: number,
  opts: AdvanceOptions = {},
): Particle[] {
  const { gravity = 0, drag = 1 } = opts;
  return particles.map((p) => {
    const pGravity = gravity * (p.gravityScale ?? DEFAULT_GRAVITY_SCALE);
    const pDrag = drag * (p.dragScale ?? DEFAULT_DRAG_SCALE);
    const dragFactor = Math.pow(pDrag, dtTicks);
    const vx = p.vx * dragFactor;
    const vy = (p.vy + pGravity * dtTicks) * dragFactor;
    return {
      x: p.x + vx * dtTicks,
      y: p.y + vy * dtTicks,
      vx,
      vy,
      life: p.life - dtTicks,
      maxLife: p.maxLife,
      size: p.size,
      color: p.color,
      colorEnd: p.colorEnd,
      gravityScale: p.gravityScale,
      dragScale: p.dragScale,
    };
  });
}
