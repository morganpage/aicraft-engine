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
  ClimbAbilityState,
  WallGrabAbilityState,
  MantleAssistState,
  AnyAbilityState,
  PlatformerState,
  PlatformerConfig,
  MoveInput,
  InteractionEvent,
  InteractionKind,
  FeelMoment,
} from './types';

export {
  DEFAULT_PLATFORMER_CONFIG,
  DEFAULT_PLAYER_WIDTH,
  DEFAULT_PLAYER_HEIGHT,
  EMPTY_CONTACTS,
  EMPTY_EVENTS,
  EMPTY_INTERACTIONS,
  EMPTY_MOMENTS,
} from './constants';

export {
  normalizedImpactFor,
  hardLandingThresholdFor,
  landingMomentFor,
  DEFAULT_HARD_LANDING_THRESHOLD,
} from './feel-moments';

export {
  advanceSquash,
  DEFAULT_SQUASH_CONFIG,
  IDENTITY_SCALE,
  type SquashConfig,
  type SquashInput,
} from './squash';

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
export { climbAbility } from './abilities/climb-ability';
export { wallGrabAbility } from './abilities/wall-grab-ability';

export {
  compileLevel,
  compileGeneratedLevel,
  settlePlatformerState,
  solidIdForEntity,
  entityIdFromSolidId,
  advanceMovingPlatform,
  movingPlatformToSolid,
  createMovingPlatformDisplacementProvider,
  type CompiledLevel,
  type CompiledMovingPlatform,
  type CompileLevelOptions,
  type GeneratedLevelInput,
  type ResolvedPlatformerSpawn,
  type CompileDiagnostic,
  type CompileDiagnosticSeverity,
  type SettlePlatformerStateResult,
} from './level-runtime';

// Per-room LDtk glue — Celerock hardening Workstreams C4 / C5. Translates +
// compiles a single LDtk level into a bucketed CompiledLdtkRoom, and wraps a
// whole project in a lazy identity-stable cache.
export {
  compileLdtkRoom,
  createLdtkRoomCache,
  type CompileLdtkRoomOptions,
  type CompiledLdtkRoom,
  type LdtkRoomCache,
  type LdtkRoomCacheOptions,
  type GetLdtkStartRoomResult,
} from './ldtk-room';

// Phase E2 — pure, canvas-free room-transition helpers (Celerock hardening
// Workstream E). `findLdtkRoomExit → mapLdtkRoomEntry → transitionPlatformerToRoom`
// is the supported traversal path; `rebasePointBetweenLdtkRooms` carries
// particles across the seam. Composes the LDtk room cache + `__neighbours` graph.
export {
  findLdtkRoomExit,
  mapLdtkRoomEntry,
  transitionPlatformerToRoom,
  rebasePointBetweenLdtkRooms,
  type Cardinal,
  type LdtkRoomExit,
  type LdtkRoomEntry,
  type TransitionPlatformerToRoomOptions,
  type PlatformerRoomTransition,
} from './room-transitions';

// Phase E3 — slide presentation orchestrator. Composes the existing camera
// brain (no new solver) via a transient high-priority fixed vcam in a
// normalized two-room space, with explicit enter/finish/cancel rebases.
export {
  beginRoomSlide,
  advanceRoomSlide,
  presentationForRoomSlide,
  enterRoomSlideCameraSpace,
  finishRoomSlideCameraSpace,
  cancelRoomSlideCameraSpace,
  roomSlideEase,
  ROOM_SLIDE_VCAM_ID,
  DEFAULT_ROOM_SLIDE_DURATION,
  type RoomSlideView,
  type RoomSlideActorMapping,
  type RoomSlideOptions,
  type RoomSlideSpace,
  type RoomSlideState,
  type RoomSlidePresentation,
} from './room-slide';

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

// Tile-unit-aware config scaling — scale a 16px-reference config to any tile
// size while preserving feel (distances/velocities/accelerations scale; times,
// ratios, counts, and booleans do not). The exhaustive `keyof PlatformerConfig`
// classification is a compile-time gate so new fields cannot ship unclassified.
export {
  scalePlatformerConfig,
  scaleJumpConfig,
  createPrecisionPlatformerConfig,
  PLATFORMER_CONFIG_FIELD_UNITS,
  JUMP_CONFIG_FIELD_UNITS,
  PRECISION_REFERENCE_TILE_SIZE,
  type ConfigFieldUnit,
  type CreatePrecisionPlatformerConfigOptions,
} from './config-scale';

// Shared input constants. `IDLE_EDGE` is the canonical "mapped but not pressed"
// edge (prefer it over `null`, which disables an ability). The standard maps
// fit `createKeyboardAdapter` / `createGamepadAdapter` verbatim; the gamepad
// map uses W3C Standard button INDEX strings ('0', '12', …), not 'b0'/'dpleft'.
export {
  IDLE_EDGE,
  STANDARD_KEYBOARD_PLATFORMER_MAP,
  STANDARD_GAMEPAD_PLATFORMER_MAP,
} from './input-edges';

export {
  createEnemyBehaviorRegistry,
  spinnyBehavior,
  turretBehavior,
  spiderBehavior,
  chargerBehavior,
  CHARGER_HEIGHT,
  CHARGER_WIDTH,
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
  type ChargerParams,
  type ChargerPhase,
} from './enemy';
