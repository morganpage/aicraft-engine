/**
 * Level module (Pillar 4) — versioned 2D platformer level schema.
 *
 * Discriminated-union entity taxonomy, forward-ladder migration, defensive
 * validation, pure entity-ID allocation, tile-grid bridge to
 * {@link TileSolidityQuery}, and canonical serialization + FNV-1a hashing
 * for share codes.
 *
 * Determinism summary:
 *  - No `Math.random` or `Date.now()` anywhere.
 *  - All exports are pure functions over plain data.
 *  - `migrateLevel`, `validateLevel`, `allocateEntityId`, `canonicalize`, and
 *    `fnv1a` never throw on any input.
 *
 * @module
 */

export type {
  LevelRect,
  EntityId,
  EntityKind,
  ExitProps,
  PlatformProps,
  TrapProps,
  DecorationProps,
  TriggerProps,
  MovingPlatformProps,
  EnemyProps,
  CollectibleKind,
  CollectibleProps,
  LevelEntity,
  TileGrid,
  LevelFlags,
  LevelData,
  ValidationResult,
  ValidationError,
  ValidationErrorSeverity,
  LevelMigration,
} from './types';

export type { LevelMigrationResult } from './migrate';

export {
  LEVEL_VERSION,
  DEFAULT_TILE_SIZE,
  DEFAULT_LEVEL_WIDTH,
  DEFAULT_LEVEL_HEIGHT,
  DEFAULT_ENTITY_ID_START,
} from './constants';

export { migrateLevel } from './migrate';

export { validateLevel } from './validate';

export { createTileQuery } from './tiles';

export { allocateEntityId } from './entity-id';

export { canonicalize, fnv1a } from './serialize';
