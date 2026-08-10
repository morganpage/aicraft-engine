/**
 * Pure merge helpers for polled input edges.
 *
 * Extracted from the per-tick merge step so it can be unit-tested under Node
 * with no DOM. The merge rule: held is OR'd across sources (either device
 * holding = held); pressed / released edges are OR'd (either device producing
 * the edge = the edge fires this tick).
 *
 * @module
 */

import type { PolledEdge } from './types';

/**
 * Pure OR-merge of two polled edge snapshots for the SAME action (e.g.
 * keyboard + touch for `'jump'`). `held` is OR'd; `pressed` / `released`
 * edges are OR'd.
 *
 * Pure: never mutates either input; returns a fresh object each call.
 *
 * @param a - One source snapshot (e.g. keyboard).
 * @param b - Other source snapshot (e.g. touch).
 * @returns A new {@link PolledEdge} combining both sources via OR.
 *
 * @example
 * ```ts
 * const jump = orEdges(keyboardPoll['jump'], touchJumpPoll);
 * if (jump.pressed) bufferJump();
 * ```
 */
export function orEdges(a: PolledEdge, b: PolledEdge): PolledEdge {
  return {
    held: a.held || b.held,
    pressed: a.pressed || b.pressed,
    released: a.released || b.released,
  };
}
