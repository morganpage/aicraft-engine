/**
 * Dash ability processor — directional dash with cooldown and limited count.
 *
 * Per the spec: v1 dash is horizontal-only. Direction is captured at
 * dash-start (either `input.moveX` if non-zero, else the actor's current
 * `facing`). The dash overrides velocity for `dashDuration` seconds, then
 * normal physics resumes. After a dash, `dashCooldown` seconds must pass
 * before another dash can begin. The dash budget is limited per airborne
 * cycle and refills to `maxDashes` when the actor lands.
 *
 * During the active dash:
 *   - `vx = dirX * config.dashSpeed`, `vy = dirY * config.dashSpeed` (zero
 *     for v1 since dirY = 0).
 *   - Gravity is skipped (the kernel's integrate step checks `state.timer > 0`
 *     on the dash ability state to decide).
 *
 * Pure: never mutates input. Never throws. When `dashEnabled === false`,
 * returns the input state unchanged with no events.
 *
 * @module
 */

import type {
  AbilityContext,
  AbilityProcessor,
  AbilityResult,
  DashAbilityState,
  WritablePlatformerEvents,
} from '../types';

/**
 * The canonical dash ability processor. State kind: `'dash'`.
 *
 * @example
 * ```ts
 * const pipeline = [jumpAbility, wallSlideAbility, dashAbility];
 * ```
 */
export const dashAbility: AbilityProcessor<DashAbilityState> = {
  kind: 'dash',

  advance(ctx: AbilityContext, state: DashAbilityState): AbilityResult<DashAbilityState> {
    const { core, input, dt, config } = ctx;

    if (!config.dashEnabled) {
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

    let timer = Math.max(0, state.timer - dt);
    let cooldown = Math.max(0, state.cooldown - dt);
    let dashesRemaining = state.dashesRemaining;
    let dirX = state.dirX;
    let dirY = state.dirY;

    if (core.onGround && dashesRemaining < config.maxDashes) {
      dashesRemaining = config.maxDashes;
    }

    const wantsDash =
      input.dash !== null &&
      input.dash.pressed &&
      cooldown === 0 &&
      dashesRemaining > 0 &&
      timer === 0;

    if (wantsDash) {
      timer = config.dashDuration;
      cooldown = config.dashCooldown;
      dashesRemaining = Math.max(0, dashesRemaining - 1);
      dirX = input.moveX !== 0 ? input.moveX : core.facing;
      dirY = 0;
      events.dashStarted = true;
    }

    let nextCore = core;
    if (timer > 0) {
      nextCore = {
        ...nextCore,
        vx: dirX * config.dashSpeed,
        vy: dirY * config.dashSpeed,
      };
    }

    return {
      core: nextCore,
      state: { ...state, timer, cooldown, dashesRemaining, dirX, dirY },
      events,
    };
  },
};
