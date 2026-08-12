/**
 * Dash-tech ability processor (Phase 5 — super jump / super wall jump / duck
 * super jump).
 *
 * Lives in the pipeline AFTER `jumpAbility`. On a `jump.pressed` it inspects the
 * shared {@link LocomotionState} (the previous tick's resolved slice, supplied
 * by the kernel via {@link AbilityContext.locomotion}) and, when the Celeste
 * dash-tech trigger conditions hold, emits a {@link LaunchIntent} that
 * ARBITRATES OUT the plain ground jump `jumpAbility` emitted the same tick
 * (priority order `superWallJump > superJump > wallJump > doubleJump > jump`,
 * see {@link LAUNCH_PRIORITY}). The kernel applies the winner, consumes the
 * buffered press, and (for super sources) resets the jump slice so the plain
 * jump's anticipation→rising launch cannot re-fire 3 ticks later — the super
 * jump fires IMMEDIATELY on the press tick, with no anticipation crouch
 * (Celeste-faithful: `SuperJump`/`SuperWallJump` dispatch straight from
 * `NormalUpdate` on the press, no crouch).
 *
 * The moves (Celeste-accurate triggers from roadmap §5):
 *
 *   - **Super jump** (`Player.cs:3495-3507`): trigger = the most recent dash
 *     was HORIZONTAL (`lastDashDirY === 0 && lastDashDirX !== 0`) AND
 *     `input.jump.pressed` AND `superJumpGraceTimer > 0`. Launch:
 *     `vx = superJumpVx · sign(lastDashDirX)`, `vy = jumpLaunchVelocity(config.jump)`
 *     (= `SuperJumpSpeed = JumpSpeed`). Source `'superJump'`.
 *
 *   - **Super wall jump** (`Player.cs:3510-3524`): trigger = the most recent
 *     dash was STRAIGHT UP (`lastDashDirX === 0 && lastDashDirY === -1`) AND a
 *     wall is present on one side (`probeWall`) AND `input.jump.pressed`.
 *     Launch: `vx = superWallJumpVx` away from the wall, `vy = superWallJumpVy`.
 *     Source `'superWallJump'`.
 *
 *   - **Duck super jump** (`Player.cs:1711-1715`): when EITHER of the above
 *     super jumps fires while `ducking` is true, apply `vx *= duckSuperJumpXMult`
 *     (1.25) and `vy *= duckSuperJumpYMult` (0.5) — fast + flat — and clear
 *     `ducking` (the kernel clears it on launch; this ability's LaunchIntent
 *     carries a `locomotionPatch: { ducking: false }` so the kernel drops it
 *     even if its own latch would otherwise carry it). In practice the duck
 *     variant is reached via the hyper: a down-diagonal ground dash converts to
 *     a ducking horizontal slide (see `dashAbility`), then this jump produces
 *     the duck super jump — the wavedash.
 *
 * Guards (a super jump / super wall jump NEVER fires):
 *   - while a dash is in flight (`locomotion.dashing`) — the dash owns velocity
 *     for the tick; a launch on top would prematurely end it;
 *   - on the same tick a dash is ALSO pressed (`input.dash.pressed`) — the dash
 *     wins, the press is the dash's;
 *   - without `input.jump.pressed` (this ability is edge-triggered);
 *   - when no dash has happened yet (`lastDashDirX === 0 && lastDashDirY === 0`
 *     falls through every branch → no launch; the plain jump wins).
 *
 * The wall probe uses `probeWall` (Phase 0e — geometry, not contacts) at
 * `wallProbeDistance`, consistent with the wall-slide ability. `superJumpVy` is
 * derived at runtime from `jumpLaunchVelocity(config.jump)` (NOT hardcoded),
 * matching the pegged "SuperJumpSpeed = JumpSpeed" identity.
 *
 * Pure: never mutates input. Never throws. When `dashEnabled === false`, returns
 * the input state unchanged (no dash-tech without dash).
 *
 * @module
 */

import { jumpLaunchVelocity } from '../../animation/jump';
import { probeWall } from '../../collision/aabb';
import type {
  AbilityContext,
  AbilityProcessor,
  AbilityResult,
  DashTechAbilityState,
  LaunchIntent,
  LocomotionState,
  WritablePlatformerEvents,
} from '../types';

/**
 * The canonical dash-tech ability processor. State kind: `'dashTech'`.
 *
 * @example
 * ```ts
 * // pipeline order: jumpAbility → dashTechAbility → wallSlideAbility → ...
 * const pipeline = [jumpAbility, dashTechAbility, wallSlideAbility, dashAbility];
 * ```
 */
