/**
 * Wall-grab + climb + climb-hop ability processor (Phase 6 — Celeste `Climb*`,
 * `Player.cs:102-118` / `:1711`).
 *
 * Claims the exclusive `'wallGrab'` locomotion mode while grabbing. In that
 * mode the ability is the SOLE owner of the actor's velocity: it sets `vy`
 * from the climb intent (cling/climb-up/climb-down) and pins `vx` to 0, and the
 * kernel SKIPS gravity and horizontal input (the same exclusivity contract dash
 * and ladder use). The grab reads wall presence ONLY from `probeWall` (Phase 0e
 * — a pure geometry query against `ctx.solids`), NEVER from `core.contacts`,
 * because contacts clear the tick after `vx` is zeroed and would release the
 * grab on the very move it exists to support. This is the §0e guarantee.
 *
 * State machine (one tick of `advance`):
 *
 *   - **Engage** (idle → grabbing): `wallGrabEnabled` AND `input.grab.held`
 *      AND `probeWall(facing)` finds a wall AND `stamina > 0` AND not on a
 *      ladder AND not (prev-tick) dashing AND no dash pressed this tick. On
 *      engage, `vy`/`vx` are set from the climb intent and stamina begins
 *      draining. Celeste engages on `Grab.Check` + `ClimbCheck(Facing)`.
 *
 *   - **Climb** (grabbing → grabbing): `vy` follows `input.moveY`:
 *      `moveY === -1` → `vy = -wallClimbUpSpeed` (drains `staminaUpCostPerSec`);
 *      `moveY === +1` → `vy = +wallClimbDownSpeed` (FREE — Celeste has no
 *      `DownCost`, descending costs nothing); `moveY === 0` → `vy = 0` (cling,
 *      drains `staminaStillCostPerSec`). `vy` is set DIRECTLY (not via
 *      `approach`) — Celeste sets `Speed.Y` directly to the climb speed
 *      (`Player.cs` climb branch); easing would smear the grab's snappy stop.
 *
 *   - **Release** (grabbing → idle): when the grab key is released, the wall is
 *      no longer present (`probeWall` null), stamina hits 0 (exhausted → forced
 *      release, cannot re-engage until refilled), a dash is pressed (dash takes
 *      over), or the actor climbs onto a ladder (ladder takes priority). On
 *      release the actor falls normally; wall-slide may engage next tick if the
 *      player holds into the wall without grab.
 *
 *   - **Climb-hop** (grabbing + `jump.pressed` → idle + launch): emits a
 *      `LaunchIntent` with `source: 'climbHop'`, `vy = -climbHopVy` (up) and
 *      `vx = ±climbHopVx` away from the wall, `varJumpTime: 0` (a FIXED impulse
 *      — Celeste's climb-jump is not variable-height). The kernel applies it,
 *      opens the `forceMoveX` lockout for `climbHopForceTime` (pushing the
 *      actor away so it cannot immediately re-grab), and deducts
 *      `staminaClimbJumpCost` (flat) from the pool (done here via
 *      `locomotionPatch`). Celeste `Player.cs:1711` `ClimbJump*`.
 *
 * Stamina lives on the shared `LocomotionState.stamina` — it is refilled to
 * `wallGrabMaxStamina` by the KERNEL whenever the actor is supported
 * (`onGround`), not by this ability. The ability only DEPLETES it (via a
 * `locomotionPatch`): up-climb / cling / hop costs flow through here; refill
 * stays in the kernel so there is exactly one owner for each direction. When
 * stamina reaches 0 the grab releases.
 *
 * Pipeline-order note: runs AFTER `wallSlideAbility` (and after jump/dashTech).
 * Wall-grab and wall-slide are mutually exclusive by input — wall-grab requires
 * `grab.held`, wall-slide requires `moveX`-into-wall AND `!grab.held` (the
 * wall-slide ability guards on grab so it yields when the player is holding the
 * grab key). So the two never fight for the same wall.
 *
 * Pure: never mutates input. Never throws. When `wallGrabEnabled === false`,
 * returns the input state unchanged with no events.
 *
 * @module
 */

