/**
 * Ability-pipeline factories for the platformer kernel.
 *
 * Per decision §"Pipeline serialization — fixed pipeline + config hash": the
 * pipeline is fixed per-controller-instance. The library provides a
 * `defaultPrecisionPipeline()` factory that returns the canonical pipeline;
 * consumers extend by composing (e.g. `[...defaultPrecisionPipeline(), grappleAbility]`).
 *
 * Pipeline order is locked per the decision's update order:
 *   `jump → wallSlide → dash → doubleJump → climb`
 *
 * Rationale (see proposal §"Justification for ordering"):
 *   - Jump first so its launch velocity sets the baseline for vy.
 *   - Wall-slide second so it can clamp vy (post-jump) when conditions hold.
 *   - Dash third so a dash (which overrides velocity) wins over jump/wall-jump
 *     on the same tick.
 *   - Double-jump so it can fire on the airborne tick immediately after the
 *     first jump leaves the ground.
 *   - Climb last so its ladder vertical-velocity decision is the one that
 *     survives into collision/integration — jump otherwise overwrites
 *     `core.vy` from its internal state every tick. The kernel's climb
 *     coordination (gravity skip, Y restore, jump reset) keys off the climb
 *     state this ability sets.
 *
 * @module
 */

import type { AbilityProcessor, AnyAbilityState } from './types';
import { jumpAbility } from './abilities/jump-ability';
import { wallSlideAbility } from './abilities/wall-slide-ability';
import { dashAbility } from './abilities/dash-ability';
import { doubleJumpAbility } from './abilities/double-jump-ability';
import { climbAbility } from './abilities/climb-ability';

/**
 * Return the canonical precision-platformer ability pipeline.
 *
 * Order: `jumpAbility → wallSlideAbility → dashAbility → doubleJumpAbility`.
 * Pass to `createPlatformerController` as the pipeline argument. Consumers
 * extend by composing:
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
 * @returns a new array containing the four default ability processors in order
 */
export function defaultPrecisionPipeline(): readonly AbilityProcessor<AnyAbilityState>[] {
  return [
    jumpAbility as AbilityProcessor<AnyAbilityState>,
    wallSlideAbility as AbilityProcessor<AnyAbilityState>,
    dashAbility as AbilityProcessor<AnyAbilityState>,
    doubleJumpAbility as AbilityProcessor<AnyAbilityState>,
    climbAbility as AbilityProcessor<AnyAbilityState>,
  ];
}