export const dashTechAbility: AbilityProcessor<DashTechAbilityState> = {
  kind: 'dashTech',

  advance(
    ctx: AbilityContext,
    state: DashTechAbilityState,
  ): AbilityResult<DashTechAbilityState> {
    const { core, input, config, solids, locomotion } = ctx;

    // No dash-tech without dash enabled, and never mid-dash or on a same-tick
    // dash press (the dash owns those ticks).
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
      dashStarting: false,
      dashStarted: false,
      doubleJumped: false,
    };

    // Edge-triggered: only on a jump press. Locomotion may be absent for callers
    // that construct AbilityContext without it (the kernel always supplies it);
    // in that case there is no dash-tech state to read, so behave as a no-op.
    if (!input.jump.pressed || locomotion === undefined) {
      return { core, state, events };
    }

    // Don't fire while a dash is in flight (previous tick's resolved phase) or
    // on the tick a dash is also pressed — the dash owns those ticks.
    const dashPressedThisTick = input.dash !== null && input.dash.pressed;
    if (locomotion.dashing || dashPressedThisTick) {
      return { core, state, events };
    }

    const lastDirX = locomotion.lastDashDirX;
    const lastDirY = locomotion.lastDashDirY;

    let launch: LaunchIntent | undefined;
    let locomotionPatch: Partial<LocomotionState> | undefined;
    let facing = core.facing;

    // -----------------------------------------------------------------------
    // Super wall jump: last dash was STRAIGHT UP + a wall present.
    // Checked first because it ranks higher in arbitration and is the rarer
    // move. Either side wall triggers; push away from it.
    // -----------------------------------------------------------------------
    if (lastDirX === 0 && lastDirY === -1 && solids !== undefined) {
      const probeDist = config.wallProbeDistance ?? 3;
      const wallOnLeft =
        probeWall(
          { x: core.x, y: core.y, width: core.width, height: core.height },
          -1,
          probeDist,
          solids,
        ) !== null;
      const wallOnRight =
        probeWall(
          { x: core.x, y: core.y, width: core.width, height: core.height },
          1,
          probeDist,
          solids,
        ) !== null;
      if (wallOnLeft || wallOnRight) {
        // Push away from the wall. If both sides have walls, prefer the one the
        // actor is facing away from (push toward facing). facing flips toward
        // the push (mirroring wallSlideAbility's wall-jump).
        const pushLeft = wallOnRight; // wall on right → push left
        const pushRight = wallOnLeft; // wall on left → push right
        let vx: number;
        if (pushRight && !pushLeft) {
          vx = config.superWallJumpVx;
          facing = 1;
        } else if (pushLeft && !pushRight) {
          vx = -config.superWallJumpVx;
          facing = -1;
        } else {
          // Both walls: push toward current facing.
          vx = core.facing * config.superWallJumpVx;
          facing = core.facing;
        }
        let vy = config.superWallJumpVy;
        // Duck super-jump multipliers apply to the super WALL jump too when
        // ducking (Celeste `Player.cs:1711-1715` gates on `Ducking`, not on
        // which super). In practice ducking rarely coincides with a straight-up
        // dash, but the multiplier is applied for fidelity.
        if (locomotion.ducking) {
          vx *= config.duckSuperJumpXMult;
          vy *= config.duckSuperJumpYMult;
          locomotionPatch = { ducking: false };
        }
        launch = {
          vy,
          vx,
          varJumpTime: config.jump.timeToApex,
          source: 'superWallJump',
        };
      }
    }

    // -----------------------------------------------------------------------
    // Super jump: last dash was HORIZONTAL + ground-grace. Fires only if the
    // super-wall-jump branch above did not.
    // -----------------------------------------------------------------------
    if (launch === undefined && lastDirY === 0 && lastDirX !== 0) {
      if (locomotion.superJumpGraceTimer > 0) {
        let vx = config.superJumpVx * Math.sign(lastDirX);
        let vy = jumpLaunchVelocity(config.jump); // = SuperJumpSpeed (= JumpSpeed)
        facing = Math.sign(lastDirX) as 1 | -1;
        if (locomotion.ducking) {
          // Duck super jump (Player.cs:1711-1715): fast + flat, clear ducking.
          vx *= config.duckSuperJumpXMult;
          vy *= config.duckSuperJumpYMult;
          locomotionPatch = { ducking: false };
        }
        launch = {
          vy,
          vx,
          varJumpTime: config.jump.timeToApex,
          source: 'superJump',
        };
      }
    }

    if (launch === undefined) {
      return { core, state, events };
    }

    // Emit justLaunched for both super sources (they are jump-class launches);
    // the kernel re-affirms from the winning source. Super-wall-jump is also
    // wall-jump-family → emit wallJumpLaunched too (mirrors `wallSlideAbility`,
    // which sets its own wallJumpLaunched so the event survives even when the
    // ability is inspected standalone). Set facing toward the push.
    events.justLaunched = true;
    if (launch.source === 'superWallJump') {
      events.wallJumpLaunched = true;
    }
    const nextCore = facing !== core.facing ? { ...core, facing } : core;

    return {
      core: nextCore,
      state,
      events,
      launch,
      ...(locomotionPatch !== undefined ? { locomotionPatch } : {}),
    };
  },
};
