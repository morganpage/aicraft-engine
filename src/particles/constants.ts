/**
 * Named defaults for the particles pillar. No magic numbers in the solver —
 * consumers and downstream modules read these for the neutral-scale contract.
 *
 * Mirrors the `DEFAULT_*` constant pattern in `src/animation/` and
 * `src/palette/`. The values are the neutral points where a particle behaves
 * exactly as it did before the heterogeneous-physics extension shipped
 * (`scale = 1.0` ⇒ identical math to the pre-extension `advance`).
 */

/**
 * Neutral per-particle gravity multiplier. Particles without an explicit
 * `gravityScale` use this, producing byte-identical physics to the
 * pre-extension `advance`.
 */
export const DEFAULT_GRAVITY_SCALE = 1.0;

/**
 * Neutral per-particle drag multiplier. Same byte-identity contract as
 * `DEFAULT_GRAVITY_SCALE`.
 */
export const DEFAULT_DRAG_SCALE = 1.0;

/**
 * Neutral per-call emission-rate multiplier. Omitting `rateScale` in
 * `StepEmittersOptions` yields full-rate emission (no reduced-motion damping).
 */
export const DEFAULT_RATE_SCALE = 1.0;

/**
 * Default inner radius for circle region sampling. `0` means a filled disk
 * (no hole). A positive value turns the region into a ring of width
 * `[innerRadius, radius]`.
 */
export const DEFAULT_INNER_RADIUS = 0;
