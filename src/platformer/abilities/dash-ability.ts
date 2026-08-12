/**
 * Dash ability processor — directional dash with a Celeste-style startup
 * (freeze) phase, cooldown, and limited count.
 *
 * Phase 2b — startup ordering. The dash is NO LONGER a single-tick velocity
 * override on the press tick. It is now a three-phase state machine:
 *
 *   1. `'idle'`    — at rest. A press (cooldown ready + budget remaining)
 *                    transitions to `'startup'`.
 *   2. `'startup'` — the freeze frame. The actor is pinned at zero velocity
 *                    for `config.dashStartupTime` seconds. This mirrors
 *                    Celeste's `Celeste.Freeze(.05f)` (`Player.cs:3448`),
 *                    which runs BEFORE `Speed = newSpeed` (`Player.cs:3559`).
 *                    `dashStarting` is emitted on the entry tick; `dashStarted`
 *                    is NOT yet emitted and no dash motion is applied.
 *   3. `'active'`  — the freeze ends; the dash velocity applies (with
 *                    same-direction preservation — a dash never slows you,
 *                    `Player.cs:3557`) and `dashStarted` fires. The velocity is
 *                    held each tick for `config.dashDuration` seconds, then the
 *                    dash returns to `'idle'`.
 *
 * Because the freeze is part of the dash, `resolveLocomotionMode` treats BOTH
 * `'startup'` and `'active'` as the exclusive `'dash'` locomotion mode — the
 * kernel skips gravity and horizontal input for the whole dash, and the dash
 * ability is the SOLE direct writer of `core.vx`/`core.vy` while in that mode
 * (the one allowed direct writer alongside climb in `'ladder'`). During
 * startup it writes 0/0 (the freeze); during active it writes the dash
 * velocity.
 *
 * Direction is captured at press from BOTH axes: `dirX` from `input.moveX`
 * (falling back to `facing`), `dirY` from `input.moveY` (0 if neutral). This is
 * 8-directional (Phase 4b — Celeste `lastAim` 8-dir vector × `DashSpeed`).
 * Diagonals (both axes non-zero) are NORMALIZED by `1/√2` so a diagonal dash
 * travels at exactly `dashSpeed`, not `1.41 × dashSpeed`. Direction is captured
 * once at dash start and held constant for the whole dash (Celeste captures at
 * `DashBegin` and does not re-aim mid-dash). The dash budget is limited per
 * airborne cycle and refills to `maxDashes` when the actor lands.
 *
 * End-dash velocity (Phase 4c — Celeste `Player.cs:3625-3632`): when a
 * NON-downward dash (`dirY <= 0`) expires, velocity is set ABSOLUTELY to the
 * (normalized) dash direction × `dashSpeed × endDashSpeedFactor` (an absolute
 * set, NOT same-direction preservation), and an upward carry (`vy < 0`) is
 * scaled by `endDashUpMult`. A downward dash (`dirY > 0`) skips the end-set and
 * keeps its accumulated vy (gravity continues from the dash speed). After the
 * end-set, normal movement (overspeed bleed) takes over — the tech-enabling
 * carry Phase 5 builds on.
 *
 * Phase 5 — HYPER SLIDE (Celeste `Player.cs:3578-3585`): at the startup→active
 * transition, if the captured direction is down-diagonal AND the actor is
 * grounded, the dash converts to a flat horizontal ducking slide. Direction is
 * flattened (`dirY := 0`, `dirX := sign(dirX)`), the horizontal speed is
 * multiplied by `dodgeSlideSpeedMult` (1.2), the vertical is zeroed, and
 * `ducking` is latched true (signaled to the kernel via `locomotionPatch`).
 * The slide IS the dash — `dashStarted` still fires and the converted direction
 * is what `lastDashDir*` records. The follow-up jump out of this ducking state
 * is a DUCK super jump (handled by `dashTechAbility`), producing the wavedash.
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
  LocomotionState,
  WritablePlatformerEvents,
} from '../types';

/**
 * Resolve the normalized-direction factor for the dash (Phase 4b). Diagonals
 * (both axes non-zero) are scaled by `1/√2` so the dash's velocity magnitude is
 * exactly `dashSpeed` along the diagonal, not `√2 × dashSpeed` (≈ 1.41×). Pure.
 */
