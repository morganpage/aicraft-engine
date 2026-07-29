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

export {
  compileLevel,
  compileGeneratedLevel,
  advanceMovingPlatform,
  movingPlatformToSolid,
  createMovingPlatformDisplacementProvider,
  type CompiledLevel,
  type CompiledMovingPlatform,
  type CompileLevelOptions,
  type GeneratedLevelInput,
} from './level-runtime';

export {
  drawLevelEntity,
  drawActor,
  drawTileGrid,
  DEFAULT_ENTITY_PALETTE,
  type EntityPalette,
  type DrawLevelEntityOptions,
  type DrawLevelEntityOverrideMap,
} from './renderer';

export type {
  ResolvedLevelEntity,
  LevelRenderFrame,
  LevelTerrainTheme,
  LevelLayerRenderer,
  LevelRenderTheme,
  TerrainDiagnostic,
  LevelThemeRendererOptions,
  LevelThemeRenderer,
  PreparedLevelScene,
} from './level-theme';
export {
  TERRAIN_ROLE_KINDS,
  NON_TERRAIN_KINDS,
  createLevelThemeRenderer,
  resolveLevelEntities,
} from './level-theme';
export type { DrawPreparedLevelFrameOptions } from './level-layers';
export { drawPreparedLevelFrame } from './level-layers';
export { RUINS_LEVEL_THEME } from './themes/ruins';
export { CAVERN_LEVEL_THEME } from './themes/cavern';
export { MECHANICAL_LEVEL_THEME } from './themes/mechanical';
export { OUTDOOR_LEVEL_THEME } from './themes/outdoor';
export type { DrawThemedLevelEntityOptions } from './themed-entity-renderer';
export { drawThemedLevelEntity } from './themed-entity-renderer';
export {
  drawRuinsDust,
  drawCavernDrips,
  drawMechanicalSparks,
} from './atmosphere-recipes';
export type {
  LevelThemeOption,
  ResolvedLevelThemeOption,
  DrawLevelThumbnailOptions,
} from './theme-preview';
export { resolveLevelThemeOption, drawLevelThumbnail } from './theme-preview';

export {
  PRECISION_PLATFORMER,
  CLASSIC_PLATFORMER,
  EXPLORATION_PLATFORMER,
  PUZZLE_PLATFORMER,
} from './presets';

export {
  createEnemyBehaviorRegistry,
  spinnyBehavior,
  turretBehavior,
  spiderBehavior,
  stepProjectile,
  compileEnemies,
  stepEnemies,
  drawEnemies,
  drawProjectiles,
  type StepEnemiesResult,
  type EnemyPalette,
  type EnemyArchetype,
  type EnemyState,
  type EnemyStepResult,
  type EnemyBehaviorHandler,
  type EnemyUpdateContext,
  type ProjectileState,
  type ProjectileStepResult,
  type CompiledEnemy,
  type EnemyBehaviorRegistry,
} from './enemy';
