/**
 * Double-jump ability processor — a second jump while airborne.
 *
 * Fires when the actor is airborne, double-jump is enabled, and there is
 * budget remaining. The second jump uses the launch velocity derived from
 * the jump config — exactly the same impulse as the first jump
 * (`launchVelocity = -(2 · apexHeight) / timeToApex`, see
 * `src/animation/jump.ts`). The budget refills to `maxDoubleJumps` on land.
 *
 * Pipeline-order note: this ability runs AFTER `jumpAbility`. The jump
 * ability handles ground-jump, coyote, buffer, and the rising/falling
 * trajectory. The double-jump ability is a clean additional impulse — it does
 * NOT modify the `JumpState` itself, only the core's `vy` and its own
 * `jumpsRemaining` counter. This keeps `JumpState` semantically clean (one
 * state machine for one jump) and the double-jump a discrete event.
 *
 * The launch velocity formula is mirrored from `deriveJumpPhysics` (kept
 * private in `jump.ts`). It is two literal multiplications; not worth a
 * cross-module export dependency that would couple this ability to the jump
 * state's internal physics cache.
 *
 * Pure: never mutates input. Never throws. When `doubleJumpEnabled === false`,
 * returns the input state unchanged with no events.
 *
 * @module
 */

import type {
  AbilityContext,
  AbilityProcessor,
  AbilityResult,
  DoubleJumpAbilityState,
  WritablePlatformerEvents,
} from '../types';

/**
 * Derive the jump launch velocity (negative — upward) from a jump config.
 *
 * Mirrors `deriveJumpPhysics` in `src/animation/jump.ts`. Kept local to avoid
 * a cross-module dependency on the jump state's cached physics; the math is
 * documented in `JumpConfig`'s JSDoc.
 */
function deriveLaunchVelocity(apexHeight: number, timeToApex: number): number {
  return -(2 * apexHeight) / timeToApex;
}

/**
 * The canonical double-jump ability processor. State kind: `'doubleJump'`.
 *
 * @example
 * ```ts
 * const pipeline = [jumpAbility, wallSlideAbility, dashAbility, doubleJumpAbility];
 * ```
 */
export const doubleJumpAbility: AbilityProcessor<DoubleJumpAbilityState> = {
  kind: 'doubleJump',

  advance(
    ctx: AbilityContext,
    state: DoubleJumpAbilityState,
  ): AbilityResult<DoubleJumpAbilityState> {
    const { core, input, config } = ctx;

    if (!config.doubleJumpEnabled) {
      return { core, state, events: {} };
    }

    let jumpsRemaining = state.jumpsRemaining;
    if (core.onGround) {
      jumpsRemaining = config.maxDoubleJumps;
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
    let nextCore = core;

    if (input.jump.pressed && !core.onGround && jumpsRemaining > 0) {
      jumpsRemaining = Math.max(0, jumpsRemaining - 1);
      const launchVelocity = deriveLaunchVelocity(
        config.jump.apexHeight,
        config.jump.timeToApex,
      );
      nextCore = { ...nextCore, vy: launchVelocity };
      events.doubleJumped = true;
    }

    return {
      core: nextCore,
      state: { ...state, jumpsRemaining },
      events,
    };
  },
};