import { probeWall, overlapsLadder } from '../../collision/aabb';
import type {
  AbilityContext,
  AbilityProcessor,
  AbilityResult,
  LaunchIntent,
  LocomotionState,
  WallGrabAbilityState,
  WritablePlatformerEvents,
} from '../types';

/**
 * Build the per-tick stamina depletion for a grabbing tick.
 *
 *   - `moveY === -1` (up): drains at `staminaUpCostPerSec`.
 *   - `moveY === 0` (cling): drains at `staminaStillCostPerSec`.
 *   - `moveY === +1` (down): FREE (Celeste has no `DownCost`).
 *
 * Returns the depleted stamina, floored at 0. Pure.
 */
function depleteStamina(
  stamina: number,
  moveY: -1 | 0 | 1,
  config: AbilityContext['config'],
  dt: number,
): number {
  let cost = 0;
  if (moveY === -1) cost = config.staminaUpCostPerSec * dt;
  else if (moveY === 0) cost = config.staminaStillCostPerSec * dt;
  // moveY === 1 (down): cost stays 0 (descending is free).
  return Math.max(0, stamina - cost);
}

/**
 * Apply the grab's vertical intent to the core: set `vy` from `moveY` and pin
 * `vx` to 0 (the actor sticks to the wall — no horizontal input is honored
 * while grabbing). Returns a shallow-copied core. Pure.
 */
function applyClimbVelocity(
  core: AbilityContext['core'],
  moveY: -1 | 0 | 1,
  config: AbilityContext['config'],
): AbilityContext['core'] {
  let vy: number;
  if (moveY === -1) vy = -config.wallClimbUpSpeed;
  else if (moveY === 1) vy = config.wallClimbDownSpeed;
  else vy = 0;
  // vx is pinned to 0: the actor clings; horizontal input is skipped by the
  // kernel in `'wallGrab'` mode, and we zero it here so any residual horizontal
  // velocity from the approach does not drift the body off the wall.
  return { ...core, vy, vx: 0 };
}

/**
 * The canonical wall-grab ability processor. State kind: `'wallGrab'`.
 *
 * @example
 * ```ts
 * const pipeline = [...defaultPrecisionPipeline()]; // wallGrab included
 * ```
 */
