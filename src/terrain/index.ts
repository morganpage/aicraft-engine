export type {
  TerrainNeighborMask,
  TerrainNeighborhood,
  TerrainConnectionTable,
  TerrainViewport,
  VisibleTileRange,
  ExposedSpan,
  TerrainRectExposure,
  TerrainRectInput,
  ComputeRectExposureOptions,
} from './types';
export {
  TERRAIN_NORTH,
  TERRAIN_NORTH_EAST,
  TERRAIN_EAST,
  TERRAIN_SOUTH_EAST,
  TERRAIN_SOUTH,
  TERRAIN_SOUTH_WEST,
  TERRAIN_WEST,
  TERRAIN_NORTH_WEST,
  sampleTerrainNeighborhood,
  connectsEqualValue,
  createTerrainConnector,
  createTerrainConnectionTable,
} from './connectivity';
export { visibleTileRange } from './viewport';
export { computeRectExposures } from './rect-exposure';
export type {
  TerrainPalette,
  BuiltinEdgeDetail,
  BuiltinSurfaceDetail,
  TerrainMaterialInput,
  TerrainRectRole,
} from './types';
export type { NormalizedTerrainMaterial, TerrainMaterialTable } from './material';
export {
  normalizeTerrainMaterial,
  createTerrainMaterialTable,
  RUINS_TERRAIN_MATERIAL,
  CAVERN_TERRAIN_MATERIAL,
  MECHANICAL_TERRAIN_MATERIAL,
  OUTDOOR_TERRAIN_MATERIAL,
} from './material';
export type { TerrainDetailContext, TerrainDetailRenderer } from './surface-detail';
export { drawBuiltinTerrainDetail } from './surface-detail';
export type { TerrainEdgeDetailContext, TerrainEdgeDetailRenderer } from './edge-detail';
export { drawBuiltinTerrainEdgeDetail } from './edge-detail';
export type { DrawTerrainTilesOptions } from './tile-renderer';
export { drawTerrainTiles } from './tile-renderer';
export type { DrawTerrainRectOptions } from './rect-renderer';
export { drawTerrainRect } from './rect-renderer';
