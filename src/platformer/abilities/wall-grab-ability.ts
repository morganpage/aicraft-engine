/**
 * Wall-grab + climb + grab-jump + ledge-mantle ability processor (Phase 6 —
 * Celeste `Climb*`, `Player.cs:102-118` / `:1711`; mantle wave — see
 * `docs/design/platformer-wall-mantle-directional-climb-jump-plan.md`).
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
 *      ladder AND not (prev-tick) dashing AND no dash pressed this tick AND
 *      the re-grab lock has expired (`regrabTimer <= 0` — armed by a
 *      climb-jump/mantle so the actor is allowed to rise off the wall before
 *      re-clinging). On engage, `vy`/`vx` are set from the climb intent and
 *      stamina begins draining. Celeste engages on `Grab.Check` +
 *      `ClimbCheck(Facing)`.
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
 *   - **Direction-aware grab+jump** (grabbing + `jump.pressed` → idle +
 *     launch): branches on the LATCHED wall side (`WallGrabAbilityState.side`
 *     — never velocity, never the input edge):
 *      - **Away** (sign of `moveX` points off the wall) → the pre-mantle
 *        climb-hop unchanged: `source: 'climbHop'`, `vy = -climbHopVy`,
 *        `vx = ±climbHopVx` away, faces away, kernel opens the
 *        `climbHopForceTime` forced-horizontal lockout. No re-grab timer —
 *        the forced interval supplies the separation.
 *      - **Neutral or Toward** → a straight-up climb-jump:
 *        `source: 'climbJump'`, `vx = 0`, `vy = -climbHopVy`, faces the wall,
 *        NO forced-horizontal window (the kernel resolves `forceMoveX = 0` /
 *        `forceMoveXTimer = 0`), and `regrabTimer = climbJumpRegrabLockTime`
 *        so the actor actually rises instead of instantly re-clinging.
 *      Direction tests are sign-based (`moveX < 0` / `> 0`), matching the
 *      kernel's analog contract; magnitude is ignored. Both branches keep the
 *      fixed-height impulse (`varJumpTime: 0`), jump-slice reset, and flat
 *      `staminaClimbJumpCost` deduction.
 *
 *   - **Mantle** (grabbing + Up near a clear wall top → idle + assisted hop):
 *     when grab is held, `moveY === -1`, jump is NOT pressed, stamina > 0, the
 *     re-grab lock is expired, and `findMantleRoute` validates a clear route,
 *     the ability ends the grab, deducts `staminaClimbJumpCost`, arms the
 *     mantle-assist record + re-grab lock, and emits a `'mantle'` launch
 *     (`vx = wallDirection · mantleHopVx`, the geometry-derived negative
 *     `launchVy`, `varJumpTime: 0`). Position is NEVER written — the start
 *     tick leaves `x`/`y` exactly as they are.
 *
 *   - **Mantle assist** (idle, assist record active): the ability re-applies
 *     ONLY the toward-ledge `vx` each tick and preserves `vy` (kernel gravity
 *     owns it; the `'mantle'` locomotion mode skips ordinary horizontal input
 *     but NOT gravity). The normal X resolver pins the actor beside the wall
 *     until its feet clear `wallTopY`; then the same velocity carries it over
 *     the lip and the normal Y resolver lands it. The assist ends on reaching
 *     the edge-anchored `landingX` MARKER (never a snap), landing, timeout, a
 *     dash, or a ceiling bonk — every exit preserves the physically resolved
 *     position.
 *
 * Precedence inside one already-grabbing tick (fixed): release conditions →
 * jump pressed (direction-aware) → mantle conditions → cling/climb + stamina
 * drain. So dash beats both jump and mantle, and jump beats mantle.
 *
 * Stamina lives on the shared `LocomotionState.stamina` — it is refilled to
 * `wallGrabMaxStamina` by the KERNEL whenever the actor is supported
 * (`onGround`), not by this ability. The ability only DEPLETES it (via a
 * `locomotionPatch`): up-climb / cling / jump / mantle costs flow through
 * here; refill stays in the kernel so there is exactly one owner for each
 * direction. When stamina reaches 0 the grab releases.
 *
 * Pipeline-order note: runs AFTER `wallSlideAbility` (and after jump/dashTech).
 * Wall-grab and wall-slide are mutually exclusive by input — wall-grab requires
 * `grab.held`, wall-slide requires `moveX`-into-wall AND `!grab.held` (the
 * wall-slide ability guards on grab so it yields when the player is holding the
 * grab key). So the two never fight for the same wall.
 *
 * Pure: never mutates input. Never throws. When `wallGrabEnabled === false`,
 * returns no events and clears any active grab/mantle state so disabling the
 * ability cannot leave its exclusive locomotion mode latched. An already-idle
 * state remains an identity no-op.
 *
 * @module
 */

