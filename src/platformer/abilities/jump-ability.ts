/**
 * Jump ability processor — wraps `advanceJump` from `src/animation/jump.ts`.
 *
 * Phase 0b — single vertical-velocity authority: this ability advances the jump
 * state machine + pose (phase, timers, squash, airborne blend) via
 * `advanceJump`, but it NO LONGER writes `nextJump.vy` onto `core`. Instead,
 * on the tick `advanceJump` signals a launch (`justLaunched`), it emits a
 * `LaunchIntent` and the kernel applies it to `core.vy` (arbitrated against any
 * other launches the same tick). `advanceJump`'s internal `vy`/`y` are now
 * pose-only within the kernel path (see `JumpState` authority-split note); the
 * kernel integrates gravity once from `core.vy`. When a non-jump launch
 * (`doubleJump`/`wallJump`/`spring`) wins arbitration, the kernel ALSO re-syncs
 * `JumpState.vy` to the winning `intent.vy` so the slice's pose integration
 * tracks `core.vy` instead of continuing the stale pre-launch arc.
 *
 *   1. Builds `JumpInputs` from the kernel context (`input.jump` +
 *      `core.onGround` + `core.contacts.ceilingId` for `hitCeiling`).
 *   2. Calls `advanceJump(state.jump, inputs, dt, config.jump)` (pose/phase).
 *   3. Emits a `LaunchIntent` on the launch tick (ground / coyote / buffered).
 *   4. Emits `justLaunched` on the single tick the jump fires (the kernel
 *      re-affirms it from the winning launch's source, so a suppressed launch
 *      does not leak the event).
 *
 * This ability does NOT do its own collision or physics gravity — collision is
 * the kernel's step 6, gravity is the kernel's step 5 (single application).
 *
 * Pure: never mutates input. Never throws.
 *
 * @module
 */

import { advanceJump, jumpLaunchVelocity, type JumpInputs } from '../../animation/jump';
import type {
  AbilityContext,
  AbilityProcessor,
  AbilityResult,
  JumpAbilityState,
  LaunchIntent,
  WritablePlatformerEvents,
} from '../types';

/**
 * The variable-jump window (seconds) every jump-class launch opens. Derived as
 * `timeToApex` — the time the actor would spend rising at full hold — because
 * today's variable height comes from the rising phase lasting until `vy >= 0`,
 * which is exactly `timeToApex` for a full-hold jump. Wall-jump and double-jump
 * use the same constant so all launches share variable-height behavior.
 */
function varJumpTimeFor(ctx: AbilityContext): number {
  return ctx.config.jump.timeToApex;
}

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
    if (config.jumpEnabled === false) {
      return { core, state, events: {} };
    }

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
      dashStarting: false,
      dashStarted: false,
      doubleJumped: false,
    };

    // On the launch tick, emit a LaunchIntent instead of writing core.vy. The
    // kernel arbitrates (at most one launch/tick) and applies the winner,
    // opening the variable-jump window. vy = the apex-derived launch velocity.
    let launch: LaunchIntent | undefined;
    if (nextJump.justLaunched) {
      events.justLaunched = true;
      launch = {
        vy: jumpLaunchVelocity(config.jump),
        varJumpTime: varJumpTimeFor(ctx),
        source: 'jump',
      };
    }

    // NOTE: core.vy is intentionally NOT written here. The kernel owns it.
    return {
      core,
      state: { ...state, jump: nextJump },
      events,
      launch,
    };
  },
};
