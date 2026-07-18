import type { EmitterConfig } from './emitter';

/**
 * Tuned particle-emitter presets + surface colors.
 *
 * The showcase hand-tunes several emitter recipes (lava fire / smoke, and a
 * derived water-bubble preset) to get a specific look. The engine ships the
 * primitives (`createEmitter`, `stepEmitters`) but NOT those recipes —
 * consumers were forced to re-invent mediocre params from scratch (a real
 * consumer game shipped a lava pool that barely flickered because it guessed
 * at the values). This module ships the tuned recipes as read-only constants
 * so a consumer gets the showcase look by default: spread a preset into
 * `createEmitter` and supply only the per-instance `region` + `rng`.
 *
 * ## Units (read this before tuning — this is the footgun)
 *
 * All presets are in **TICK units**: one simulation step = one tick. The
 * showcase steps with `dt = 1` every tick (a fixed-step accumulator at 60 Hz
 * that fires one `step` callback per accumulated tick). Concretely:
 *   - `rate`  is particles-per-tick,
 *   - `life`  is ticks,
 *   - `gravityScale` / `dragScale` are per-tick multipliers applied on top of
 *     the world `gravity` / `drag` you pass to `stepEmitters`.
 *
 * Pairing contract: pass the SAME `dt` units to `stepEmitters` that the
 * preset was tuned for. For these presets that is `dt = 1` (one tick):
 *
 * ```ts
 * emitters = stepEmitters(emitters, 1, { gravity: 0.5 });
 * ```
 *
 * If your game runs in SECONDS (e.g. `dt = 1/60`), you MUST either (a)
 * convert the preset's `rate` / `life` into per-second units before building
 * the emitter, or (b) rescale your `dt` so one tick maps to the preset's tick
 * (multiply your seconds-valued `dt` by 60). Mixing tick-unit presets with a
 * seconds-valued `dt` produces particles that emit ~60× too slow and live
 * ~60× too long — the exact mistake the consumer game made.
 *
 * ## Shared-world-gravity limitation (known footgun, tracked separately)
 *
 * `stepEmitters` takes a SINGLE shared world `gravity` / `drag` for every
 * emitter in the call (see `StepEmittersOptions`). Heterogeneous behaviour
 * (fire falls back, smoke rises) is achieved ONLY via the per-particle
 * `gravityScale` / `dragScale` baked into each preset. There is currently no
 * per-emitter world-gravity override on `EmitterConfig`. The lava recipe
 * works around this by pairing BOTH emitters with the same world
 * `gravity: 0.5` and differing only in `gravityScale` (0.4 fire vs -0.4 smoke
 * — smoke NEGATES the shared world gravity to rise).
 *
 * TODO(per-emitter-gravity): add an optional per-emitter world-gravity /
 * world-drag override on `EmitterConfig` so heterogeneous scenes stop sharing
 * a single world gravity. Out of scope for this preset task — the engine's
 * `stepEmitters` signature is unchanged here. Flagged as an escalation
 * candidate for `@api-designer`.
 */

/**
 * Shape of a particle preset: a `createEmitter` config with the per-instance
 * `region` and `rng` fields omitted. Spread a preset into `createEmitter` and
 * supply those two fields yourself:
 *
 * ```ts
 * const fire = createEmitter({ ...LAVA_FIRE_PARTICLES, region, rng });
 * ```
 *
 * `Readonly` so consumers can't accidentally mutate the shared preset object
 * (which would leak across every emitter that spread it). Every preset ships
 * the tuned `rate`, `cone`, `life`, `size`, and (where meaningful) `color`,
 * `gravityScale`, `dragScale`.
 */
export type ParticlePreset = Readonly<Omit<EmitterConfig, 'region' | 'rng'>>;

/**
 * Lava fire emitter — bright-orange sparks that arc up then fall back as
 * cooling embers. Values are verbatim from the lava-pool showcase's `FIRE_*`
 * constants.
 *
 * Tuned values:
 *   - `rate` 2 particles/tick → steady-state ≈ 60 in flight (`rate × life`).
 *   - `cone` straight up (`-π/2`), narrow `π/3` (60°) column, speed 3–5 px/tick.
 *   - `gravityScale` 0.4 → effective gravity `0.5 × 0.4 = 0.2`/tick². Weak
 *     pull-back so sparks climb ~30–40 px before falling as embers.
 *   - `dragScale` 0.99 → ~1% energy lost per tick (smooth arc trajectory).
 *   - `life` 30 ticks, `size` 3 px base, `color` `#FFAA00`.
 *
 * Pair with `stepEmitters(emitters, 1, { gravity: 0.5 })` to reproduce the
 * showcase look (world gravity 0.5 px/tick²). Omitting `gravity` — or passing
 * a different value — changes the arc height noticeably. Tick units: `dt = 1`.
 *
 * @example
 * ```ts
 * import { mulberry32 } from '../rng';
 * import { createEmitter, stepEmitters, LAVA_FIRE_PARTICLES } from '../particles';
 *
 * const fire = createEmitter({
 *   ...LAVA_FIRE_PARTICLES,
 *   region: { type: 'line', x1: 0, y1: 200, x2: 480, y2: 200 },
 *   rng: mulberry32(42),
 * });
 * let emitters = [fire];
 * // Each tick (tick units → dt = 1):
 * emitters = stepEmitters(emitters, 1, { gravity: 0.5 });
 * ```
 */