import { probeWall, overlapsLadder } from '../../collision/aabb';
import { findMantleRoute } from '../mantle';
import type {
  AbilityContext,
  AbilityProcessor,
  AbilityResult,
  FeelMoment,
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
      const hasActiveState =
        state.grabbing ||
        state.side !== null ||
        state.solidId != null ||
        (state.regrabTimer ?? 0) > 0 ||
        state.mantle != null;
      return {
        core,
        state: hasActiveState
          ? {
              ...state,
              grabbing: false,
              side: null,
              solidId: null,
              regrabTimer: 0,
              mantle: null,
            }
          : state,
        events: {},
      };
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
      climbJumpLaunched: false,
      mantled: false,
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

    // While grabbing, probe the LATCHED side (state.side — the wall the actor
    // actually clings to), not the current facing. Celeste
    // `ClimbCheck((int)Facing)` at engage; the latched side thereafter.
    const grabbing0 = state.grabbing;
    const latchedSide: 'left' | 'right' =
      grabbing0 && state.side !== null
        ? state.side
        : core.facing === 1
          ? 'right'
          : 'left';
    const probeDir: -1 | 1 = latchedSide === 'right' ? 1 : -1;

    // Phase D2 keeps the resolved `Solid` (instead of `!== null`-reducing it)
    // so the `grabLatch` feel moment can carry the surface id — and so the
    // mantle can read the wall's `x`/`y`/`width` geometry.
    const wallSolid =
      solids !== undefined
        ? probeWall(
            { x: core.x, y: core.y, width: core.width, height: core.height },
            probeDir,
            probeDist,
            solids,
          )
        : null;
    const wallPresent = wallSolid !== null;
    const wallSolidId =
      wallSolid !== null && typeof wallSolid.id === 'string' ? wallSolid.id : null;

    // Stamina is the shared pool on `locomotion`. Fall back to max if absent
    // (defensive — `createPlatformerState` always inits it).
    const staminaCur = locomotion?.stamina ?? config.wallGrabMaxStamina;

    // ----- Ability-private timers. The re-grab lock decays every tick and is
    // preserved through every early return (a lost timer would let the actor
    // re-cling mid-rise). The mantle assist record is carried locally and
    // written back at the end. -----
    let regrabTimer = Math.max(0, (state.regrabTimer ?? 0) - dt);
    let mantleAssist = state.mantle ?? null;

    let grabbing = grabbing0;
    let nextCore = core;
    let launch: LaunchIntent | undefined;
    let staminaPatch: number | undefined;
    // Phase D2 — feel moments authored by this ability (grabLatch on engage,
    // staminaExhausted on the >0 → ≤0 crossing). Appended in pipeline order.
    const moments: FeelMoment[] = [];

    // ----- Ladder takes priority: if the body overlaps a ladder cell, the
    // climb (ladder) ability owns vertical motion. Release any active grab,
    // end any in-flight mantle assist (the ladder owns vy for the tick), and
    // decay the re-grab lock — every field survives the early return. -----
    if (onLadder) {
      if (grabbing) grabbing = false;
      mantleAssist = null;
      return {
        core: nextCore,
        state: {
          kind: 'wallGrab',
          grabbing,
          side: null,
          solidId: null,
          regrabTimer,
          mantle: null,
        },
        events,
      };
    }

    if (grabbing) {
      // ----- Already grabbing: release, jump, mantle, or continue. -----
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
        // ----- Direction-aware grab+jump. Branch on the LATCHED side, not
        // velocity and not the input edge: `away` is the sign of `moveX`
        // pointing OFF the wall (sign-based, matching the kernel's analog
        // contract — magnitude is ignored). -----
        grabbing = false;
        const wallDirection: 1 | -1 = latchedSide === 'right' ? 1 : -1;
        const away =
          latchedSide === 'right' ? input.moveX < 0 : input.moveX > 0;
        staminaPatch = Math.max(0, staminaCur - config.staminaClimbJumpCost);
        if (away) {
          // ----- Climb-hop (Celeste `ClimbJump*`, `Player.cs:1711`). Emit a
          // FIXED launch up-and-away from the wall. The kernel applies it,
          // opens the `forceMoveX` lockout (`climbHopForceTime`) so the actor
          // is pushed away and cannot immediately re-grab, and resets the jump
          // slice so the plain jump's anticipation does not re-fire. The flat
          // `staminaClimbJumpCost` is deducted here via the stamina patch. -----
          const awayDir: -1 | 1 = wallDirection === 1 ? -1 : 1;
          launch = {
            vy: -config.climbHopVy,
            vx: awayDir * config.climbHopVx,
            // varJumpTime: 0 — climb-hop is a FIXED impulse (no variable
            // height); Celeste's climb-jump does not open the variable-jump
            // window.
            varJumpTime: 0,
            source: 'climbHop',
          };
          // Face away from the wall (the hop direction). Facing is not a
          // velocity so it is still written here directly; the kernel's
          // forced-horizontal step will reaffirm it.
          nextCore = { ...nextCore, facing: awayDir };
          // No re-grab timer here — the forced-horizontal interval supplies
          // the separation (the re-grab lock exists for the straight-up
          // climb-jump's rise, not the away hop).
        } else {
          // ----- Straight-up climb-jump (Neutral or Toward). `vx = 0`, faces
          // the grabbed wall, NO forced-horizontal window (the kernel
          // explicitly resolves `forceMoveX = 0` / `forceMoveXTimer = 0` for
          // the `'climbJump'` source), and the ability-private re-grab lock
          // armed so the actor actually rises beside the wall instead of
          // instantly re-clinging (the 4 px re-cling jitter). -----
          launch = {
            vy: -config.climbHopVy,
            vx: 0,
            varJumpTime: 0,
            source: 'climbJump',
          };
          nextCore = { ...nextCore, facing: wallDirection };
          regrabTimer = config.climbJumpRegrabLockTime;
        }
      } else if (
        // ----- Mantle eligibility (evaluated only on a grabbing tick that
        // survived release + jump: grab held, no jump press, no dash press).
        // All gates per the canonical plan §3.4. -----
        config.mantleEnabled &&
        moveY === -1 &&
        !dashing &&
        staminaCur > 0 &&
        regrabTimer <= 0 &&
        wallSolid !== null &&
        solids !== undefined
      ) {
        const route = findMantleRoute({
          core,
          wall: wallSolid,
          side: latchedSide,
          config,
          dt,
          solids,
        });
        if (route !== null) {
          // ----- Mantle start. Position and contacts stay EXACTLY as they
          // are at ability evaluation — the start tick performs no movement.
          // End the grab, charge stamina, arm the assist + re-grab lock, and
          // emit the `'mantle'` launch; from here gravity, integration, and
          // collision produce all motion. -----
          grabbing = false;
          const wallDirection: 1 | -1 = latchedSide === 'right' ? 1 : -1;
          launch = {
            vy: route.launchVy,
            vx: wallDirection * config.mantleHopVx,
            varJumpTime: 0,
            source: 'mantle',
          };
          // Face the ledge (the direction of travel).
          nextCore = { ...nextCore, facing: wallDirection };
          staminaPatch = Math.max(0, staminaCur - config.staminaClimbJumpCost);
          mantleAssist = {
            side: route.side,
            wallTopY: route.wallTopY,
            landingX: route.landingX,
            solidId: route.solidId,
            assistTimer: config.mantleAssistTime,
          };
          // The re-grab lock covers at least the whole assist interval so the
          // hop cannot re-cling before it finishes.
          regrabTimer = Math.max(
            config.climbJumpRegrabLockTime,
            config.mantleAssistTime,
          );
        } else {
          // No safe route (mid-climb, ceiling, overhang, occupied foothold):
          // continue cling/climb this tick — a conservative decline, never a
          // blocked launch.
          nextCore = applyClimbVelocity(core, moveY, config);
          const depleted = depleteStamina(staminaCur, moveY, config, dt);
          if (depleted <= 0) {
            grabbing = false;
            if (staminaCur > 0) {
              moments.push({ kind: 'staminaExhausted' });
            }
          }
          if (depleted !== staminaCur) staminaPatch = Math.max(0, depleted);
        }
      } else {
        // ----- Continue grabbing: apply climb velocity + deplete stamina. -----
        nextCore = applyClimbVelocity(core, moveY, config);
        const depleted = depleteStamina(staminaCur, moveY, config, dt);
        if (depleted <= 0) {
          // Exhausted mid-grab: release (cannot re-engage until refilled).
          grabbing = false;
          // Phase D2 — one-tick `staminaExhausted` pulse on the strict
          // `>0 → ≤0` crossing (the gasp/latch-out cue was previously silent).
          // The `staminaCur > 0` guard ensures this fires once on the crossing,
          // not on every depleted tick.
          if (staminaCur > 0) {
            moments.push({ kind: 'staminaExhausted' });
          }
        }
        // Only emit a patch when stamina actually changed — descending
        // (`moveY === 1`) is free, so `depleted === staminaCur` and no patch
        // is needed (avoids a redundant no-op write that could mask another
        // ability's concurrent patch).
        if (depleted !== staminaCur) staminaPatch = Math.max(0, depleted);
      }
    } else if (mantleAssist !== null) {
      // ----- Mantle assist in flight: own ONLY the toward-ledge `vx`. `vy`
      // is preserved (kernel gravity owns it) and position is NEVER written —
      // the kernel's integration + `resolveAxisX`/`resolveAxisY` produce all
      // motion this tick (the no-teleport invariant). -----
      const assist = mantleAssist;
      const wallDirection: 1 | -1 = assist.side === 'right' ? 1 : -1;
      // Reaching the finish MARKER ends the assist — it never snaps the actor
      // to it. Direction-aware comparison (right wall ⇒ marker is rightward).
      const reachedMarker =
        assist.side === 'right'
          ? core.x >= assist.landingX
          : core.x <= assist.landingX;
      // Cancel/failure exits: dash takes over, a ceiling bonk (prev-tick
      // contact) means the rise was blocked, and landing ends the hop. Every
      // exit preserves the physically resolved position.
      const cancelled =
        dashPressed || dashing || core.onGround || core.contacts.ceilingId !== null;
      const expired = assist.assistTimer - dt <= 0;
      if (reachedMarker || cancelled || expired) {
        mantleAssist = null;
        // No velocity write on the ending tick — the kernel's ordinary
        // horizontal handling resumes next tick (mode returns to 'normal').
      } else {
        // Re-apply ONLY the toward-ledge horizontal velocity. While the body
        // still overlaps the wall's Y band, the kernel's X resolver blocks
        // this velocity, so the actor visibly rises beside the wall; once the
        // feet clear `wallTopY`, the same velocity carries the actor over the
        // lip. `vy` is untouched.
        nextCore = { ...nextCore, vx: wallDirection * config.mantleHopVx };
        mantleAssist = { ...assist, assistTimer: assist.assistTimer - dt };
      }
      // Note: no grab engage attempt while an assist is in flight — the
      // re-grab lock (armed for ≥ the assist interval) blocks it anyway.
    } else {
      // ----- Not grabbing, no assist: try to engage. The re-grab lock gates
      // ONLY engagement — never global input, never wall-slide. -----
      const canEngage =
        grabHeld &&
        wallPresent &&
        staminaCur > 0 &&
        !dashing &&
        !dashPressed &&
        regrabTimer <= 0;
      if (canEngage) {
        grabbing = true;
        // Phase D2 — one-tick `grabLatch` pulse on the `false → true` engage
        // transition (the latch SFX was previously silent). Carries the surface
        // id of the wall the actor grabbed.
        moments.push({ kind: 'grabLatch', solidId: wallSolidId });
        nextCore = applyClimbVelocity(core, moveY, config);
        const depleted = depleteStamina(staminaCur, moveY, config, dt);
        if (depleted !== staminaCur) staminaPatch = depleted;
      }
    }

    const nextState: WallGrabAbilityState = {
      kind: 'wallGrab',
      grabbing,
      side: grabbing ? latchedSide : null,
      // Phase D2 — capture the grabbed wall's surface id while grabbing
      // (observation-only), so the `grabLatch` moment and any downstream
      // rendering share the provenance. `null` while not grabbing.
      solidId: grabbing ? wallSolidId : null,
      // Mantle wave — the re-grab lock (blocks only re-engagement) and the
      // active mantle-assist record (owns only the toward-ledge vx). Both are
      // preserved through every path above.
      regrabTimer,
      mantle: mantleAssist,
    };

    return {
      core: nextCore,
      state: nextState,
      events,
      ...(launch !== undefined ? { launch } : {}),
      // Only patch stamina when this ability actually changed it (a grabbing,
      // jump, or mantle tick). On idle / failed-engage ticks the kernel's
      // end-of-tick ground-refill handles stamina; we must not emit an empty
      // patch that would clobber a concurrent ability's patch.
      ...(staminaPatch !== undefined
        ? { locomotionPatch: { stamina: staminaPatch } satisfies Partial<LocomotionState> }
        : {}),
      // Phase D2 — feel moments (grabLatch / staminaExhausted) for this tick.
      ...(moments.length > 0 ? { moments } : {}),
    };
  },
};
