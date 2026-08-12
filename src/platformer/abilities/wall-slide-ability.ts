/**
 * Wall-slide + wall-jump ability processor.
 *
 * Per decision §"Wall-jump cohesion — keep inside WallSlideAbility": wall-jump
 * is a transition OUT of wall-slide, so it lives in the same module. The
 * ability:
 *   1. Detects wall-slide conditions via a `probeWall` geometry query
 *      (Phase 0e — was `core.contacts.leftWallId`/`rightWallId`; now asks
 *      "is a wall within `wallProbeDistance` px of the body's leading edge?").
 *   2. Requires INTENT (Phase 3b): slide engages only while the player holds
 *      INTO the contacted wall (`moveX` toward the wall side). Celeste:
 *      `(moveX == Facing || (moveX == 0 && Grab.Check))` — Grab is not
 *      implemented yet, so the `moveX == 0 && grab` branch is RESERVED for
 *      Phase 6 (slide does NOT engage on `moveX == 0` today). Also SUPPRESSED
 *      while fast-falling (Phase 4 — `moveY === 1` down held): Celeste gates the
 *      same line on `Input.MoveY.Value != 1`, so holding down fast-falls past
 *      the wall instead of gripping it.
 *   3. Clamps `vy` to a DECAYING max (Phase 3b — Celeste `Player.cs:2933-2947`)
 *      that eases from `wallSlideStartMax` up toward `maxFallSpeed` over
 *      `wallSlideTime` seconds: starts slow, accelerates. This is a sustained
 *      terminal-velocity cap, NOT a launch — distinct from the wall-jump
 *      impulse below. It is the one allowed non-launch `core.vy` write
 *      alongside dash/climb.
 *   4. Emits `startedWallSlide` on the tick slide begins.
 *   5. On `jump.pressed` while sliding: EMITS a wall-jump `LaunchIntent`
 *      (`vy = wallJumpVy`, `vx = ±wallJumpVx` away from the wall) instead of
 *      writing `core.vx`/`core.vy` directly (Phase 0b — the kernel applies the
 *      launch and opens the horizontal lockout via `locomotion.forceMoveX`).
 *      Sets `facing` toward the push direction and the lock timer.
 *   6. Decrements `lockTimer` by `dt` while > 0; during lock, wall-slide
 *      cannot re-engage (lets the wall-jump's push clear the wall first).
 *
 * Pure: never mutates input. Never throws. When `wallSlideEnabled === false`,
 * returns the input state unchanged with no events.
 *
 * @module
 */