function dashDirectionFactor(dirX: number, dirY: number): number {
  return dirX !== 0 && dirY !== 0 ? 1 / Math.SQRT2 : 1;
}

/**
 * Resolve the dash's horizontal velocity, honoring the same-direction
 * preservation rule (`Player.cs:3557` — a dash never slows you). If the actor
 * was already moving faster than the dash's horizontal component
 * (`dirX × factor × dashSpeed`) at the moment of the press, keep that faster
 * speed instead of slowing to the canonical dash component. For a diagonal
 * dash the X component is `dirX/√2 × dashSpeed`, so preservation compares
 * against THAT value (not the full `dashSpeed`) — the diagonal dash still never
 * slows you on X, but only relative to its own (reduced) X component.
 *
 * Pure: a pure function of the captured inputs.
 */
function preservedDashVx(
  dirX: number,
  factor: number,
  beforeDashVx: number,
  dashSpeed: number,
): number {
  const newVx = dirX * factor * dashSpeed;
  // [C: Celeste Player.cs:3557] A dash never slows you: if the actor was
  // already moving faster in the dash's horizontal direction, keep that
  // faster speed. `Math.sign(0) === 0`, so a zero beforeDashVx never matches
  // a non-zero dash direction (no spurious preservation).
  if (
    Math.sign(beforeDashVx) === Math.sign(newVx) &&
    Math.abs(beforeDashVx) > Math.abs(newVx)
  ) {
    return beforeDashVx;
  }
  return newVx;
}

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
      dashStarting: false,
      dashStarted: false,
      doubleJumped: false,
    };

    // Cooldown always counts down, regardless of phase.
    let cooldown = Math.max(0, state.cooldown - dt);

    let phase = state.phase;
    let startupTimer = state.startupTimer;
    let timer = state.timer;
    let dashesRemaining = state.dashesRemaining;
    let dirX = state.dirX;
    let dirY = state.dirY;
    let beforeDashVx = state.beforeDashVx;
    let dashStartedOnGround = state.dashStartedOnGround;
    // Phase 5 — `hyperSlide` persists on the slice for the dash's whole active
    // phase so every sustained tick re-applies the BOOSTED speed.
    let hyperSlide = state.hyperSlide;
    // Phase 5 — hyper-slide TRIGGERED signal (one-tick): set on the conversion
    // tick, pushed to the kernel via `locomotionPatch` so its ducking
    // maintenance latches `ducking = true` for the slide.
    let hyperSlideTriggered = false;

    // Refill on land (preserved from the legacy machine): while supported, the
    // airborne dash budget is topped up to `maxDashes`. This runs every tick
    // the actor is grounded, so a fresh airborne cycle always starts full.
    if (core.onGround && dashesRemaining < config.maxDashes) {
      dashesRemaining = config.maxDashes;
    }

    // -----------------------------------------------------------------------
    // Press → enter startup (the freeze). NO dash velocity is applied here;
    // the actor is about to be frozen. Celeste freezes (~0.05s) before
    // applying `Speed = newSpeed`; `dashStarting` marks this entry tick.
    // -----------------------------------------------------------------------
    const wantsDash =
      input.dash !== null &&
      input.dash.pressed &&
      phase === 'idle' &&
      cooldown === 0 &&
      dashesRemaining > 0;

    if (wantsDash) {
      phase = 'startup';
      startupTimer = config.dashStartupTime;
      // Phase 4b — 8-directional capture. [C: Celeste `Input.GetAimVector
      // (Facing)`] The facing fallback applies ONLY when BOTH moveX and moveY
      // are neutral — a truly aimless press dashes horizontally toward facing.
      // If moveY is non-zero, a neutral moveX stays 0, yielding a PURE vertical
      // dash (straight up/down). (Pre-Phase-4 the fallback fired whenever moveX
      // was 0, making pure vertical dashes impossible; corrected for Celeste
      // accuracy per the conventions clause — Celeste accuracy wins over old
      // feel on conflict.) dirY is 0 when no vertical input. Both are RAW signed
      // units (-1/0/+1); the diagonal normalization (1/√2) is applied where
      // velocity is computed, not here. Direction is captured ONCE at press and
      // held for the whole dash.
      const moveY = input.moveY ?? 0;
      // Phase 9 — `dirX` is sign-based so an analog stick's magnitude does
      // not scale the dash speed (dash is a SIGN intent, never a magnitude):
      // `moveX = 0.7` dashes full-speed right, exactly like `moveX = 1`. For
      // digital `moveX ∈ {-1, 0, 1}`, `Math.sign(moveX)` === `moveX`, so the
      // captured direction is byte-identical to v8.
      dirX =
        input.moveX !== 0
          ? Math.sign(input.moveX)
          : moveY !== 0
            ? 0
            : core.facing;
      dirY = moveY !== 0 ? (moveY as -1 | 0 | 1) : 0;
      // Capture pre-dash horizontal velocity for the same-direction
      // preservation rule applied at the startup→active transition.
      beforeDashVx = core.vx;
      // Phase 5 — capture groundedness at the press (Celeste
      // `dashStartedOnGround`, `Player.cs:3444`). `core.onGround` reads false
      // THROUGHOUT the dash (the freeze pins vy=0 → no landing detected), so
      // the hyper-slide conversion at the startup→active transition needs this
      // snapshot to know whether the dash began on the ground.
      dashStartedOnGround = core.onGround;
      // Reset the hyper flag — it is (re)set at the startup→active transition
      // if THIS dash converts to a hyper slide.
      hyperSlide = false;
      dashesRemaining = Math.max(0, dashesRemaining - 1);
      cooldown = config.dashCooldown;
      events.dashStarting = true;
    }

    // The dash ability is the EXCLUSIVE owner of core velocity in `'dash'`
    // mode (the one allowed direct writer, alongside climb in `'ladder'`).
    // During startup it pins the actor to zero (the freeze); during active it
    // applies the dash velocity.
    let nextCore = core;

    if (phase === 'startup') {
      // Freeze frame: pin velocity to zero for the startup duration.
      nextCore = { ...nextCore, vx: 0, vy: 0 };
      startupTimer = Math.max(0, startupTimer - dt);
      if (startupTimer <= 0) {
        // Startup → active transition: freeze is over, apply the dash
        // velocity (with diagonal normalization + same-direction X
        // preservation) and emit `dashStarted`.
        phase = 'active';
        timer = config.dashDuration;
        // ---------------------------------------------------------------
        // Phase 5 — HYPER SLIDE (Celeste `Player.cs:3578-3585`). When the
        // CAPTURED direction is down-diagonal (`dirX !== 0 && dirY > 0`) AND
        // the actor is grounded at the transition tick, convert the dash into
        // a flat horizontal ducking slide:
        //   - flatten direction: `dirY = 0`, `dirX = sign(dirX)`
        //   - boost the horizontal dash speed by `dodgeSlideSpeedMult` (1.2)
        //   - zero the vertical
        //   - latch `ducking = true` (signaled via `locomotionPatch`)
        // The slide IS the dash (just modified): `dashStarted` still fires,
        // and `beforeDashVx` same-direction preservation applies ON TOP of the
        // boosted speed (a dash never slows you). The `Speed.Y > 0` term in
        // Celeste's gate is redundant with our `dirY > 0` gate (the dash was
        // just frozen at vy=0 during startup), so it is omitted.
        // ---------------------------------------------------------------
        if (dashStartedOnGround && dirX !== 0 && dirY > 0) {
          dirX = Math.sign(dirX);
          dirY = 0;
          hyperSlide = true;
          hyperSlideTriggered = true;
          const slideSpeed = config.dashSpeed * config.dodgeSlideSpeedMult;
          const newVx = preservedDashVx(dirX, 1, beforeDashVx, slideSpeed);
          nextCore = { ...nextCore, vx: newVx, vy: 0 };
        } else {
          const factor = dashDirectionFactor(dirX, dirY);
          const newVx = preservedDashVx(dirX, factor, beforeDashVx, config.dashSpeed);
          const newVy = dirY * factor * config.dashSpeed;
          nextCore = { ...nextCore, vx: newVx, vy: newVy };
        }
        events.dashStarted = true;
      }
    } else if (phase === 'active') {
      timer = Math.max(0, timer - dt);
      if (timer <= 0) {
        // ---------------------------------------------------------------
        // Dash EXPIRES this tick (active → idle). Apply the end-dash
        // velocity (Phase 4c — Celeste `Player.cs:3625-3632`).
        //   - Non-downward dash (dirY <= 0): ABSOLUTE set along the
        //     normalized dash direction × endDashSpeed (= dashSpeed ×
        //     endDashSpeedFactor). Same-direction preservation does NOT apply
        //     (it is an absolute set, per Celeste). An upward carry (vy < 0)
        //     is scaled by endDashUpMult.
        //   - Downward dash (dirY > 0): skip the end-set — keep the
        //     accumulated dash velocity (gravity continues from the dash
        //     speed). Preservation still applies on the X component (it is the
        //     last active tick, behaving like any other active tick).
        // After this tick the dash is idle and normal movement (overspeed
        // bleed) owns velocity — the tech-enabling carry.
        // ---------------------------------------------------------------
        phase = 'idle';
        const factor = dashDirectionFactor(dirX, dirY);
        if (dirY <= 0) {
          const endDashSpeed = config.dashSpeed * config.endDashSpeedFactor;
          let endVy = dirY * factor * endDashSpeed;
          // [C: Celeste Player.cs:3631] Upward carry reduced by EndDashUpMult.
          if (endVy < 0) endVy *= config.endDashUpMult;
          nextCore = {
            ...nextCore,
            vx: dirX * factor * endDashSpeed,
            vy: endVy,
          };
        } else {
          // Downward dash: keep accumulated dash velocity (full dash speed).
          const newVx = preservedDashVx(
            dirX,
            factor,
            beforeDashVx,
            config.dashSpeed,
          );
          const newVy = dirY * factor * config.dashSpeed;
          nextCore = { ...nextCore, vx: newVx, vy: newVy };
        }
      } else {
        // Sustained dash velocity (still active). Re-derive via the
        // preservation helper so the "a dash never slows you" invariant holds
        // for the dash's whole duration (the preserved faster speed is a pure
        // function of the stored `beforeDashVx`, so this is stable across
        // ticks). Diagonal normalization applied so the magnitude stays at
        // `dashSpeed`. Phase 5: a HYPER slide keeps the BOOSTED speed
        // (`dashSpeed × dodgeSlideSpeedMult`) for its whole duration — without
        // this the boost would last exactly one tick (the transition tick).
        const factor = dashDirectionFactor(dirX, dirY);
        const baseSpeed = hyperSlide
          ? config.dashSpeed * config.dodgeSlideSpeedMult
          : config.dashSpeed;
        const newVx = preservedDashVx(dirX, factor, beforeDashVx, baseSpeed);
        const newVy = dirY * factor * baseSpeed;
        nextCore = { ...nextCore, vx: newVx, vy: newVy };
      }
    }

    return {
      core: nextCore,
      state: {
        ...state,
        phase,
        startupTimer,
        timer,
        cooldown,
        dashesRemaining,
        dirX,
        dirY,
        beforeDashVx,
        dashStartedOnGround,
        hyperSlide,
      },
      events,
      // Phase 5 — push the hyper-slide ducking latch to the kernel's
      // locomotion slice. Only present on the conversion tick; the kernel's
      // ducking maintenance then carries `ducking = true` while the slide
      // persists (grounded, no launch) and clears it on launch/airborne.
      ...(hyperSlideTriggered
        ? { locomotionPatch: { ducking: true } satisfies Partial<LocomotionState> }
        : {}),
    };
  },
};
