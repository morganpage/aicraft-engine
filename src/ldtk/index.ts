/**
 * LDtk module — parse and translate `.ldtk` level files.
 *
 * Self-contained, zero-dependency. Mirrors the runtime-relevant subset of
 * the LDtk JSON schema (https://ldtk.io/json/). The parser never throws;
 * the translator bridges into the engine's {@link LevelData} schema.
 *
 * Determinism summary:
 *  - No `Math.random` or `Date.now()` anywhere.
 *  - All exports are pure functions over plain data.
 *  - `parseLdtkProject`, `parseLdtkLevelFile`, and `ldtkLevelToLevelData`
 *    never throw on any input.
 *
 * @module
 */

export type {
  LdtkLayerType,
  LdtkWorldLayout,
  LdtkTile,
  LdtkTilesetDef,
  LdtkFieldInstance,
  LdtkEntityInstance,
  LdtkLayerInstance,
  LdtkNeighbour,
  LdtkLevel,
  LdtkDefinitions,
  LdtkEnumDef,
  LdtkEnumValueDef,
  LdtkIntGridValueDef,
  LdtkIntGridValueGroupDef,
  LdtkLayerDef,
  LdtkWorld,
  LdtkProject,
  LdtkParseResult,
  LdtkParseError,
  LdtkAutoRule,
  LdtkAutoRuleGroup,
  LdtkTileMode,
  LdtkCheckerMode,
  LdtkEntityDef,
  LdtkEntityRenderMode,
  LdtkFieldDef,
} from './types';

export { LDTK_RULE_ANY_VALUE, LDTK_RULE_GROUP_STRIDE } from './types';

export type {
  LdtkRuleGridSource,
  LdtkRuleTileset,
  RunLdtkAutoLayerOptions,
} from './rules';

export {
  runLdtkAutoLayer,
  ldtkRuleSourceFromCsv,
  ldtkOpaqueTileLookup,
} from './rules';

export { ldtkRandSeedCoords, ldtkPerlin } from './rng';

export type {
  LdtkCellEdit,
  LdtkCellRect,
  LdtkEditResult,
} from './edit';

export {
  LDTK_MAX_PATTERN_SIZE,
  addLdtkEntity,
  moveLdtkEntity,
  paintLdtkIntGrid,
  removeLdtkEntity,
  resizeLdtkLevel,
  setLdtkEntityField,
  setLdtkLayerTiles,
  setLdtkOptionalRuleGroup,
  widenDirtyRect,
} from './edit';

export type { LdtkDocument, LdtkReadResult } from './write';

export { readLdtkDocument, writeLdtkDocument } from './write';

export { formatLdtkJson } from './format';

export type {
  LdtkEntityMap,
  LdtkTranslateDiagnostic,
  LdtkTranslateResult,
  LdtkTranslateOptions,
} from './translate';

export { parseLdtkProject, parseLdtkLevelFile } from './parse';

export {
  LDTK_DEFAULT_ENTITY_MAP,
  ldtkLevelToLevelData,
  translateLdtkEntity,
} from './translate';

export type {
  LdtkTilesetImage,
  LdtkTilesetBundle,
  LdtkDrawView,
  DrawLdtkLayerOptions,
  DrawLdtkLevelOptions,
} from './render';

export {
  drawLdtkLayer,
  drawLdtkLevel,
  buildLdtkTilesetBundle,
} from './render';

export type {
  LdtkSurfaceCanvas,
  LdtkSurfaceCanvasFactory,
  LdtkLevelSurfaceCache,
  LdtkLevelSurfaceCacheOptions,
} from './surface';

export { createLdtkLevelSurfaceCache } from './surface';

export type {
  LdtkAssetDiagnosticSeverity,
  LdtkAssetDiagnostic,
  LoadLdtkProjectAssetsOptions,
  LoadLdtkProjectAssetsOk,
  LoadLdtkProjectAssetsErr,
  LoadLdtkProjectAssetsResult,
} from './load';

export { loadLdtkProjectAssets, DEFAULT_IMAGE_TIMEOUT_MS } from './load';

export type {
  LdtkPlatformerCapabilities,
  LdtkPlatformerLevelReport,
  LdtkPlatformerProjectReport,
} from './preflight';

export { inspectLdtkPlatformerProject } from './preflight';
