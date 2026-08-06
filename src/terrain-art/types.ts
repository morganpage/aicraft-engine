/** A stable author-facing material identifier. */
export type TerrainMaterialId = string;

/** A stable art-layer identifier within one material. */
export type TerrainArtLayerId = string;

/** A stable visual-variant identifier within one material. */
export type TerrainVariantId = string;

/** Four-bit clockwise corner mask. Zero is transparent. */
export type TerrainArtDualGridMask =
  | 0 | 1 | 2 | 3
  | 4 | 5 | 6 | 7
  | 8 | 9 | 10 | 11
  | 12 | 13 | 14 | 15;

/** Gameplay meaning assigned to one logical terrain kind. */
export type TerrainCollisionRole =
  | 'empty'
  | 'solid'
  | 'passthrough'
  | 'hazard'
  | 'liquid';

/** Serializable brush definition mapping a tile value to gameplay and art. */
export interface TerrainKindDefinition {
  readonly id: string;
  readonly label: string;
  readonly tileValue: number;
  readonly collision: TerrainCollisionRole;
  readonly materialId: TerrainMaterialId | null;
  readonly connectGroup: string;
  readonly renderPriority: number;
  readonly tags?: readonly string[];
}

/** Palette used by procedural and palette-linked manual layers. */
export interface TerrainArtPalette {
  readonly fill: string;
  readonly contour: string;
  readonly highlight: string;
  readonly shadow: string;
  readonly detail: string;
  readonly accent: string;
}

/** Procedural controls shared by the generated layers of one material. */
export interface TerrainGeneratorSettings {
  readonly roundness: number;
  readonly contourWidth: number;
  readonly contourPlacement: 'inside' | 'center' | 'outside';
  readonly topHighlightDepth: number;
  readonly sideShadeDepth: number;
  readonly detailDensity: number;
  readonly detailScale: number;
  readonly antialias: 'none' | 'coverage';
  readonly clipManualToSilhouette: boolean;
}

/** Canonical generated fill coverage for one mask and resolution. */
export interface TerrainArtCoverage {
  readonly mask: TerrainArtDualGridMask;
  readonly resolution: number;
  readonly roundness: number;
  readonly pixels: Uint8Array;
}

/** Flattened RGBA pixels for one reusable material/mask/variant tile. */
export interface TerrainArtSourceTile {
  readonly materialId: TerrainMaterialId;
  readonly variantId: TerrainVariantId;
  readonly mask: TerrainArtDualGridMask;
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8ClampedArray;
}

/** Deterministic 4×4 preview atlas containing masks zero through fifteen. */
export interface TerrainArtPixelAtlas {
  readonly materialId: TerrainMaterialId;
  readonly variantId: TerrainVariantId;
  readonly width: number;
  readonly height: number;
  readonly tileSize: number;
  readonly columns: 4;
  readonly rows: 4;
  readonly pixels: Uint8ClampedArray;
  readonly maskToIndex: readonly number[];
}

/** Blend operation used while authoring and flattened during compilation. */
export type TerrainArtBlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'add'
  | 'replace'
  | 'erase';

/** Available non-destructive source-layer kinds. */
export type TerrainArtLayerType =
  | 'base'
  | 'shading'
  | 'contour'
  | 'decoration'
  | 'manual'
  | 'imported'
  | 'rule';

/** Zero-based position of one tile within an imported tileset image. */
export interface TerrainTilesetTileRef {
  readonly col: number;
  readonly row: number;
}

/**
 * Which source tile plays each role in a 3×3 minimal wall block. Corner roles
 * are named for the corner of the solid mass they occupy, so `topLeft` is the
 * tile exposed on its top and left faces.
 */
export interface TerrainTilesetRoleMap {
  readonly fill: TerrainTilesetTileRef;
  readonly top: TerrainTilesetTileRef;
  readonly right: TerrainTilesetTileRef;
  readonly bottom: TerrainTilesetTileRef;
  readonly left: TerrainTilesetTileRef;
  readonly topLeft: TerrainTilesetTileRef;
  readonly topRight: TerrainTilesetTileRef;
  readonly bottomRight: TerrainTilesetTileRef;
  readonly bottomLeft: TerrainTilesetTileRef;
}

/**
 * How an imported tileset image is sliced, stored with the project.
 *
 * Only the slicing survives serialization; the image itself does not. The
 * project names an `assetId` and the host supplies those pixels at render time
 * through a `TerrainArtImportedAssetResolver` — the same split LDtk uses when it
 * stores a path to a tileset rather than the tileset.
 */
