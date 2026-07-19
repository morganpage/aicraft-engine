/**
 * Jump ability processor — wraps `advanceJump` from `src/animation/jump.ts`.
 *
 * Per decision §"The kernel MUST call existing primitives, not reinvent
 * them": the jump trajectory, coyote time, buffering, and variable-height
 * cutoff all live inside `advanceJump`. This ability is a thin adapter that:
 *   1. Builds `JumpInputs` from the kernel context (`input.jump` +
 *      `core.onGround` + `core.contacts.ceilingId` for `hitCeiling`).
 *   2. Calls `advanceJump(state.jump, inputs, dt, config.jump)`.
 *   3. Applies the resulting `vy` onto a shallow-copied core.
 *   4. Emits `justLaunched` on the single tick the jump fires.
 *
 * This ability does NOT do its own collision or gravity — collision is the
 * kernel's step 6, gravity is the kernel's step 5. The jump state machine's
 * internal `physics.gravity` only influences the rising trajectory; the
 * kernel's external `gravity` (applied in step 5) governs the post-apex fall.
 *
 * Pure: never mutates input. Never throws.
 *
 * @module
 */

import { advanceJump, type JumpInputs } from '../../animation/jump';
import type {
  AbilityContext,
  AbilityProcessor,
  AbilityResult,
  JumpAbilityState,
  WritablePlatformerEvents,
} from '../types';

/**
 * The canonical jump ability processor. State kind: `'jump'`.
 *
 * @example
 * ```ts
 * const pipeline = [jumpAbility, wallSlideAbility, dashAbility];
 * const controller = createPlatformerController(pipeline, config);
 * ```
 */
export const jumpAbility: AbilityProcessor<JumpAbilityState> = {
  kind: 'jump',

  advance(ctx: AbilityContext, state: JumpAbilityState): AbilityResult<JumpAbilityState> {
    const { core, input, dt, config } = ctx;

    const jumpInputs: JumpInputs = {
      jumpHeld: input.jump.held,
      jumpPressed: input.jump.pressed,
      isGrounded: core.onGround,
      hitCeiling: core.contacts.ceilingId !== null,
    };

    const nextJump = advanceJump(state.jump, jumpInputs, dt, config.jump);

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
    if (nextJump.justLaunched) {
      events.justLaunched = true;
    }

    return {
      core: { ...core, vy: nextJump.vy },
      state: { ...state, jump: nextJump },
      events,
    };
  },
};
