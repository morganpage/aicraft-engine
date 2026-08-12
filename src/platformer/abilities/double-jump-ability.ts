/**
 * Double-jump ability processor — a second jump while airborne.
 *
 * Fires when the actor is airborne, double-jump is enabled, and there is
 * budget remaining. The second jump uses the launch velocity derived from the
 * jump config via the shared `jumpLaunchVelocity` helper (Phase 0b: the local
 * mirror of that formula was removed so the impulse can never drift between
 * copies — exactly the same impulse as the first jump,
 * `launchVelocity = -(2 · apexHeight) / timeToApex`). The budget refills to
 * `maxDoubleJumps` on land.
 *
 * Phase 0b — single vertical-velocity authority: this ability NO LONGER writes
 * `core.vy` directly. It emits a `LaunchIntent` and the kernel applies it.
 * Because the impulse lands on `core` (not on a private velocity the jump
 * slice overwrites next tick), the double-jump now PERSISTS instead of being
 * discarded after one tick (the defect this wave fixes).
 *
 * Pipeline-order note: runs AFTER `jumpAbility`. The jump ability handles
 * ground-jump, coyote, buffer, and the rising/falling pose. The double-jump is
 * a clean additional impulse — it does NOT modify the `JumpState`, only emits a
 * launch and decrements its own `jumpsRemaining` counter.
 *
 * Pure: never mutates input. Never throws. When `doubleJumpEnabled === false`,
 * returns the input state unchanged with no events.
 *
 * @module
 */

import { jumpLaunchVelocity } from '../../animation/jump';
import type {
  AbilityContext,
  AbilityProcessor,
  AbilityResult,
  DoubleJumpAbilityState,
  LaunchIntent,
  WritablePlatformerEvents,
} from '../types';

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
      dashStarting: false,
      dashStarted: false,
      doubleJumped: false,
    };

    // Emit a launch (kernel applies it) instead of writing core.vy. Same
    // variable-jump window as a ground jump (`timeToApex`) so the double-jump
    // also gets full variable-height behavior.
    let launch: LaunchIntent | undefined;
    if (input.jump.pressed && !core.onGround && jumpsRemaining > 0) {
      jumpsRemaining = Math.max(0, jumpsRemaining - 1);
      launch = {
        vy: jumpLaunchVelocity(config.jump),
        varJumpTime: config.jump.timeToApex,
        source: 'doubleJump',
      };
      events.doubleJumped = true;
    }

    return {
      core,
      state: { ...state, jumpsRemaining },
      events,
      launch,
    };
  },
};
