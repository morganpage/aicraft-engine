/**
 * Wall-slide + wall-jump ability processor.
 *
 * Per decision §"Wall-jump cohesion — keep inside WallSlideAbility": wall-jump
 * is a transition OUT of wall-slide, so it lives in the same module. The
 * ability:
 *   1. Detects wall-slide conditions (airborne + touching a wall + falling).
 *   2. Clamps `vy` to `wallSlideSpeed` while sliding.
 *   3. Emits `startedWallSlide` on the tick slide begins.
 *   4. On `jump.pressed` while sliding: launches the actor away from the wall
 *      (`vx = ±wallJumpVx`, `vy = wallJumpVy`), sets the lock timer, emits
 *      `wallJumpLaunched`.
 *   5. Decrements `lockTimer` by `dt` while > 0; during lock, wall-slide
 *      cannot re-engage (lets the wall-jump's push clear the wall first).
 *
 * Pure: never mutates input. Never throws. When `wallSlideEnabled === false`,
 * returns the input state unchanged with no events.
 *
 * @module
 */

import type {
  AbilityContext,
  AbilityProcessor,
  AbilityResult,
  WallSlideAbilityState,
  WritablePlatformerEvents,
} from '../types';

/**
 * The canonical wall-slide ability processor. State kind: `'wallSlide'`.
 *
 * @example
 * ```ts
 * const pipeline = [jumpAbility, wallSlideAbility, dashAbility];
 * ```
 */
export const wallSlideAbility: AbilityProcessor<WallSlideAbilityState> = {
  kind: 'wallSlide',

  advance(
    ctx: AbilityContext,
    state: WallSlideAbilityState,
  ): AbilityResult<WallSlideAbilityState> {
    const { core, input, dt, config } = ctx;

    if (!config.wallSlideEnabled) {
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

    let sliding = false;
    let side: 'left' | 'right' | null = null;
    let lockTimer = Math.max(0, state.lockTimer - dt);

    if (
      lockTimer === 0 &&
      !core.onGround &&
      core.vy > 0 &&
      core.contacts.leftWallId !== null
    ) {
      sliding = true;
      side = 'left';
    } else if (
      lockTimer === 0 &&
      !core.onGround &&
      core.vy > 0 &&
      core.contacts.rightWallId !== null
    ) {
      sliding = true;
      side = 'right';
    }

    const justStarted = sliding && !state.sliding;
    if (justStarted) {
      events.startedWallSlide = true;
    }

    let nextCore = core;
    let nextState: WallSlideAbilityState = {
      ...state,
      sliding,
      side,
      lockTimer,
    };

    if (sliding) {
      if (nextCore.vy > config.wallSlideSpeed) {
        nextCore = { ...nextCore, vy: config.wallSlideSpeed };
      }
    }

    if (sliding && input.jump.pressed) {
      const pushX = side === 'left' ? config.wallJumpVx : -config.wallJumpVx;
      const facing: 1 | -1 = side === 'left' ? 1 : -1;
      nextCore = {
        ...nextCore,
        vx: pushX,
        vy: config.wallJumpVy,
        facing,
      };
      nextState = {
        ...nextState,
        sliding: false,
        side: null,
        lockTimer: config.wallJumpLockTime,
      };
      events.wallJumpLaunched = true;
    }

    return { core: nextCore, state: nextState, events };
  },
};
