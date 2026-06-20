/**
 * Pure edge accumulator — the DOM-free core of input edge/coalescing logic.
 *
 * Device handlers (`createKeyboardAdapter`, `createTouchButton`) feed discrete
 * press/release events into one {@link EdgeAccumulator} per logical action.
 * `pollEdge()` is called once per fixed tick; it returns the current held
 * state plus the pressed/released edges accumulated since the previous poll,
 * then clears those edges so each edge fires for exactly ONE tick.
 *
 * Coalescing decision (intentional, non-obvious):
 * Edges are latched as booleans (`pressedSincePoll` / `releasedSincePoll`) the
 * instant the event arrives, NOT derived from a held-state diff. This means a
 * full press AND release that happen between two polls BOTH surface on the
 * next poll: `pressed=true AND released=true, held=false`. For jump this is
 * desirable — the press still buffers the jump and the release still triggers
 * jump-cut. A held-state diff would silently swallow such a quick tap, so we
 * deliberately do NOT use a diff.
 *
 * No DOM, no globals — safe to unit test under Node / vitest (no jsdom needed).
 *
 * Ported from Spitekeep's `src/input/edges.ts`.
 */

import type { EdgeAccumulator, PolledEdge } from './types';

/** Create a fresh accumulator in the idle (nothing held, no pending edges) state. */
export function createEdgeAccumulator(): EdgeAccumulator {
  return { held: false, pressedSincePoll: false, releasedSincePoll: false };
}

/**
 * Record a press event (keydown with `!e.repeat`, or pointerdown).
 *
 * Sets `held` true and latches the pressed edge. Calling this multiple times
 * before a poll is harmless: `held` stays true and the edge stays latched
 * (still fires only once on the next poll). This is what makes multi-touch on
 * a single button and stray double-events safe.
 *
 * Mutates `acc` in place — see the {@link EdgeAccumulator} mutability rationale.
 */
export function pressEdge(acc: EdgeAccumulator): void {
  acc.held = true;
  acc.pressedSincePoll = true;
}

/**
 * Record a release event (keyup, or pointerup / pointercancel / pointerleave).
 *
 * Clears `held` and latches the released edge. Multiple releases before a poll
 * coalesce to a single released edge on the next poll.
 *
 * Mutates `acc` in place — see the {@link EdgeAccumulator} mutability rationale.
 */
export function releaseEdge(acc: EdgeAccumulator): void {
  acc.held = false;
  acc.releasedSincePoll = true;
}

/**
 * Reset to the fully idle state — used on window blur / dispose / level load to
 * prevent stuck keys and stale edges.
 *
 * Mutates `acc` in place.
 */
export function resetEdge(acc: EdgeAccumulator): void {
  acc.held = false;
  acc.pressedSincePoll = false;
  acc.releasedSincePoll = false;
}

/**
 * Read the accumulated edge state for THIS tick and clear the edge latches.
 *
 * `held` reflects the live state at call time and persists; `pressed` and
 * `released` are the one-tick edges and are cleared after being read, so the
 * next poll will not re-fire them. This is the guarantee the deterministic
 * core relies on: `jumpPressed` / `jumpReleased` are true for exactly one tick.
 *
 * Mutates `acc` in place (clears the edge latches) and returns a fresh snapshot.
 */
export function pollEdge(acc: EdgeAccumulator): PolledEdge {
  const out: PolledEdge = {
    held: acc.held,
    pressed: acc.pressedSincePoll,
    released: acc.releasedSincePoll,
  };
  acc.pressedSincePoll = false;
  acc.releasedSincePoll = false;
  return out;
}
