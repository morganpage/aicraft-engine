/**
 * Platformer kernel module — Composable Ability Processors (decision §B).
 *
 * A thin `PlatformerState` core (position, velocity, contacts) plus separate
 * ability modules (`JumpAbility`, `WallSlideAbility`, `DashAbility`,
 * `DoubleJumpAbility`), each with its own state slice and an `advance`
 * function. The controller runs the pipeline in a fixed, deterministic order
 * per tick. Composes `advanceJump` and `resolveAxisX`/`resolveAxisY` rather
 * than duplicating them.
 *
 * **Purity:** immutable `ActorCore` and `AbilityState`; abilities return new
 * shallow-copied cores via spread. The kernel never mutates input.
 *
 * **Determinism:** same `(state, input, solids, dt)` → byte-identical
 * returned state. No `Math.random`, no `Date.now`, no DOM reads.
 *
 * See:
 *   - `docs/design/platformer-kernel-decision.md` (locked decision)
 *   - `docs/design/platformer-kernel-proposal.md` (full proposal)
 *
 * @module
 */

export type {
  Contacts,
  PlatformerEvents,
  PlatformerInput,
  ActorCore,
  AbilityState,
  AbilityContext,
  AbilityResult,
  AbilityProcessor,
  JumpAbilityState,
  WallSlideAbilityState,
  DashAbilityState,
  DoubleJumpAbilityState,
  AnyAbilityState,
  PlatformerState,
  PlatformerConfig,
  MoveInput,
} from './types';

export {
  DEFAULT_PLATFORMER_CONFIG,
  DEFAULT_PLAYER_WIDTH,
  DEFAULT_PLAYER_HEIGHT,
  EMPTY_CONTACTS,
  EMPTY_EVENTS,
} from './constants';

export {
  createRidingTracker,
  type RidingTracker,
  type SolidDisplacement,
  type SolidDisplacementProvider,
} from './riding-tracker';

export {
  createPlatformerController,
  createPlatformerState,
  stepPlatformer,
  type PlatformerController,
  type PlatformerControllerOptions,
} from './kernel';

export { defaultPrecisionPipeline } from './pipelines';

export { jumpAbility } from './abilities/jump-ability';
export { wallSlideAbility } from './abilities/wall-slide-ability';
export { dashAbility } from './abilities/dash-ability';
export { doubleJumpAbility } from './abilities/double-jump-ability';