export const wallGrabAbility: AbilityProcessor<WallGrabAbilityState> = {
  kind: 'wallGrab',

  advance(
    ctx: AbilityContext,
    state: WallGrabAbilityState,
  ): AbilityResult<WallGrabAbilityState> {
    const { core, input, dt, config, solids, locomotion } = ctx;

    if (!config.wallGrabEnabled) {
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

    // ----- Read the world: wall presence (probeWall, NOT contacts — §0e),
    // ladder overlap, dash state, and the input edges. -----
    const probeDist = config.wallProbeDistance ?? 3;
    const onLadder = solids !== undefined && overlapsLadder(core, solids);
    // `locomotion.dashing` reflects the PREVIOUS tick's resolved dash phase
    // (the kernel syncs it at end-of-tick). Engaging while a dash is in flight
    // would let this ability write velocity that the dash immediately owns —
    // gating on it keeps the grab from latching on mid-dash.
    const dashing = locomotion?.dashing === true;
    const grabHeld = input.grab?.held === true;
    const jumpPressed = input.jump.pressed;
    const dashPressed = input.dash !== null && input.dash.pressed;
    const moveY = (input.moveY ?? 0) as -1 | 0 | 1;

    // Wall on the facing side (Celeste `ClimbCheck((int)Facing)`). `probeWall`
    // is a pure geometry query independent of velocity — this is what lets the
    // grab survive a pinned `vx = 0` (contacts would clear).
    const wallPresent =
      solids !== undefined &&
      probeWall(
        { x: core.x, y: core.y, width: core.width, height: core.height },
        core.facing,
        probeDist,
        solids,
      ) !== null;
    const side: 'left' | 'right' = core.facing === 1 ? 'right' : 'left';

    // Stamina is the shared pool on `locomotion`. Fall back to max if absent
    // (defensive — `createPlatformerState` always inits it).
    const staminaCur = locomotion?.stamina ?? config.wallGrabMaxStamina;

    let grabbing = state.grabbing;
    let nextCore = core;
    let launch: LaunchIntent | undefined;
    let staminaPatch: number | undefined;

    // ----- Ladder takes priority: if the body overlaps a ladder cell, the
    // climb (ladder) ability owns vertical motion. Release any active grab and
    // do not engage. This prevents the two vertical authorities from fighting
    // when a ladder shaft sits flush against a wall. -----
    if (onLadder) {
      if (grabbing) grabbing = false;
      return {
        core: nextCore,
        state: { kind: 'wallGrab', grabbing, side: null },
        events,
      };
    }

    if (grabbing) {
      // ----- Already grabbing: continue, hop, or release. -----
      const releaseForGrab = !grabHeld;
      const releaseForWall = !wallPresent;
      const releaseForDash = dashPressed;

      if (releaseForGrab || releaseForWall || releaseForDash) {
        // Clean release: let go, fall normally. No vy write — the kernel's
        // gravity (mode flips to 'normal' since grabbing is now false) takes
        // over. Wall-slide may engage next tick if the player holds into the
        // wall without grab.
        grabbing = false;
      } else if (jumpPressed) {
        // ----- Climb-hop (Celeste `ClimbJump*`, `Player.cs:1711`). Emit a
        // FIXED launch up-and-away from the wall. The kernel applies it,
        // opens the `forceMoveX` lockout (`climbHopForceTime`) so the actor is
        // pushed away and cannot immediately re-grab, and resets the jump
        // slice so the plain jump's anticipation does not re-fire. The flat
        // `staminaClimbJumpCost` is deducted here via the stamina patch. -----
        grabbing = false;
        const away: -1 | 1 = side === 'right' ? -1 : 1;
        launch = {
          vy: -config.climbHopVy,
          vx: away * config.climbHopVx,
          // varJumpTime: 0 — climb-hop is a FIXED impulse (no variable height);
          // Celeste's climb-jump does not open the variable-jump window.
          varJumpTime: 0,
          source: 'climbHop',
        };
        // Face away from the wall (the hop direction). Facing is not a velocity
        // so it is still written here directly; the kernel's forced-horizontal
        // step will reaffirm it.
        nextCore = { ...nextCore, facing: away };
        staminaPatch = Math.max(0, staminaCur - config.staminaClimbJumpCost);
      } else {
        // ----- Continue grabbing: apply climb velocity + deplete stamina. -----
        nextCore = applyClimbVelocity(core, moveY, config);
        const depleted = depleteStamina(staminaCur, moveY, config, dt);
        if (depleted <= 0) {
          // Exhausted mid-grab: release (cannot re-engage until refilled).
          grabbing = false;
        }
        // Only emit a patch when stamina actually changed — descending
        // (`moveY === 1`) is free, so `depleted === staminaCur` and no patch
        // is needed (avoids a redundant no-op write that could mask another
        // ability's concurrent patch).
        if (depleted !== staminaCur) staminaPatch = Math.max(0, depleted);
      }
    } else {
      // ----- Not grabbing: try to engage. -----
      const canEngage =
        grabHeld &&
        wallPresent &&
        staminaCur > 0 &&
        !dashing &&
        !dashPressed;
      if (canEngage) {
        grabbing = true;
        nextCore = applyClimbVelocity(core, moveY, config);
        const depleted = depleteStamina(staminaCur, moveY, config, dt);
        if (depleted !== staminaCur) staminaPatch = depleted;
      }
    }

    const nextState: WallGrabAbilityState = {
      kind: 'wallGrab',
      grabbing,
      side: grabbing ? side : null,
    };

    return {
      core: nextCore,
      state: nextState,
      events,
      ...(launch !== undefined ? { launch } : {}),
      // Only patch stamina when this ability actually changed it (a grabbing or
      // hop tick). On idle / failed-engage ticks the kernel's end-of-tick
      // ground-refill handles stamina; we must not emit an empty patch that
      // would clobber a concurrent ability's patch.
      ...(staminaPatch !== undefined
        ? { locomotionPatch: { stamina: staminaPatch } satisfies Partial<LocomotionState> }
        : {}),
    };
  },
};
