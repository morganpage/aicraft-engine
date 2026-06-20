/**
 * Defensive touch-button input adapter (host-touching layer).
 *
 * Tracks pointer events on a single DOM element and latches them into one
 * {@link EdgeAccumulator}: `pointerdown` → press; `pointerup` / `pointercancel`
 * / `pointerleave` → release. Follows the canonical defensive-adapter pattern
 * (`src/primitives/motion.ts`): lazy host access, swallow all errors,
 * never-throw, no-op fallback when the element is absent.
 *
 * Sets `element.style.touchAction = 'none'` on creation to prevent the browser
 * from intercepting the touch as a scroll / gesture (matches the canvas pattern
 * used by the lava-pool showcase).
 *
 * @module
 */

import { createEdgeAccumulator, pressEdge, releaseEdge, pollEdge } from './edges';
import type { EdgeAccumulator, PolledEdge, TouchButtonAdapter } from './types';

const IDLE: PolledEdge = { held: false, pressed: false, released: false };

/**
 * Create a touch-button input adapter for a single DOM element.
 *
 * When `element` is `null` (SSR, element not yet mounted, query failed), returns
 * a no-op adapter whose `poll()` returns an all-false snapshot. Never throws.
 *
 * @param element - The DOM element to track (e.g. an on-screen button div), or
 *   `null` when the element is unavailable.
 * @returns A defensive {@link TouchButtonAdapter}.
 *
 * @example
 * ```ts
 * const jumpBtn = createTouchButton(document.getElementById('jump-btn'));
 * // once per fixed tick:
 * const edge = jumpBtn.poll();
 * if (edge.pressed) bufferJump();
 * ```
 */
export function createTouchButton(element: HTMLElement | null): TouchButtonAdapter {
  if (element === null) {
    return {
      poll: () => IDLE,
      dispose: () => {
        // No element was ever attached.
      },
    };
  }

  const acc: EdgeAccumulator = createEdgeAccumulator();
  let disposed = false;

  const onDown = (): void => {
    pressEdge(acc);
  };
  const onUp = (): void => {
    releaseEdge(acc);
  };

  try {
    element.style.touchAction = 'none';
    element.addEventListener('pointerdown', onDown);
    element.addEventListener('pointerup', onUp);
    element.addEventListener('pointercancel', onUp);
    element.addEventListener('pointerleave', onUp);
  } catch {
    // A broken element never crashes the game.
  }

  return {
    poll(): PolledEdge {
      return pollEdge(acc);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      try {
        element.removeEventListener('pointerdown', onDown);
        element.removeEventListener('pointerup', onUp);
        element.removeEventListener('pointercancel', onUp);
        element.removeEventListener('pointerleave', onUp);
      } catch {
        // Swallow — idempotent teardown must not throw.
      }
    },
  };
}
