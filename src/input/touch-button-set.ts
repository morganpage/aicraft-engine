/**
 * Defensive multi-touch touch-button SET input adapter (host-touching layer).
 *
 * Tracks pointer events across N DOM elements, latching each element's state
 * into its own {@link EdgeAccumulator} with per-element `Set<pointerId>`
 * tracking so two fingers on the SAME button do not double-fire presses or
 * spurious releases (the load-bearing multi-touch-safe invariant: `0→≥1`
 * press / `1→0` release). Adds a global safety net on `document` for
 * `pointerup` / `pointercancel` / `pointerleave` so a pointer that exits the
 * viewport without a clean per-element `pointerup` (e.g. swipe to the
 * notification bar, edge gesture, OS interruption) cannot leave a button
 * stuck — the character stops walking the moment the finger leaves.
 *
 * Follows the canonical defensive-adapter pattern
 * (`src/primitives/motion.ts`), mirroring {@link createTouchButton} and
 * {@link createKeyboardAdapter}:
 *   - **Lazy host resolution** — `window` is resolved INSIDE
 *     {@link createTouchButtonSet}, never at module load, so the module is
 *     safe to import in Node / SSR / test environments where `window` is
 *     undefined.
 *   - **SSR guard** — short-circuits to a no-op adapter when
 *     `typeof window === 'undefined'`. The no-op still returns an
 *     array of idle {@link PolledEdge} entries matching `elements.length`,
 *     so consumer destructuring (`const [left, right] = set.poll()`) works
 *     identically in SSR and live environments.
 *   - **Swallow all errors** — every `addEventListener` /
 *     `removeEventListener` / `style.touchAction` assignment is wrapped in
 *     try/catch. A broken element or `document` never crashes the game.
 *   - **Never-throw public API** — `poll()` / `dispose()` degrade gracefully.
 *
 * Sets `element.style.touchAction = 'none'` on each non-null element to
 * prevent the browser from intercepting touches as scroll / pinch-zoom /
 * gesture (without it, mobile play is impossible). Matches the existing
 * {@link createTouchButton} pattern.
 *
 * Why a new adapter (vs. N × `createTouchButton` + `orEdges`):
 *   - Per-element `pointerId` set tracking fixes the same-button multi-touch
 *     cross-talk bug.
 *   - The global `document` safety net fixes the stuck-button bug where a
 *     viewport-exit `pointerleave` is missed by per-element handlers.
 *
 * Decision record: `docs/design/mobile-directional-input-decision.md`.
 * Proposal: `docs/design/mobile-directional-input-proposal.md` (Approach B).
 *
 * @module
 */

import { createEdgeAccumulator, pressEdge, releaseEdge, pollEdge } from './edges';
import type {
  EdgeAccumulator,
  PolledEdge,
  TouchButtonSetAdapter,
  TouchButtonSetConfig,
} from './types';

const IDLE: PolledEdge = { held: false, pressed: false, released: false };

interface Slot {
  element: HTMLElement | null;
  acc: EdgeAccumulator;
  pointers: Set<number>;
  onDown: ((e: PointerEvent) => void) | null;
  onUp: ((e: PointerEvent) => void) | null;
}

/**
 * Create a multi-touch-safe touch-button set adapter for N DOM elements.
 *
 * @param config - Set config (see {@link TouchButtonSetConfig}).
 * @returns A defensive {@link TouchButtonSetAdapter} whose `poll()` returns
 *   one {@link PolledEdge} per input element, array-aligned. Null elements
 *   produce an idle slot. In Node / SSR (no `window`), returns a no-op
 *   adapter whose `poll()` still returns an idle array of the right length.
 *   Never throws.
 *
 * @example
 * ```ts
 * const dpad = createTouchButtonSet({
 *   elements: [
 *     document.getElementById('btn-left'),
 *     document.getElementById('btn-right'),
 *   ],
 * });
 * // once per fixed tick:
 * const [left, right] = dpad.poll();
 * if (left.pressed) startMovingLeft();
 * if (right.released) stopMovingRight();
 * ```
 */
