/**
 * Defensive keyboard input adapter (host-touching layer).
 *
 * Maps `KeyboardEvent.code` values to logical actions and latches press /
 * release / blur events into one {@link EdgeAccumulator} per action. Follows
 * the canonical defensive-adapter pattern (`src/primitives/motion.ts`):
 *
 *   - **Lazy host resolution** — `window` is resolved INSIDE
 *     {@link createKeyboardAdapter}, never at module load, so the module is
 *     safe to import in Node / SSR / test environments where `window` is
 *     undefined.
 *   - **Swallow all errors** — any `addEventListener` / `removeEventListener`
 *     failure is caught; a broken `window` never crashes the game.
 *   - **Never-throw public API** — `poll()` / `dispose()` degrade gracefully.
 *
 * Behavioural contract:
 *   - `keydown` with `!e.repeat`: looks up `e.code` in `config.codeToAction`;
 *     if mapped, calls `pressEdge` on that action's accumulator. Auto-repeat
 *     (`e.repeat === true`) is ignored so a held key fires only ONE pressed edge.
 *   - `keyup`: looks up `e.code`; if mapped, calls `releaseEdge`.
 *   - window `blur`: resets ALL accumulators (prevents stuck keys when the user
 *     tabs away mid-press).
 *   - Multiple codes mapping to the same action share ONE accumulator.
 *
 * @module
 */

import {
  createEdgeAccumulator,
  pressEdge,
  releaseEdge,
  resetEdge,
  pollEdge,
} from './edges';
import type { EdgeAccumulator, KeyboardAdapter, KeyboardConfig, PolledEdge } from './types';

/**
 * Create a keyboard input adapter for the given code-to-action mapping.
 *
 * Lazily resolves `window` at call time (NOT at module load). When `window` is
 * undefined (Node, SSR, test env), returns a no-op adapter whose `poll()`
 * returns an empty record `{}` — the keyboard contributes nothing, so the
 * consumer's OR-merge with other devices is trivial. Never throws.
 *
 * @param config - Code-to-action mapping (see {@link KeyboardConfig}).
 * @returns A defensive {@link KeyboardAdapter}.
 *
 * @example
 * ```ts
 * const keyboard = createKeyboardAdapter({
 *   codeToAction: { ArrowLeft: 'left', ArrowRight: 'right', Space: 'jump' },
 * });
 * // once per fixed tick:
 * const edges = keyboard.poll();
 * if (edges['jump']?.pressed) bufferJump();
 * ```
 */
export function createKeyboardAdapter(config: KeyboardConfig): KeyboardAdapter {
  if (typeof window === 'undefined') {
    return {
      poll: () => ({}),
      dispose: () => {
        // No host was ever attached.
      },
    };
  }

  const codeToAction = config.codeToAction;
  const accs = new Map<string, EdgeAccumulator>();
  for (const action of Object.values(codeToAction)) {
    if (!accs.has(action)) accs.set(action, createEdgeAccumulator());
  }

  let disposed = false;

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    if (!(e.code in codeToAction)) return;
    const acc = accs.get(codeToAction[e.code]);
    if (acc) pressEdge(acc);
  };

  const onKeyUp = (e: KeyboardEvent): void => {
    if (!(e.code in codeToAction)) return;
    const acc = accs.get(codeToAction[e.code]);
    if (acc) releaseEdge(acc);
  };

  const onBlur = (): void => {
    for (const acc of accs.values()) resetEdge(acc);
  };

  try {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
  } catch {
    // A broken window never crashes the game.
  }

  return {
    poll(): Record<string, PolledEdge> {
      const out: Record<string, PolledEdge> = {};
      for (const [action, acc] of accs) {
        out[action] = pollEdge(acc);
      }
      return out;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      try {
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', onBlur);
      } catch {
        // Swallow — idempotent teardown must not throw.
      }
    },
  };
}