import { probeWall } from '../../collision/aabb';
import { lerp } from '../../primitives/pixel';
import type { Solid } from '../../collision/types';
import type {
  AbilityContext,
  AbilityProcessor,
  AbilityResult,
  LaunchIntent,
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
    const { core, input, dt, config, solids } = ctx;

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
      dashStarting: false,
      dashStarted: false,
      doubleJumped: false,
    };

    let sliding = false;
    let side: 'left' | 'right' | null = null;
    let lockTimer = Math.max(0, state.lockTimer - dt);

    // Wall-presence detection via a pure geometry probe (Phase 0e). The probe
    // answers "is there a wall within `wallProbeDistance` px of the body's
    // leading edge?" independently of the kernel's collision `contacts` (which
    // describe collisions that happened). Both coexist.
    const probeDist = config.wallProbeDistance ?? 3;
    const wallOnLeft = detectWall(core, -1, probeDist, solids);
    const wallOnRight = detectWall(core, 1, probeDist, solids);

    // Intent requirement (Phase 3b — Celeste `Player.cs:2933`): slide engages
    // only while the player holds INTO the contacted wall. Celeste's full gate
    // is `(moveX == Facing || (moveX == 0 && Grab.Check))`; in this engine,
    // `Grab.Check` maps to the wall-GRAB ability (Phase 6), not wall-slide —
    // holding grab clings to the wall (exclusive `'wallGrab'` mode), so when
    // `grab.held` is true the wall-grab ability owns the wall and wall-slide
    // YIELDS. The `moveX == 0 && grab` branch therefore routes to wall-grab,
    // not here; wall-slide still requires an explicit directional push toward
    // the wall AND no grab held. With `moveX == 0` (release), holding AWAY, or
    // holding grab, the actor does not slide here (grab → cling; otherwise it
    // falls normally).
    const grabHeld = input.grab?.held === true;
    // Phase 9 — intent-toward-wall is sign-based so an analog stick's partial
    // deflection still engages the slide (`moveX = -0.4` toward a left wall
    // slides). For digital `moveX ∈ {-1, 0, 1}`, `< 0` / `> 0` are equivalent
    // to `=== -1` / `=== 1`, so digital trajectories are byte-identical to v8.
    const intentsTowardLeft = input.moveX < 0;
    const intentsTowardRight = input.moveX > 0;

    // Phase 4 — fast-fall suppression (Celeste `Player.cs:2933`:
    // `... && Input.MoveY.Value != 1`). Holding DOWN (`moveY === 1`) suppresses
    // wall-slide entirely so the actor fast-falls past the wall instead of
    // gripping it. This pairs with the kernel's mutable max-fall cap, which
    // eases up toward `fastMaxFallSpeed` while `moveY === 1`.
    const fastFalling = (input.moveY ?? 0) === 1;

    if (
      lockTimer === 0 &&
      !core.onGround &&
      core.vy > 0 &&
      wallOnLeft &&
      intentsTowardLeft &&
      !fastFalling &&
      !grabHeld
    ) {
      sliding = true;
      side = 'left';
    } else if (
      lockTimer === 0 &&
      !core.onGround &&
      core.vy > 0 &&
      wallOnRight &&
      intentsTowardRight &&
      !fastFalling &&
      !grabHeld
    ) {
      sliding = true;
      side = 'right';
    }

    // Accumulate the slide timer; reset on engage. Drives the decaying clamp
    // below (Phase 3b).
    let slideTimer = state.slideTimer;
    const justStarted = sliding && !state.sliding;
    if (justStarted) {
      events.startedWallSlide = true;
      slideTimer = 0;
    }
    if (sliding) {
      slideTimer += dt;
    }

    let nextCore = core;
    let nextState: WallSlideAbilityState = {
      ...state,
      sliding,
      side,
      lockTimer,
      slideTimer,
    };

    // Decaying terminal-velocity clamp (Phase 3b — Celeste `Player.cs:2933-2947`).
    // This is a sustained cap while the actor is pressed against a wall and
    // holding into it; the kernel still applies one gravity term on top, so the
    // effective slide speed is slightly above the cap. The max EASES from
    // `wallSlideStartMax` up toward `maxFallSpeed` over `wallSlideTime`
    // seconds: starts slow, then accelerates (a permanent clamp reads as
    // sticky). This is the one allowed non-launch `core.vy` write alongside
    // dash/climb — it is a terminal-velocity clamp, not an impulse.
    if (sliding) {
      const t = config.wallSlideTime > 0
        ? Math.min(1, slideTimer / config.wallSlideTime)
        : 1;
      const max = lerp(config.wallSlideStartMax, config.maxFallSpeed, t);
      if (nextCore.vy > max) {
        nextCore = { ...nextCore, vy: max };
      }
    }

    // Wall-jump: emit a LaunchIntent (kernel applies vy/vx + opens the
    // horizontal lockout). Facing flips toward the push direction — facing is
    // not a velocity, so it is still written here directly.
    let launch: LaunchIntent | undefined;
    if (sliding && input.jump.pressed) {
      const pushX = side === 'left' ? config.wallJumpVx : -config.wallJumpVx;
      const facing: 1 | -1 = side === 'left' ? 1 : -1;
      launch = {
        vy: config.wallJumpVy,
        vx: pushX,
        varJumpTime: config.jump.timeToApex,
        source: 'wallJump',
      };
      nextCore = { ...nextCore, facing };
      nextState = {
        ...nextState,
        sliding: false,
        side: null,
        lockTimer: config.wallJumpLockTime,
        slideTimer: 0,
      };
      events.wallJumpLaunched = true;
    }

    return { core: nextCore, state: nextState, events, launch };
  },
};

/**
 * Geometry probe for a wall on one side of the body. Returns `true` when a
 * fully-solid surface lies within `distance` px of the body's leading edge on
 * `side` (`-1` left, `+1` right). Delegates to {@link probeWall}; returns
 * `false` when `solids` is unavailable (no geometry to probe).
 */
function detectWall(
  core: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  side: -1 | 1,
  distance: number,
  solids: readonly Solid[] | undefined,
): boolean {
  if (solids === undefined || distance <= 0) return false;
  return probeWall(
    { x: core.x, y: core.y, width: core.width, height: core.height },
    side,
    distance,
    solids,
  ) !== null;
}
