/**
 * Easing & Tween pillar — pure Penner easing curves plus a stateless,
 * fixed-step tween driver.
 *
 * Two modules for tree-shaking:
 *   - `curves.ts` — pure `(t: number) => number` curves + `powOut` +
 *     `easeIn` / `easeInOut` inversion helpers. Import alone for particle
 *     lifetime curves and one-shot remaps.
 *   - `tween.ts` — consumer-owned `TweenState` + pure `advanceTween` driver
 *     mirroring the `advanceEmission` / `advanceJump` progression-ops pattern.
 *
 * All exports are pure, deterministic, zero-dependency, and never throw.
 */
export {
  linear,
  powOut,
  easeOutQuad,
  easeOutCubic,
  easeOutQuart,
  easeOutQuint,
  easeOutSine,
  easeOutExpo,
  easeOutCirc,
  easeOutBack,
  easeOutElastic,
  easeOutBounce,
  easeIn,
  easeInOut,
} from './curves';
export {
  createTweenState,
  advanceTween,
} from './tween';
export type {
  TweenState,
  TweenConfig,
  TweenSeedConfig,
  TweenResult,
} from './tween';
