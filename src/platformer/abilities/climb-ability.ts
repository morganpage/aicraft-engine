/**
 * Climb (ladder) ability processor.
 *
 * The canonical ladder-climb ability. Runs LAST in the pipeline (after
 * `jumpAbility`) so its vertical-velocity decision is the one that survives
 * into collision/integration — jump otherwise overwrites `core.vy` from its
 * internal state every tick.
 *
 * The ability owns detection and the vertical-velocity decision only; the
 * kernel owns the cross-ability coordination (gravity skip, climb-authoritative
 * Y restore, and jump-state reset) via the `isClimbActive` flag this ability
 * sets — the same ability/kernel separation dash uses.
 *
 * When `climbEnabled` and the body overlaps a `ladder`-flagged solid (climb
 * space; the resolvers skip ladder solids so they never block movement) and the
 * player is not jumping this tick:
 *   - set `core.vy = climbIntent * climbSpeed` (0 sticks; ±climbSpeed climbs),
 *   - set `core.onGround = true`,
 *   - mark the state `climbing: true`.
 * Otherwise: `climbing: false`, no change (jump/kernel own vertical motion).
 *
 * Top-of-ladder guard: when climbing up, upward velocity is only applied if a
 * ladder cell exists above the body. At the top there is none, so vy stays 0
 * and the player sticks at the top cleanly — no bouncing (the ProjectJumper
 * approach, rather than a re-grab cooldown which trades the bounce for a fall).
 *
 * Pure: never mutates input. Never throws. When `climbEnabled === false`,
 * returns the input state unchanged with no events.
 *
 * @module
 */

import { overlapsLadder } from '../../collision/aabb';
import type {
  AbilityContext,
  AbilityProcessor,
  AbilityResult,
  ClimbAbilityState,
  WritablePlatformerEvents,
} from '../types';

/**
 * The canonical climb ability processor. State kind: `'climb'`.
 *
 * @example
 * ```ts
 * const pipeline = [...defaultPrecisionPipeline()]; // climb is included, last
 * ```
 */
export const climbAbility: AbilityProcessor<ClimbAbilityState> = {
  kind: 'climb',

  advance(
    ctx: AbilityContext,
    state: ClimbAbilityState,
  ): AbilityResult<ClimbAbilityState> {
    const { core, input, config, solids } = ctx;

    if (!config.climbEnabled) {
      return { core, state, events: {} };
    }

    const events: WritablePlatformerEvents = {
      justLanded: false,
      justLaunched: false,
      hitCeiling: false,
      hitWall: false,
      startedWallSlide: false,
      wallJumpLaunched: false,
      dashStarted: false,
      doubleJumped: false,
    };

    // Jump wins: if the player jumps this tick, abandon the ladder and let
    // jump/kernel own vertical motion. This is the clean hand-off that avoids
    // the climb/jump desync.
    const jumping = input.jump.pressed;
    // Ladder detection from the per-tick solids (ladders are `ladder: true`
    // solids — non-colliding, readable here). `solids` is optional on the
    // context; when absent there is nothing to climb.
    const onLadder = solids !== undefined && overlapsLadder(core, solids);
    const climbing = onLadder && !jumping;

    let nextCore = core;
    if (climbing) {
      const climbIntent = input.climb ?? 0;
      // climbIntent: -1 = up, +1 = down. vy: negative = up, positive = down.
      let vy = climbIntent * config.climbSpeed;
      if (climbIntent < 0 && solids !== undefined) {
        // Top-of-ladder guard (ProjectJumper approach): only rise if there's a
        // ladder cell at the player's midline. At the top there isn't, so upward
        // vy is suppressed to 0 — the player sticks cleanly at the top instead
        // of climbing past the last cell, falling back in, re-grabbing, and
        // bouncing. Probing the midline (not the head or feet) balances the
        // stop height: high enough to step off onto an adjacent floor, not so
        // high it overshoots. Probing the head stops a body-height too low;
        // probing the feet flickers at the boundary.
        const mid = { x: core.x, y: core.y + core.height / 2, width: core.width, height: 1 };
        if (!overlapsLadder(mid, solids)) vy = 0;
      }
      nextCore = { ...core, vy, onGround: true };
    }

    return { core: nextCore, state: { kind: 'climb', climbing }, events };
  },
};
