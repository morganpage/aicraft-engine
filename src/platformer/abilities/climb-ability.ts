/**
 * Climb (ladder) ability processor.
 *
 * The canonical ladder-climb ability. Runs LAST in the pipeline (after
 * `jumpAbility`) so its vertical-velocity decision is the one that survives
 * into collision/integration — jump otherwise overwrites `core.vy` from its
 * internal state every tick.
 *
 * The ability owns detection and the vertical-velocity decision only; the
 * kernel owns the cross-ability coordination (gravity skip, climb-authoritative
 * Y restore, and jump-state reset) via `resolveLocomotionMode`, which reads
 * `ClimbAbilityState.climbing` to resolve the exclusive `'ladder'` mode — the
 * same ability/kernel separation dash uses.
 *
 * When `climbEnabled` and the body overlaps a `ladder`-flagged solid (climb
 * space; the resolvers skip ladder solids so they never block movement) and the
 * player is not jumping this tick:
 *   - read the vertical intent from `input.moveY` (-1 up, +1 down),
 *   - set `core.vy = climbIntent * climbSpeed` (0 sticks; ±climbSpeed climbs),
 *   - set `core.onGround = true`,
 *   - mark the state `climbing: true`.
 * Otherwise: `climbing: false`, no change (jump/kernel own vertical motion).
 *
 * Top-of-ladder guard: when climbing up, upward velocity is only applied if the
 * player's feet would still grip a ladder cell after this step. At the top
 * there is no cell above, so vy stays 0 and the player stops with its feet
 * within a single climb-step of the ladder top — flush with an adjacent
 * platform — and sticks cleanly, no bouncing. Ladder contact is read from a
 * thin band at the feet (not the whole body): the body is taller than a cell,
 * so a whole-body test would drop contact the moment the head cleared the
 * ladder while the feet were still on it, bouncing the player and leaving them
 * a few pixels too low to step off.
 *
 * Pure: never mutates input. Never throws. When `climbEnabled === false`,
 * returns the input state unchanged with no events.
 *
 * @module
 */

import { overlapsLadder } from '../../collision/aabb';
import type {
  AbilityContext,
  AbilityProcessor,
  AbilityResult,
  ClimbAbilityState,
  WritablePlatformerEvents,
} from '../types';

/**
 * Height of the "feet grip" band used to detect ladder contact, in world units.
 * Ladder overlap is tested against this band at the bottom of the body rather
 * than the whole AABB: the player is taller than a ladder cell, so a whole-body
 * test loses contact as soon as the head clears the ladder (while the feet are
 * still on it), which both bounces the player and leaves them too low to step
 * onto a flush platform. The grip band stays in contact until the feet leave the
 * top cell, so the player can climb flush with a platform and walk off.
 *
 * Kept small (half a reference tile) so the player grabs a ladder as the feet
 * arrive at a cell, not while the body is still a full tile above it.
 */
const LADDER_GRIP = 8;

/**
 * The canonical climb ability processor. State kind: `'climb'`.
 *
 * @example
 * ```ts
 * const pipeline = [...defaultPrecisionPipeline()]; // climb is included, last
 * ```
 */
export const climbAbility: AbilityProcessor<ClimbAbilityState> = {
  kind: 'climb',

  advance(
    ctx: AbilityContext,
    state: ClimbAbilityState,
  ): AbilityResult<ClimbAbilityState> {
    const { core, input, config, solids } = ctx;

    if (!config.climbEnabled) {
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

    // Jump wins: if the player jumps this tick, abandon the ladder and let
    // jump/kernel own vertical motion. This is the clean hand-off that avoids
    // the climb/jump desync.
    const jumping = input.jump.pressed;
    // Ladder detection keys off a thin band at the player's FEET, not the whole
    // body. The body is taller than a ladder cell, so a whole-body overlap test
    // would lose contact the instant the player climbed high enough for its feet
    // to reach a flush platform (the body top leaves the ladder while the feet
    // are still on it) — causing a fall-and-regrab bounce and leaving the player
    // a few pixels too low to step off. The feet band stays in contact as long
    // as the feet are in a ladder cell, so the player can climb until its feet
    // are flush with the platform and cleanly walk off.
    const feet = { x: core.x, y: core.y + core.height - LADDER_GRIP, width: core.width, height: LADDER_GRIP };
    // Ladder detection from the per-tick solids (ladders are `ladder: true`
    // solids — non-colliding, readable here). `solids` is optional on the
    // context; when absent there is nothing to climb.
    const onLadder = solids !== undefined && overlapsLadder(feet, solids);
    const climbing = onLadder && !jumping;

    let nextCore = core;
    if (climbing) {
      const climbIntent = input.moveY ?? 0;
      // climbIntent: -1 = up, +1 = down (same semantics as the retired `climb`
      // field, now unified on `moveY`). vy: negative = up, positive = down.
      let vy = climbIntent * config.climbSpeed;
      if (climbIntent < 0 && solids !== undefined) {
        // Top-of-ladder guard: only rise if the feet band would still overlap a
        // ladder cell after this step. Projecting the feet forward by the actual
        // per-tick climb displacement and checking overlap stops the player the
        // tick BEFORE its feet would leave the top cell — so the feet end up
        // within one climb step of the ladder top. That last step onto a flush
        // platform is bridged by the kernel's horizontal step-up (see
        // `stepHeight`), so holding Up + direction walks the player smoothly out
        // onto an adjacent floor. Because `onLadder` reads the same feet band,
        // it never flickers false during the approach, so there is no
        // fall-and-regrab bounce.
        //
        // The displacement is 2 * climbSpeed * dt, not climbSpeed * dt, because
        // the kernel applies the climb vy to Y twice per tick (once in climb
        // coordination, once in the Y resolver). Projecting by only one of those
        // halves under-counts and lets the feet escape the ladder — the bounce
        // this guard exists to prevent.
        const step = 2 * config.climbSpeed * ctx.dt;
        const feetAhead = {
          x: core.x,
          y: core.y + core.height - LADDER_GRIP - step,
          width: core.width,
          height: LADDER_GRIP,
        };
        if (!overlapsLadder(feetAhead, solids)) vy = 0;
      }
      nextCore = { ...core, vy, onGround: true };
    }

    return { core: nextCore, state: { kind: 'climb', climbing }, events };
  },
};