export function createTouchButtonSet(config: TouchButtonSetConfig): TouchButtonSetAdapter {
  const elements = config.elements;
  const slotCount = elements.length;

  if (typeof window === 'undefined') {
    return {
      poll: (): PolledEdge[] =>
        Array.from({ length: slotCount }, (): PolledEdge => IDLE),
      dispose: (): void => {
        // No host was ever attached.
      },
    };
  }

  const slots: Slot[] = new Array(slotCount);
  for (let i = 0; i < slotCount; i++) {
    slots[i] = {
      element: elements[i],
      acc: createEdgeAccumulator(),
      pointers: new Set<number>(),
      onDown: null,
      onUp: null,
    };
  }

  const pointerToSlotIndex = new Map<number, number>();
  let disposed = false;

  const releasePointer = (slotIndex: number, pointerId: number): void => {
    const slot = slots[slotIndex];
    if (!slot || !slot.pointers.has(pointerId)) return;
    slot.pointers.delete(pointerId);
    pointerToSlotIndex.delete(pointerId);
    if (slot.pointers.size === 0) {
      releaseEdge(slot.acc);
    }
  };

  for (let i = 0; i < slotCount; i++) {
    const slot = slots[i];
    const element = slot.element;
    if (!element) continue;

    const onDown = (e: PointerEvent): void => {
      const wasEmpty = slot.pointers.size === 0;
      slot.pointers.add(e.pointerId);
      pointerToSlotIndex.set(e.pointerId, i);
      if (wasEmpty) pressEdge(slot.acc);
    };
    const onUp = (e: PointerEvent): void => {
      releasePointer(i, e.pointerId);
    };
    slot.onDown = onDown;
    slot.onUp = onUp;

    try {
      element.style.touchAction = 'none';
    } catch {
      // Cross-origin iframe or restricted element — swallow.
    }
    try {
      element.addEventListener('pointerdown', onDown);
      element.addEventListener('pointerup', onUp);
      element.addEventListener('pointercancel', onUp);
      element.addEventListener('pointerleave', onUp);
    } catch {
      // Broken element never crashes the game.
    }
  }

  const onGlobalPointerEnd = (e: PointerEvent): void => {
    const slotIndex = pointerToSlotIndex.get(e.pointerId);
    if (slotIndex === undefined) return;
    releasePointer(slotIndex, e.pointerId);
  };

  try {
    document.addEventListener('pointerup', onGlobalPointerEnd);
    document.addEventListener('pointercancel', onGlobalPointerEnd);
    document.addEventListener('pointerleave', onGlobalPointerEnd);
  } catch {
    // Broken document never crashes the game.
  }

  return {
    poll(): PolledEdge[] {
      const out: PolledEdge[] = new Array(slotCount);
      for (let i = 0; i < slotCount; i++) {
        out[i] = pollEdge(slots[i].acc);
      }
      return out;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (let i = 0; i < slotCount; i++) {
        const slot = slots[i];
        const element = slot.element;
        if (!element) continue;
        try {
          if (slot.onDown) element.removeEventListener('pointerdown', slot.onDown);
          if (slot.onUp) {
            element.removeEventListener('pointerup', slot.onUp);
            element.removeEventListener('pointercancel', slot.onUp);
            element.removeEventListener('pointerleave', slot.onUp);
          }
        } catch {
          // Swallow — idempotent teardown must not throw.
        }
      }
      try {
        document.removeEventListener('pointerup', onGlobalPointerEnd);
        document.removeEventListener('pointercancel', onGlobalPointerEnd);
        document.removeEventListener('pointerleave', onGlobalPointerEnd);
      } catch {
        // Swallow — idempotent teardown must not throw.
      }
    },
  };
}
