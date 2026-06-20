import { DEFAULT_INNER_RADIUS } from './constants';

/**
 * Discriminated union of spawn shapes. `point` returns `{x:0, y:0}` (relative
 * to the emitter origin); the others sample a coordinate within the shape.
 *
 * Used by `EmitterConfig.region` (Approach B) and standalone `sampleRegion`
 * (Approach A). Pure data — serializable for editor tools.
 */
export type SpawnRegion =
  | { type: 'point' }
  | { type: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { type: 'rect'; x: number; y: number; w: number; h: number }
  | {
      type: 'circle';
      cx: number;
      cy: number;
      radius: number;
      /** Inner radius for ring sampling. `DEFAULT_INNER_RADIUS` (0) → filled disk. */
      innerRadius?: number;
    };

/**
 * Deterministically sample a coordinate from a `SpawnRegion` using a seeded
 * RNG. Pure; consumes a fixed number of RNG draws per shape:
 * - `point`: 0 draws
 * - `line`: 1 draw
 * - `rect`: 2 draws
 * - `circle`: 2 draws
 *
 * The fixed-draws-per-shape property matters for RNG stream isolation: a
 * consumer auditing stream usage can predict exactly how many values a given
 * region will consume per particle.
 *
 * Circle sampling uses `r = sqrt(inner² + t·(R² - inner²))` for uniform area
 * distribution (avoids the cluster-at-center artifact of `r = t·R`). Drawn
 * from research note `docs/research/particle-emitters.md` Pattern 2.
 *
 * @param region - spawn shape descriptor
 * @param rng - seeded RNG function (e.g. `mulberry32(seed)`)
 * @returns a sampled `{x, y}` coordinate
 *
 * @example
 * ```ts
 * import { mulberry32 } from '../rng';
 * import { sampleRegion } from './regions';
 * const pos = sampleRegion({ type: 'line', x1: 0, y1: 0, x2: 60, y2: 0 }, mulberry32(1));
 * ```
 */
export function sampleRegion(
  region: SpawnRegion,
  rng: () => number,
): { x: number; y: number } {
  switch (region.type) {
    case 'point':
      return { x: 0, y: 0 };
    case 'line': {
      const t = rng();
      return {
        x: region.x1 + t * (region.x2 - region.x1),
        y: region.y1 + t * (region.y2 - region.y1),
      };
    }
    case 'rect': {
      return {
        x: region.x + rng() * region.w,
        y: region.y + rng() * region.h,
      };
    }
    case 'circle': {
      const angle = rng() * Math.PI * 2;
      const inner = region.innerRadius ?? DEFAULT_INNER_RADIUS;
      const t = rng();
      const r = Math.sqrt(
        inner * inner + t * (region.radius * region.radius - inner * inner),
      );
      return {
        x: region.cx + Math.cos(angle) * r,
        y: region.cy + Math.sin(angle) * r,
      };
    }
  }
}
