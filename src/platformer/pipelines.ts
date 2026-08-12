/**
 * Ability-pipeline factories for the platformer kernel.
 *
 * Per decision §"Pipeline serialization — fixed pipeline + config hash": the
 * pipeline is fixed per-controller-instance. The library provides a
 * `defaultPrecisionPipeline()` factory that returns the canonical pipeline;
 * consumers extend by composing (e.g. `[...defaultPrecisionPipeline(), grappleAbility]`).
 *
 * Pipeline order is locked per the decision's update order:
 *   `jump → dashTech → wallSlide → wallGrab → dash → doubleJump → climb`
 *
 * Rationale (see proposal §"Justification for ordering"):
 *   - Jump first so its pose state machine advances before any other ability
 *     reacts, and so its `LaunchIntent` (when it fires) is in the pool the
 *     kernel arbitrates. Jump no longer writes `core.vy` (Phase 0b) — it emits
 *     a launch; the kernel applies the winner.
 *   - Dash-tech SECOND (Phase 5, after jump) so on a `jump.pressed` it can
 *     emit a `superJump` / `superWallJump` `LaunchIntent` that ARBITRATES OUT
 *     the plain ground jump `jumpAbility` emitted the same tick (priority
 *     order in `LAUNCH_PRIORITY`). It reads the previous tick's resolved
 *     `locomotion` (last dash dir / ducking / grace / dashing) — running right
 *     after jump keeps both jump-class launches in the same tick's pool. It
 *     does not modify `core`, so its position relative to wall-slide/dash only
 *     affects the launch pool, not velocity.
 *   - Wall-slide third so it can clamp vy (post-jump) when slide conditions
 *     hold, and emit its own wall-jump `LaunchIntent` on a jump press.
 *   - Wall-grab fourth (Phase 6, after wall-slide). Wall-grab and wall-slide
 *     are mutually exclusive by INPUT (wall-grab needs `grab.held`; wall-slide
 *     needs `moveX`-into-wall AND `!grab.held` — the wall-slide ability yields
 *     when grab is held), so they never fight for the same wall. Placing
 *     wall-grab after wall-slide means a climb-hop `LaunchIntent`
 *     (`source: 'climbHop'`, priority 3) is in the same pool as any plain
 *     jump/doubleJump launch emitted earlier on the `jump.pressed` tick, and
 *     arbitration correctly picks the hop. It writes `core.vy`/`vx` directly
 *     only while `grabbing` (its exclusive mode owns velocity that tick).
 *   - Dash fifth so its sustained velocity override owns the tick when active
 *     (the kernel resolves `'dash'` mode and skips gravity/horizontal-input).
 *   - Double-jump so it can emit a `LaunchIntent` on the airborne tick
 *     immediately after the first jump leaves the ground.
 *   - Climb last so its ladder vertical-velocity decision is the one that
 *     survives into collision/integration, and so the kernel resolves
 *     `'ladder'` mode from its final `climbing` flag (gravity skip, Y restore,
 *     jump reset). Multiple launches emitted in one tick are arbitrated by
 *     the kernel AFTER the full pipeline completes (priority order in
 *     `LAUNCH_PRIORITY`), so order within the pipeline only affects the pose /
 *     clamp side-effects, not which launch wins.
 *
 * @module
 */

import type { AbilityProcessor, AnyAbilityState } from './types';
import { jumpAbility } from './abilities/jump-ability';
import { dashTechAbility } from './abilities/dash-tech-ability';
import { wallSlideAbility } from './abilities/wall-slide-ability';
import { wallGrabAbility } from './abilities/wall-grab-ability';
import { dashAbility } from './abilities/dash-ability';
import { doubleJumpAbility } from './abilities/double-jump-ability';
import { climbAbility } from './abilities/climb-ability';

/**
 * Return the canonical precision-platformer ability pipeline.
 *
 * Order: `jumpAbility → dashTechAbility → wallSlideAbility → wallGrabAbility →
 * dashAbility → doubleJumpAbility → climbAbility`. Pass to
 * `createPlatformerController` as the pipeline argument. Consumers extend by
 * composing:
 *
 * @example
 * ```ts
 * const custom = [...defaultPrecisionPipeline(), grappleAbility];
 * const controller = createPlatformerController(custom, config);
 * ```
 *
 * A fresh array is returned each call so consumers can safely mutate (e.g.
 * `pop()`, `splice()`) without affecting other callers.
 *
 * @returns a new array containing the seven default ability processors in order
 */
export function defaultPrecisionPipeline(): readonly AbilityProcessor<AnyAbilityState>[] {
  return [
    jumpAbility as AbilityProcessor<AnyAbilityState>,
    dashTechAbility as AbilityProcessor<AnyAbilityState>,
    wallSlideAbility as AbilityProcessor<AnyAbilityState>,
    wallGrabAbility as AbilityProcessor<AnyAbilityState>,
    dashAbility as AbilityProcessor<AnyAbilityState>,
    doubleJumpAbility as AbilityProcessor<AnyAbilityState>,
    climbAbility as AbilityProcessor<AnyAbilityState>,
  ];
}