export interface TerrainArtTilesetBinding {
  readonly tileSize: number;
  readonly margin?: number;
  readonly spacing?: number;
  readonly roles: Readonly<TerrainTilesetRoleMap>;
}

/**
 * A 3×3 cell-match condition for a rule, LDtk-style.
 *
 * Row-major, length 9, with the center (index 4) describing the cell itself.
 * Each value is one of:
 *   `1` — this cell must carry the matched terrain value (solid),
 *   `0` — this cell must be empty (value 0),
 *  `-1` — wildcard (don't care).
 *
 * Index order: `[NW, N, NE, W, C, E, SW, S, SE]`. A rule matches a logical cell
 * when its eight-neighbourhood + self agrees on every non-wildcard slot. The
 * optional `flipX` / `flipY` also match the mirrored pattern (LDtk symmetry).
 */
export type TerrainArtRulePattern = readonly number[];

/** One LDtk-style auto-layer rule: a 3×3 pattern that paints a whole source tile. */
export interface TerrainArtRule {
  /** Length-9 match pattern. See `TerrainArtRulePattern`. */
  readonly pattern: TerrainArtRulePattern;
  /** Which source tile to paint when the pattern matches (col/row in the sheet). */
  readonly tile: TerrainTilesetTileRef;
  /** Also match the horizontally-mirrored pattern. Defaults to false. */
  readonly flipX?: boolean;
  /** Also match the vertically-mirrored pattern. Defaults to false. */
  readonly flipY?: boolean;
  /**
   * Composite seam fix: when set, replace this tile's bottom `fillBottom` rows
   * with the same rows of a sibling "fill" tile (the fully-interior body tile)
   * before packing into the atlas. Used for surface tiles (e.g. grass) that
   * carry a bottom outline meant only for 1-tile-thick platforms — when the
   * tile sits over a solid interior, the outline would form a seam, so it is
   * replaced with the body. `fillTile` names the body tile to copy from.
   */
  readonly fillBottom?: number;
  /** The body tile whose bottom rows replace this tile's, when `fillBottom` is set. */
  readonly fillTile?: TerrainTilesetTileRef;
}

/**
 * An ordered set of whole-tile rules. First match wins — earlier rules take
 * precedence over later ones, matching LDtk's rule ordering. Serializes into
 * the project so an imported material's auto-tiling is fully described by data.
 */
export interface TerrainArtRuleSet {
  readonly rules: readonly TerrainArtRule[];
}

/** Serializable non-destructive layer definition. */
export interface TerrainArtLayer {
  readonly id: TerrainArtLayerId;
  readonly name: string;
  readonly type: TerrainArtLayerType;
  readonly visible: boolean;
  readonly locked: boolean;
  readonly opacity: number;
  readonly blendMode: TerrainArtBlendMode;
  readonly clipMode: 'none' | 'material-silhouette' | 'world-silhouette';
  readonly patches?: readonly TerrainSourcePatch[];
  readonly assetId?: string;
  /** Slicing for an `imported` or `rule` layer. Ignored by every other layer type. */
  readonly tileset?: Readonly<TerrainArtTilesetBinding>;
  /** Auto-tiling rules for a `rule` layer. Ignored by every other layer type. */
  readonly rules?: Readonly<TerrainArtRuleSet>;
}

/** One normalized row run in a sparse manual source patch. */
export interface TerrainPixelRun {
  readonly y: number;
  readonly x: number;
  readonly length: number;
  readonly mode: 'paint' | 'erase';
  readonly rgba?: number;
  readonly colorRef?: keyof TerrainArtPalette;
}

/** Manual changes for one reusable material/mask/variant source tile. */
export interface TerrainSourcePatch {
  readonly mask: TerrainArtDualGridMask;
  readonly variantId: TerrainVariantId;
  readonly runs: readonly TerrainPixelRun[];
}

/** Deterministically weighted visual alternative for one material. */
export interface TerrainVariantDefinition {
  readonly id: TerrainVariantId;
  readonly label: string;
  readonly enabled: boolean;
  readonly weight: number;
  readonly eligibleMasks: readonly TerrainArtDualGridMask[];
  readonly exposure: 'any' | 'top' | 'side' | 'interior';
  readonly seedOffset: number;
}

