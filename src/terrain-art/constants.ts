/** Current editable terrain-art source schema version. */
export const TERRAIN_ART_PROJECT_VERSION = 1;

/** Default source-tile authoring resolution. */
export const DEFAULT_TERRAIN_ART_RESOLUTION = 64;

/** Smallest accepted source-tile resolution. */
export const MIN_TERRAIN_ART_RESOLUTION = 4;

/** Largest accepted source-tile resolution in the initial implementation. */
export const MAX_TERRAIN_ART_RESOLUTION = 128;

/** Default deterministic visual seed. */
export const DEFAULT_TERRAIN_ART_SEED = 1337;

/** Tested resolutions exposed by the reference editor. */
export const TERRAIN_ART_RESOLUTION_PRESETS = Object.freeze([
  16, 32, 48, 64, 96, 128,
] as const);

/**
 * Resolve the source-tile resolution one material actually authors at.
 *
 * A material may pin its own `resolution` — imported tilesets do, so their art
 * keeps its native pixel grid instead of being resampled to the project
 * default. Everything else inherits `project.authoringResolution`. Returns `0`
 * when neither value is a usable positive integer, matching how the compositor
 * and atlas already signal "nothing to render".
 */
export function terrainArtMaterialResolution(
  authoringResolution: number,
  materialResolution?: number,
): number {
  const own = Number.isInteger(materialResolution) && (materialResolution as number) > 0
    ? materialResolution as number
    : undefined;
  const resolved = own ?? authoringResolution;
  return Number.isInteger(resolved) && resolved > 0 ? resolved : 0;
}
