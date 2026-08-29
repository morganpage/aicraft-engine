export type {
  TerrainMaterialId,
  TerrainArtLayerId,
  TerrainVariantId,
  TerrainArtDualGridMask,
  TerrainCollisionRole,
  TerrainKindDefinition,
  TerrainArtPalette,
  TerrainGeneratorSettings,
  TerrainArtCoverage,
  TerrainArtSourceTile,
  TerrainArtPixelAtlas,
  TerrainArtBlendMode,
  TerrainArtLayerType,
  TerrainArtLayer,
  TerrainArtRule,
  TerrainArtRulePattern,
  TerrainArtRuleSet,
  TerrainTilesetTileRef,
  TerrainTilesetRoleMap,
  TerrainArtTilesetBinding,
  TerrainPixelRun,
  TerrainSourcePatch,
  TerrainVariantDefinition,
  TerrainMaterialDefinition,
  TerrainTransitionRule,
  TerrainOccurrenceOverride,
  TerrainOccurrenceLayerPatch,
  TerrainArtOccurrenceStatus,
  TerrainArtProject,
  ResolvedTerrainArtMaterial,
  ResolvedTerrainArtDualTile,
  PreparedTerrainArtDualGrid,
  TerrainArtGridCell,
  TerrainArtLogicalCornerHit,
  TerrainArtVisualHit,
  TerrainArtDiagnostic,
  TerrainArtValidationResult,
} from './types';
export {
  TERRAIN_ART_PROJECT_VERSION,
  DEFAULT_TERRAIN_ART_RESOLUTION,
  MIN_TERRAIN_ART_RESOLUTION,
  MAX_TERRAIN_ART_RESOLUTION,
  DEFAULT_TERRAIN_ART_SEED,
  TERRAIN_ART_RESOLUTION_PRESETS,
  terrainArtMaterialResolution,
} from './constants';
export type { CreateTerrainArtProjectOptions } from './factory';
export { createTerrainArtProject, createTerrainArtMaterial } from './factory';
export {
  DUAL_GRID_NORTH_WEST,
  DUAL_GRID_NORTH_EAST,
  DUAL_GRID_SOUTH_EAST,
  DUAL_GRID_SOUTH_WEST,
  resolveTerrainArtDualTile,
  prepareTerrainArtDualGrid,
  dualGridCellsForLogicalCell,
} from './dual-grid';
export { validateTerrainArtProject } from './validate';
export {
  serializeTerrainArtProject,
  deserializeTerrainArtProject,
} from './serialize';
export type { GenerateTerrainArtCoverageOptions } from './coverage';
export {
  generateTerrainArtCoverage,
  deriveTerrainArtContour,
} from './coverage';
export type {
  TerrainArtImportedAssetRequest,
  TerrainArtImportedAssetResolver,
} from './compositor';
export { renderTerrainArtSourceTile } from './compositor';
export { generateTerrainArtMaterialAtlas } from './atlas';
export type {
  TerrainTilesetSource,
  TerrainArtTilesetImage,
  ImportTerrainArtTilesetOptions,
} from './import-tileset';
export {
  importTerrainArtTilesetAtlas,
  createTerrainArtTilesetResolver,
  createTerrainArtTilesetBinding,
  createImportedTerrainArtMaterial,
  createRuleTerrainArtMaterial,
  kenneyPixelPlatformerRoles,
  kenneyPixelPlatformerRules,
  TERRAIN_TILESET_ROLE_KEYS,
} from './import-tileset';
export type { TerrainArtRuleAtlas, TerrainArtRuleAtlasEntry } from './rule-atlas';
export { buildTerrainArtRuleAtlas } from './rule-atlas';
export type { RuleNeighborhood } from './rule-tiles';
export { matchRule, ruleSpecificity, RULE_PATTERN_SIZE } from './rule-tiles';
export type { TerrainArtRuleResolver } from './rule-resolver';
export { createTerrainArtRuleResolver } from './rule-resolver';
export type { PreparedTerrainArtRuleGrid, ResolvedTerrainArtRuleCell } from './rule-grid';
export { prepareTerrainArtRuleGrid } from './rule-grid';
export { hitTestTerrainArtDualGrid } from './hit-test';
export type { TerrainArtPixelEdit } from './manual-paint';
export { editTerrainArtSourceTile, clearTerrainArtSourceTileEdits } from './manual-paint';
export type { TerrainGeneratorSettingsUpdate } from './generator-settings';
export { updateTerrainArtGenerator } from './generator-settings';
export type { TerrainArtPixelPoint } from './pixel-tools';
export { terrainArtLinePixels, terrainArtRectanglePixels, terrainArtEllipsePixels, terrainArtFloodFillPixels } from './pixel-tools';
export type { TerrainArtExposure } from './variants';
export { terrainArtMaskExposure, selectTerrainArtVariant } from './variants';
export { getTerrainArtOccurrenceStatus, activeTerrainArtOccurrenceOverrides, rebindTerrainArtOccurrenceOverride, deleteTerrainArtOccurrenceOverride, setTerrainArtOccurrenceLayerPatch, pinTerrainArtOccurrenceVariant, clearTerrainArtOccurrenceOverrides, hideTerrainArtOccurrenceOverride, editTerrainArtOccurrenceLayer } from './occurrence-overrides';
export type { TerrainArtPresetId } from './project-operations';
export { addTerrainArtMaterial, removeTerrainArtMaterial, renameTerrainArtMaterial, resetTerrainArtMaterial, applyTerrainArtPreset, updateTerrainArtLayer, reorderTerrainArtLayer, resizeTerrainArtProject } from './project-operations';
export { paintTerrainArtLogicalCells, terrainArtLogicalLine, terrainArtLogicalRectangle, terrainArtLogicalFill, pickTerrainArtLogicalValue } from './logical-tools';
export type { TerrainArtStorageAdapter, TerrainArtStorageResult } from './storage';
export { createMemoryTerrainArtStorage, saveTerrainArtProject, loadTerrainArtProject, hashTerrainArtProject } from './storage';
export type { CompiledTerrainArtAtlas, TerrainArtRuntimeMaterialEntry, TerrainArtRuntimeManifest, CompiledTerrainArtRuntime } from './compiler';
export { compileTerrainArtRuntime, terrainArtRuntimeSourceRect } from './compiler';
export { migrateTerrainArtProject } from './migrate';
export type { TerrainArtTransform, TerrainArtPixelSelection } from './manual-transform';
export { transformTerrainArtSourceTile, moveTerrainArtSourceTile, moveTerrainArtSourceSelection, stampTerrainArtSourceTile } from './manual-transform';
export type { TerrainArtImageData, TerrainArtImageEncoder } from './export';
export { exportTerrainArtContactSheet } from './export';
export type { ResolvedTerrainArtTransition } from './transitions';
export { resolveTerrainArtTransitions, setTerrainArtTransitionRule } from './transitions';
export { addTerrainArtVariant, updateTerrainArtVariant, removeTerrainArtVariant, terrainArtVariantUsage } from './variant-operations';
export { renderTerrainArtOccurrenceTile } from './occurrence-renderer';
export { diagnoseTerrainArtExport } from './diagnostics';
export type { TerrainArtRenderCache } from './cache';
export { createTerrainArtRenderCache } from './cache';
export { renderResolvedTerrainArtTile } from './multi-material-compositor';
export type {
  TerrainArtDrawView,
  DrawPreparedTerrainArtDualGridOptions,
} from './runtime-renderer';
export { drawPreparedTerrainArtDualGrid } from './runtime-renderer';
export type { DrawCompiledTerrainArtDualGridOptions } from './runtime-renderer';
export { drawCompiledTerrainArtDualGrid } from './runtime-renderer';
export type { DrawPreparedTerrainArtRuleGridOptions } from './runtime-renderer';
export { drawPreparedTerrainArtRuleGrid } from './runtime-renderer';

// Terrain pieces — rendering a terrain fragment as a finished object rather
// than a sliced rectangle. The rendering sibling of `collision/moving-gap`.
export type {
  TerrainPieceRect,
  RectsToTileGridResult,
  TerrainPieceBondPolicy,
  TerrainPiece,
} from './piece';
export {
  rectsToTileGrid,
  resolveTerrainPieceFromPrepared,
  resolveTerrainPiece,
} from './piece';
export type {
  TerrainPieceCanvas,
  TerrainPieceCanvasFactory,
  BakeTerrainPieceOptions,
  BakedTerrainPiece,
  TerrainPieceCache,
  TerrainPieceAnchor,
} from './piece-render';
export {
  bakeTerrainPiece,
  terrainPieceFingerprint,
  createTerrainPieceCache,
  drawClippedTerrainPiece,
  drawMaskedTerrainPiece,
} from './piece-render';
