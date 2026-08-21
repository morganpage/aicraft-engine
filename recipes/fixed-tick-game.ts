import {
  createGameLoop,
  prefersReducedMotion,
  type GameLoop,
  type GameLoopConfig,
} from 'aicraft-engine';

/** Configuration for {@link startFixedTickGame}. */
export interface FixedTickGameConfig extends GameLoopConfig {
  /**
   * Reduced-motion probe. Defaults to the engine's `prefersReducedMotion()`.
   * Inject a stub (`() => true` / `() => false`) for tests or to force the
   * gate from a settings menu.
   */
  readonly reducedMotion?: () => boolean;
}

/**
 * Boot the fixed-step loop behind the reduced-motion gate every brief specifies:
 * when the probe returns `true`, render exactly ONE static frame and never
 * start the loop; otherwise start normally.
 *
 * This is thin by design — it forwards `fixedDt` / `maxFrameDelta` / `onError` /
 * `errorPolicy` to `createGameLoop` unchanged and adds only the gate. The
 * static-frame render is wrapped defensively so a throwing first render can
 * never crash boot (the loop itself would have swallowed it too).
 *
 * @param config - the loop configuration plus an optional reduced-motion probe
 * @returns the {@link GameLoop} handle (NOT started when reduced motion is on)
 *
 * @example
 * ```ts
 * const loop = startFixedTickGame({
 *   step: (dt) => { world = stepWorld(world, input.poll(), dt); },
 *   render: (alpha) => drawFrame(ctx, alpha),
 * });
 * ```
 */
export function startFixedTickGame(config: FixedTickGameConfig): GameLoop {
  const probe = config.reducedMotion ?? prefersReducedMotion;
  const { reducedMotion: _ignored, ...loopConfig } = config;

  const loop = createGameLoop(loopConfig);
  let reduced = false;
  try {
    reduced = probe();
  } catch {
    // A broken probe must not crash boot — treat as no preference.
  }

  if (reduced) {
    try {
      config.render(0);
    } catch {
      // Swallow — matches the loop's own render error containment.
    }
    return loop;
  }

  loop.start();
  return loop;
}