export const LAVA_FIRE_PARTICLES: ParticlePreset = {
  rate: 2,
  cone: { baseAngle: -Math.PI / 2, spread: Math.PI / 3, speedMin: 3.0, speedMax: 5.0 },
  gravityScale: 0.4,
  dragScale: 0.99,
  life: 30,
  size: 3,
  color: '#FFAA00',
};

/**
 * Lava smoke emitter — grey buoyant plume that billows upward against world
 * gravity. Values are verbatim from the lava-pool showcase's `SMOKE_*`
 * constants.
 *
 * Tuned values:
 *   - `rate` 0.8 particles/tick → steady-state ≈ 48 in flight.
 *   - `cone` straight up (`-π/2`), WIDE `π/2` (90°) — smoke billows outward
 *     where fire columns. Speed 0.5–1.5 px/tick (slow drift).
 *   - `gravityScale` -0.4 → effective gravity `0.5 × -0.4 = -0.2`/tick².
 *     NEGATES the shared world gravity so smoke rises (buoyant).
 *   - `dragScale` 0.99 → ~1% energy lost per tick (slow drift).
 *   - `life` 60 ticks (long-lived — smoke lingers), `size` 6 px base,
 *     `color` `#888888`.
 *
 * Pair with the SAME `stepEmitters(emitters, 1, { gravity: 0.5 })` call as
 * `LAVA_FIRE_PARTICLES` — both emitters share one world gravity; they differ
 * only in their per-particle `gravityScale` (see the module-level shared-
 * gravity limitation note). Tick units: `dt = 1`.
 *
 * @example
 * ```ts
 * const smoke = createEmitter({
 *   ...LAVA_SMOKE_PARTICLES,
 *   region: { type: 'line', x1: 0, y1: 200, x2: 480, y2: 200 },
 *   rng: mulberry32(99),
 * });
 * [fire, smoke] = stepEmitters([fire, smoke], 1, { gravity: 0.5 });
 * ```
 */
export const LAVA_SMOKE_PARTICLES: ParticlePreset = {
  rate: 0.8,
  cone: { baseAngle: -Math.PI / 2, spread: Math.PI / 2, speedMin: 0.5, speedMax: 1.5 },
  gravityScale: -0.4,
  dragScale: 0.99,
  life: 60,
  size: 6,
  color: '#888888',
};

/**
 * Bright orange surface crust stroke color — mirrors the fire color family so
 * the lava surface reads as the top of the molten body. Verbatim from the
 * showcase's `COLOR_LAVA_SURFACE`. Use as the `strokeStyle` for the surface
 * polyline.
 */
export const LAVA_SURFACE_COLOR = '#ff6a00';

/**
 * Deep red lava body fill — saturated enough to read as molten, dark enough
 * to contrast with `LAVA_SURFACE_COLOR`. Verbatim from the showcase's
 * `COLOR_LAVA_BODY`. Use as the `fillStyle` for the lava body polygon.
 */
export const LAVA_BODY_COLOR = '#7a0a0a';

/**
 * Water bubble emitter — light-blue bubbles that rise slowly through water
 * and pop at the surface.
 *
 * NOTE: this preset is DERIVED, not showcase-tuned (no water section ships in
 * the showcase yet). The values mirror the lava recipe's tick-units
 * discipline and express the physics of air-in-water: strong buoyancy
 * (negative gravityScale) fighting high water drag (low dragScale). Tune to
 * taste; treat as a sensible starting point, not a ratified look.
 *
 * Derived values:
 *   - `rate` 0.5 particles/tick (sparse — bubbles are intermittent).
 *   - `cone` straight up (`-π/2`), `π/4` (45°) wobble, speed 0.5–1.5 px/tick
 *     (slow rise).
 *   - `gravityScale` -0.2 → effective gravity `0.5 × -0.2 = -0.1`/tick².
 *     Gentle upward acceleration; less aggressive than smoke because water is
 *     denser and bubbles should rise at a visible-but-lazy pace.
 *   - `dragScale` 0.95 → ~5% energy lost per tick (significant — water
 *     resistance). Much higher loss than air particles.
 *   - `life` 40 ticks, `size` 2 px (small), `color` `#a0d8ff` (light blue).
 *
 * Pair with `stepEmitters(emitters, 1, { gravity: 0.5 })` to match the lava
 * recipe's world gravity. Tick units: `dt = 1`.
 *
 * @example
 * ```ts
 * const bubbles = createEmitter({
 *   ...WATER_BUBBLE_PARTICLES,
 *   region: { type: 'rect', x: 0, y: 150, w: 480, h: 100 },
 *   rng: mulberry32(7),
 * });
 * emitters = stepEmitters([bubbles], 1, { gravity: 0.5 });
 * ```
 */
export const WATER_BUBBLE_PARTICLES: ParticlePreset = {
  rate: 0.5,
  cone: { baseAngle: -Math.PI / 2, spread: Math.PI / 4, speedMin: 0.5, speedMax: 1.5 },
  gravityScale: -0.2,
  dragScale: 0.95,
  life: 40,
  size: 2,
  color: '#a0d8ff',
};

/**
 * Water surface stroke color — a clear mid-blue for the surface polyline.
 * DERIVED (no showcase water section); pair with `WATER_BUBBLE_PARTICLES`.
 */
export const WATER_SURFACE_COLOR = '#2a7ad4';
