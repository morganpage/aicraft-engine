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
 *   5. On `jump.pressed` while sliding (or inside the post-slide grace
 *      window): EMITS a wall-jump `LaunchIntent` instead of writing
 *      `core.vx`/`core.vy` directly (Phase 0b — the kernel applies the launch
 *      and opens the horizontal lockout via `locomotion.forceMoveX`).
 *      DIRECTION-AWARE: the slide only stays engaged while the player holds
 *      INTO the wall, so a jump made while sliding launches STRAIGHT UP
 *      (`vx = 0`, facing the wall) — the actor can chimney-climb a single
 *      wall instead of being flung off the wall it is holding into. The
 *      classic away-from-wall leap (`vx = ±wallJumpVx`, facing the push)
 *      fires from the GRACE window: for `wallJumpGraceTime` after the slide
 *      disengages (direction released or turned away) the wall jump stays
 *      armed, and a press with neutral or away input — while the wall is
 *      still beside the actor — leaps away. Both fire paths set the lock
 *      timer; see docs/design/platformer-wall-jump-direction-grace-plan.md.
 *   6. Decrements `lockTimer` by `dt` while > 0; during lock, wall-slide
 *      cannot re-engage (lets the wall-jump's push clear the wall first).
 *   7. `graceTimer` decays by `dt` and is re-armed on every sliding tick
 *      (coyote-style). While it is > 0 the last sliding `side` is PRESERVED
 *      (the tick the slide drops would otherwise null it) so the grace jump
 *      knows which wall it leaps from.
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
      climbJumpLaunched: false,
      mantled: false,
    };

    let sliding = false;
    let side: 'left' | 'right' | null = null;
    let lockTimer = Math.max(0, state.lockTimer - dt);
    // Post-slide wall-jump grace (coyote-style): decays every tick, re-armed
    // to the full window while sliding (below). While > 0 the away-leap wall
    // jump stays armed after the slide disengages.
    let graceTimer = Math.max(0, (state.graceTimer ?? 0) - dt);

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

    // Arm the post-slide wall-jump grace while sliding (full window on every
    // sliding tick, so it decays from full the moment the slide drops).
    // `?? 0.1` mirrors `wallProbeDistance ?? 3` — the field is optional so
    // hand-built partial configs keep working.
    if (sliding) {
      graceTimer = config.wallJumpGraceTime ?? 0.1;
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

    // `side` persists through the grace window: the local resets to null the
    // tick the slide drops, but the grace jump still needs to know which wall
    // it leaps from (nulling it immediately is exactly why the away leap was
    // unreachable before the grace timer existed).
    const rememberedSide: 'left' | 'right' | null = sliding
      ? side
      : graceTimer > 0
        ? state.side
        : null;

    let nextCore = core;
    let nextState: WallSlideAbilityState = {
      ...state,
      sliding,
      side: rememberedSide,
      lockTimer,
      slideTimer,
      graceTimer,
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
    // horizontal lockout). Facing is not a velocity, so it is still written
    // here directly. DIRECTION-AWARE, branching on the sign of `moveX` at the
    // press (magnitude ignored — analog partial deflection works):
    //   - INTO-WALL (any active slide): straight-up hop. `vx = 0`, facing the
    //     wall. The kernel applies the zero exactly and resolves
    //     `forceMoveX = sign(0) = 0`, so the lockout PRESERVES vx ≈ 0 (the
    //     forced-horizontal step early-returns on 0) while suppressing
    //     steering input for `wallJumpLockTime` — a committed vertical hop,
    //     then normal air control resumes. This is what makes chimney-
    //     climbing a single wall possible: the old always-away push meant
    //     sliding + jump ALWAYS flung you off the wall you held into.
    //   - GRACE (slide disengaged, timer > 0) with neutral or away input:
    //     the classic away-from-wall leap, `vx = ±wallJumpVx`, facing the
    //     push. The extra gates all mirror the slide's own engage gates so
    //     the leap can never fire where a slide could not: airborne (a
    //     grounded press is the plain jump's — wallJump OUTRANKS jump in
    //     launch arbitration, so firing here would hijack it), lock expired,
    //     no grab held (the wall-grab ability owns grab+jump), not
    //     fast-falling, the wall still beside the actor (probe), and NOT
    //     holding into the wall (holding in re-engages the slide, whose jump
    //     is the straight-up hop above).
    let launch: LaunchIntent | undefined;
    const jumpSide = rememberedSide;
    const intoWall =
      jumpSide === 'left'
        ? input.moveX < 0
        : jumpSide === 'right'
          ? input.moveX > 0
          : false;
    const wallBeside =
      jumpSide !== null &&
      detectWall(core, jumpSide === 'left' ? -1 : 1, probeDist, solids);
    const graceLeap =
      !sliding &&
      jumpSide !== null &&
      graceTimer > 0 &&
      lockTimer === 0 &&
      !core.onGround &&
      !grabHeld &&
      !fastFalling &&
      !intoWall &&
      wallBeside;
    if ((sliding || graceLeap) && input.jump.pressed && jumpSide !== null) {
      if (intoWall) {
        // Straight-up into-wall hop.
        launch = {
          vy: config.wallJumpVy,
          vx: 0,
          varJumpTime: config.jump.timeToApex,
          source: 'wallJump',
        };
        nextCore = { ...nextCore, facing: jumpSide === 'left' ? -1 : 1 };
      } else {
        // Away leap: neutral or away input, away push, face the push.
        const pushX =
          jumpSide === 'left' ? config.wallJumpVx : -config.wallJumpVx;
        launch = {
          vy: config.wallJumpVy,
          vx: pushX,
          varJumpTime: config.jump.timeToApex,
          source: 'wallJump',
        };
        nextCore = { ...nextCore, facing: jumpSide === 'left' ? 1 : -1 };
      }
      nextState = {
        ...nextState,
        sliding: false,
        side: null,
        lockTimer: config.wallJumpLockTime,
        slideTimer: 0,
        graceTimer: 0,
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
