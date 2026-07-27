/**
 * Moving-platform carry tracker.
 *
 * Per the locked update order (decision §"Update order locked" step 2), the
 * kernel must apply a riding solid's displacement to the actor BEFORE ability
 * processing each tick. This module is the pure helper for that step.
 *
 * The kernel does NOT track which solid the actor is riding itself — that is
 * derived each tick from `core.contacts.groundId` (set during the previous
 * tick's collision-resolution step). The consumer owns the displacement
 * source: they call their own platform animator (e.g. `advanceGapMotion`)
 * before invoking the kernel and provide a `SolidDisplacementProvider`
 * callback that returns the per-tick displacement for a given solid id.
 *
 * Pure: takes an immutable `ActorCore`, returns a new shallow-copied core;
 * never mutates input. Never throws.
 *
 * @module
 */

import type { ActorCore } from './types';

/**
 * Per-tick displacement of a moving solid in world units. The kernel adds
 * this to a riding actor's position before ability processing.
 */
export interface SolidDisplacement {
  /** Horizontal displacement in px/s this tick. */
  readonly dx: number;
  /** Vertical displacement in px/s this tick. */
  readonly dy: number;
}

/**
 * Consumer-provided callback that returns the displacement of a solid by id,
 * or `null` if the solid is not moving (or unknown). Called by
 * `applyRidingCarry` once per tick per riding actor.
 *
 * Implementations MUST be deterministic for replay (`solidId` → fixed
 * displacement given the same tick). Reading from a deterministic motion
 * state (like `advanceGapMotion`) satisfies this.
 */
export type SolidDisplacementProvider = (solidId: string) => SolidDisplacement | null;

/**
 * Riding tracker — applies moving-platform carry displacement to an actor.
 *
 * The single `applyCarry` method is the entirety of the kernel's step-2 logic
 * (see decision §"Update order locked"). Pure and never-throwing; if the
 * provider is missing or returns `null`, the actor core is returned unchanged.
 */
export interface RidingTracker {
  /**
   * Apply the riding solid's displacement to the actor's position.
   *
   * @param core - current actor core (immutable; not mutated)
   * @param getDisplacement - provider callback, or `null` if no platforms move
   * @returns a new shallow-copied core with `x`/`y` adjusted, or the input
   *   core unchanged if no carry applies this tick
   */
  applyCarry(
    core: ActorCore,
    getDisplacement: SolidDisplacementProvider | null,
    supportId?: string | null,
  ): ActorCore;
}

/**
 * Create a `RidingTracker`. Pure factory; no host access, no global state.
 *
 * The tracker reads `core.contacts.groundId` to decide which solid's
 * displacement to apply. If `groundId` is `null` or the provider returns
 * `null`, the core is returned unchanged (a shallow-copy is still avoided in
 * the no-op case so callers can detect "no change" via reference equality).
 *
 * Never throws.
 *
 * @example
 * ```ts
 * const tracker = createRidingTracker();
 * core = tracker.applyCarry(core, (id) => platformDisplacements.get(id) ?? null);
 * ```
 */
export function createRidingTracker(): RidingTracker {
  return {
    applyCarry(core, getDisplacement, supportId = core.contacts.groundId) {
      if (supportId === null || getDisplacement === null) return core;
      try {
        const disp = getDisplacement(supportId);
        if (disp === null || typeof disp !== 'object') return core;
        const dx = Number(disp.dx);
        const dy = Number(disp.dy);
        if (!Number.isFinite(dx) || !Number.isFinite(dy)) return core;
        if (dx === 0 && dy === 0) return core;
        return { ...core, x: core.x + dx, y: core.y + dy };
      } catch {
        return core;
      }
    },
  };
}