/** Complete reusable source-art definition for one terrain material. */
export interface TerrainMaterialDefinition {
  readonly id: TerrainMaterialId;
  readonly name: string;
  readonly enabled: boolean;
  readonly priority: number;
  /**
   * Native source-tile resolution for this material. Omitted means "follow the
   * project's `authoringResolution`", which is what procedural materials do.
   * Imported materials set it to their tileset's own tile size so their art is
   * never resampled; the renderer already scales atlas tiles to the world tile
   * size at draw time.
   */
  readonly resolution?: number;
  readonly palette: Readonly<TerrainArtPalette>;
  readonly generator: Readonly<TerrainGeneratorSettings>;
  readonly layers: readonly Readonly<TerrainArtLayer>[];
  readonly variants: readonly Readonly<TerrainVariantDefinition>[];
}

/** Directional visual treatment between two materials. */
export interface TerrainTransitionRule {
  readonly foregroundMaterialId: TerrainMaterialId;
  readonly backgroundMaterialId: TerrainMaterialId;
  readonly mode: 'hard' | 'contour' | 'soft' | 'decorated';
  readonly width: number;
  readonly colorRef?: keyof TerrainArtPalette;
  readonly decorationLayerId?: TerrainArtLayerId;
}

/** Sparse per-level exception anchored to an expected reusable source tile. */
export interface TerrainOccurrenceOverride {
  readonly levelId: string;
  readonly dualX: number;
  readonly dualY: number;
  readonly materialId: TerrainMaterialId;
  readonly expectedMask: TerrainArtDualGridMask;
  readonly expectedVariantId: TerrainVariantId;
  readonly pinnedVariantId?: TerrainVariantId;
  readonly hidden?: boolean;
  readonly layerPatches: readonly TerrainOccurrenceLayerPatch[];
}

/** One layer contribution in an occurrence override. */
export interface TerrainOccurrenceLayerPatch {
  readonly layerId: TerrainArtLayerId;
  readonly runs: readonly TerrainPixelRun[];
}

export type TerrainArtOccurrenceStatus = 'active' | 'stale' | 'orphaned' | 'hidden';

/** Versioned, project-scoped editable terrain-art source document. */
export interface TerrainArtProject {
  readonly version: number;
  readonly id: string;
  readonly name: string;
  readonly authoringResolution: number;
  readonly visualSeed: number;
  readonly terrainKinds: readonly Readonly<TerrainKindDefinition>[];
  readonly materials: readonly Readonly<TerrainMaterialDefinition>[];
  readonly transitionRules: readonly Readonly<TerrainTransitionRule>[];
  readonly occurrenceOverrides: readonly Readonly<TerrainOccurrenceOverride>[];
}

/** One material pass resolved at a dual-grid coordinate. */
export interface ResolvedTerrainArtMaterial {
  readonly materialId: TerrainMaterialId;
  readonly mask: TerrainArtDualGridMask;
  readonly priority: number;
}

/** Derived visual topology at one logical-grid vertex. */
export interface ResolvedTerrainArtDualTile {
  readonly dualX: number;
  readonly dualY: number;
  readonly occupancyMask: TerrainArtDualGridMask;
  readonly materials: readonly Readonly<ResolvedTerrainArtMaterial>[];
}

/** Prepared dual-grid topology for a complete logical tile grid. */
export interface PreparedTerrainArtDualGrid {
  readonly cols: number;
  readonly rows: number;
  readonly tileSize: number;
  readonly tiles: readonly Readonly<ResolvedTerrainArtDualTile>[];
}

/** Logical or visual integer coordinate used by dirty-region helpers. */
export interface TerrainArtGridCell {
  readonly col: number;
  readonly row: number;
}

/** Named logical corner contributing to one inspected visual tile. */
export interface TerrainArtLogicalCornerHit {
  readonly corner: 'north-west' | 'north-east' | 'south-east' | 'south-west';
  readonly col: number;
  readonly row: number;
}

/** Result of mapping one world pixel back to its derived dual-grid source. */
export interface TerrainArtVisualHit {
  readonly dualX: number;
  readonly dualY: number;
  readonly localPixelX: number;
  readonly localPixelY: number;
  readonly logicalCorners: readonly Readonly<TerrainArtLogicalCornerHit>[];
  readonly tile: Readonly<ResolvedTerrainArtDualTile>;
}

/** Structured terrain-art source validation diagnostic. */
export interface TerrainArtDiagnostic {
  readonly code: string;
  readonly path: string;
  readonly message: string;
  readonly severity: 'error' | 'warning' | 'info';
}

/** Never-throw validation result for one terrain-art source value. */
export interface TerrainArtValidationResult {
  readonly valid: boolean;
  readonly diagnostics: readonly Readonly<TerrainArtDiagnostic>[];
}
