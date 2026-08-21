import { IDLE_EDGE, type PlatformerInput, type PolledEdge } from 'aicraft-engine';

/**
 * Derive the kernel's {@link PlatformerInput} from a merged per-tick edge map.
 *
 * The wiring every kernel game repeats after `mergePolledEdgeMaps`: horizontal
 * and vertical movement become signed `-1 | 0 | 1` from the held state of the
 * directional actions, and `jump`/`dash`/`grab` fall back to the engine's
 * frozen `IDLE_EDGE` singleton (mapped-but-not-pressed — `null` would DISABLE
 * the ability). `moveY` drives both ladder climb (`-1` = up) and fast-fall
 * (`+1` = down).
 *
 * @example
 * ```ts
 * // per fixed tick — poll each device exactly once, then merge, then derive:
 * const edges = mergePolledEdgeMaps(keyboard.poll(), gamepad.poll(), touch.poll());
 * const input = derivePlatformerInput(edges);
 * // edges['pause'] (etc.) is NOT consumed here — read it directly for your FSM.
 * ```
 */
/** Signed axis value from a held directional pair; both-held cancels to 0. */
function axisOf(neg: boolean, pos: boolean): -1 | 0 | 1 {
  if (neg === pos) return 0;
  return pos ? 1 : -1;
}

export function derivePlatformerInput(
  edges: Readonly<Record<string, PolledEdge>>,
): PlatformerInput {
  return {
    moveX: axisOf(edges['left']?.held ?? false, edges['right']?.held ?? false),
    moveY: axisOf(edges['up']?.held ?? false, edges['down']?.held ?? false),
    jump: edges['jump'] ?? IDLE_EDGE,
    dash: edges['dash'] ?? IDLE_EDGE,
    grab: edges['grab'] ?? IDLE_EDGE,
  };
}
