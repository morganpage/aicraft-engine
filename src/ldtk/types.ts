/**
 * LDtk JSON schema types — a typed subset of the LDtk level format.
 *
 * Mirrors the runtime-relevant fields of the published LDtk JSON schema
 * (https://ldtk.io/json/). Fields marked `*Only used by editor*` in the
 * upstream schema are intentionally omitted: a renderer/consumer never
 * needs them. Every type here is a plain readonly shape so it survives a
 * JSON round-trip identically.
 *
 * Determinism note: all fields are primitives, plain arrays, or readonly
 * objects. No `Date`, no closures, no `Set`/`Map`. The parser
 * (`parse.ts`) produces these shapes from a raw `JSON.parse` result.
 *
 * @module
 */

/**
 * LDtk layer type discriminator. Matches the upstream `__type` field.
 *
 * - `IntGrid` — flat integer grid (collision/logic). Source of truth for
 *   the engine's {@link TileGrid}.
 * - `Tiles` — hand-placed tile references into a tileset.
 * - `AutoLayer` — rules-based auto-tiling, **already resolved by LDtk at
 *   save time** into `autoLayerTiles`. Rendered exactly like `Tiles`.
 * - `Entities` — placed entity instances.
 *
 * See https://ldtk.io/docs/game-dev/json-overview/ §2.1.
 */
export type LdtkLayerType = 'IntGrid' | 'Tiles' | 'AutoLayer' | 'Entities';

/**
 * LDtk world layout mode. `null` when no world layout is set.
 * See https://ldtk.io/docs/general/world/.
 */
export type LdtkWorldLayout =
  | 'Free'
  | 'GridVania'
  | 'LinearHorizontal'
  | 'LinearVertical'
  | null;

/** A rendered tile — the atom of all `Tiles`/`AutoLayer` drawing. */
export interface LdtkTile {
  /** Pixel coords in the layer: `[x, y]`. Add layer + world offsets. */
  readonly px: readonly [number, number];
  /** Pixel coords in the tileset image: `[x, y]` (top-left of the tile). */
  readonly src: readonly [number, number];
  /** Tile ID in the tileset (informational; `src` is authoritative). */
  readonly t: number;
  /**
   * Flip bits. `bit0` (value 1) = flip X, `bit1` (value 2) = flip Y,
   * `3` = both. `0` = none. Default `0` when absent.
   */
  readonly f?: number;
  /** Per-tile alpha multiplier in `[0,1]`. Default `1` when absent. */
  readonly a?: number;
  /**
   * Provenance: `[ruleUid, coordId]`, where `coordId = cx + cy * layerWidth`.
   *
   * LDtk records which rule placed each tile and at which cell. It is not
   * needed to draw, but preserving it keeps a re-resolved layer identical to
   * one LDtk saved, and it makes "why is this tile here?" answerable.
   */
  readonly d?: readonly number[];
}

/**
 * Tileset definition (runtime subset). Lives under `defs.tilesets[]`.
 *
 * The `relPath` is relative to the `.ldtk` project file. The engine
 * resolves it through a consumer-supplied loader (`parse.ts`).
 */
export interface LdtkTilesetDef {
  /** Human identifier (e.g. `'SunnyLand_by_Ansimuz'`). */
  readonly identifier: string;
  /** Stable integer uid used by layers/tiles to reference this tileset. */
  readonly uid: number;
  /** PNG path relative to the project file. `null` if `embedAtlas`. */
  readonly relPath: string | null;
  /** Image width in pixels. */
  readonly pxWid: number;
  /** Image height in pixels. */
  readonly pxHei: number;
  /** Pixel size of one (square) tile. */
  readonly tileGridSize: number;
  /** Outer border padding in pixels. Default 0. */
  readonly padding?: number;
  /** Spacing between tiles in pixels. Default 0. */
  readonly spacing?: number;
  /** Grid columns (`pxWid / tileGridSize`). */
  readonly __cWid: number;
  /** Grid rows (`pxHei / tileGridSize`). */
  readonly __cHei: number;
  /**
   * If `'LdtkIcons'`, this is LDtk's internal editor-only icon atlas and
   * should be skipped at runtime. `null` for normal tilesets.
   */
  readonly embedAtlas?: 'LdtkIcons' | null;
  /**
   * One character per tile, `'1'` when every pixel of that tile is fully
   * opaque. Indexed by tile id.
   *
   * Auto-layer rules need this: a rule painting an opaque tile hides whatever
   * later rules would draw underneath, and LDtk discards those hidden tiles
   * rather than emitting them. Without this flag the engine would over-emit.
   * LDtk caches it in the project file, so the alpha never has to be measured
   * from the PNG.
   */
  readonly opaqueTiles?: string;
}

/** A custom field value on an entity or level. Runtime subset. */
export interface LdtkFieldInstance {
  /** Field identifier (e.g. `'speed'`, `'color'`). */
  readonly __identifier: string;
  /** Field definition uid — the handle biome gating resolves through. */
  readonly defUid?: number;
  /** Field type string (e.g. `'Int'`, `'String'`, `'Enum(Mood)'`). */
  readonly __type: string;
  /** The value (or array of values for multi-value fields). */
  readonly __value: unknown;
}

/**
 * An entity placed in an `Entities` layer. Coordinates are in level
 * pixels; add the layer's `__pxTotalOffsetX/Y` when positioning.
 */
export interface LdtkEntityInstance {
  /** Entity definition identifier (e.g. `'Player'`, `'Coin'`). */
  readonly __identifier: string;
  /** Entity definition uid. */
  readonly defUid: number;
  /** Stable instance id. */
  readonly iid: string;
  /** String tags from the entity definition. */
  readonly __tags: readonly string[];
  /** Pixel position `[x, y]` in the level. */
  readonly px: readonly [number, number];
  /** Pixel width. */
  readonly width: number;
  /** Pixel height. */
  readonly height: number;
  /** Grid coords `[cx, cy]`. */
  readonly __grid: readonly [number, number];
  /** Pivot `[px, py]` in `[0,1]` (0,0 = top-left). */
  readonly __pivot: readonly [number, number];
  /** Optional display tile (a rect in a tileset). */
  readonly __tile?: {
    readonly tilesetUid: number;
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
  } | null;
  /** Custom field values. */
  readonly fieldInstances: readonly LdtkFieldInstance[];
}

/**
 * A single layer instance within a level. The `__type` discriminator
 * selects which content fields are populated.
 */
export interface LdtkLayerInstance {
  /** Layer type. Determines which content fields are present. */
  readonly __type: LdtkLayerType;
  /** Human identifier (e.g. `'Solid'`, `'AutoTiles'`, `'Entities'`). */
  readonly __identifier: string;
  /** Grid cell width. */
  readonly __cWid: number;
  /** Grid cell height. */
  readonly __cHei: number;
  /** Pixel size of one grid cell. */
  readonly __gridSize: number;
  /** Layer opacity `[0,1]`. Default 1. */
  readonly __opacity: number;
  /** Pre-summed X pixel offset (def + instance). Use this for drawing. */
  readonly __pxTotalOffsetX: number;
  /** Pre-summed Y pixel offset (def + instance). Use this for drawing. */
  readonly __pxTotalOffsetY: number;
  /** Whether the layer is visible in the editor. Default true. */
  readonly visible: boolean;
  /** Layer instance id. */
  readonly iid: string;
  /** Level this layer belongs to. */
  readonly levelId: string;
  /** Layer definition uid. */
  readonly layerDefUid: number;

  // IntGrid content (present when `__type === 'IntGrid'`).
  /** Flat row-major IntGrid values. `0` = empty. `undefined` for non-IntGrid. */
  readonly intGridCsv?: readonly number[];
  /** Tiles content (present when `__type === 'Tiles'`). */
  readonly gridTiles?: readonly LdtkTile[];
  /** Auto-layer content (present when `__type === 'AutoLayer'`), pre-resolved. */
  readonly autoLayerTiles?: readonly LdtkTile[];
  /** Entities content (present when `__type === 'Entities'`). */
  readonly entityInstances?: readonly LdtkEntityInstance[];

  /** Tileset uid this layer draws from (Tiles/AutoLayer). `null` otherwise. */
  readonly __tilesetDefUid: number | null;
  /** Tileset rel path convenience (mirrors `defs.tilesets[uid].relPath`). */
  readonly __tilesetRelPath: string | null;

  /**
   * Per-instance random seed. Every stochastic auto-rule decision (`chance`,
   * alternative-tile choice, tile jitter) is derived from this, which is why
   * re-running the rules reproduces LDtk's own bake rather than a new roll.
   */
  readonly seed?: number;
  /**
   * Uids of optional rule groups enabled on this instance. A group with
   * `isOptional` runs only when its uid appears here.
   */
  readonly optionalRules?: readonly number[];
  /** Instance tileset override, superseding the layer definition's. */
  readonly overrideTilesetUid?: number | null;
}

/** A reference to a neighbouring level. */
export interface LdtkNeighbour {
  /** Direction: `'n' | 's' | 'e' | 'w' | 'ne' | ...`. */
  readonly dir: string;
  /** Neighbouring level iid. */
  readonly levelIid: string;
}

/** A single level within a project. */
export interface LdtkLevel {
  /** Human identifier (e.g. `'Level_0'`). */
  readonly identifier: string;
  /** Stable instance id. */
  readonly iid: string;
  /** Stable integer uid. */
  readonly uid: number;
  /** Level pixel width. */
  readonly pxWid: number;
  /** Level pixel height. */
  readonly pxHei: number;
  /** World X position (Free/GridVania layouts). */
  readonly worldX: number;
  /** World Y position (Free/GridVania layouts). */
  readonly worldY: number;
  /** World depth index (stacking). */
  readonly worldDepth: number;
  /** Per-level custom fields. */
  readonly fieldInstances: readonly LdtkFieldInstance[];
  /** Layers in display order (bottom → top). `null` when externalLevels. */
  readonly layerInstances: readonly LdtkLayerInstance[] | null;
  /** Adjacent levels. */
  readonly __neighbours: readonly LdtkNeighbour[];
  /** Path to the `.ldtkl` when `externalLevels: true`. */
  readonly externalRelPath?: string | null;
  /** Level background color hex, or `null` to inherit the project's. */
  readonly bgColor?: string | null;
  /** Background image path relative to the project file. `null` when none. */
  readonly bgRelPath?: string | null;
  /** Background image fit mode (`'Cover'`, `'Contain'`, `'CoverDirty'`, …). */
  readonly bgPos?: string | null;
}

/** Definitions block — tilesets, enums, layers, entities. */
export interface LdtkDefinitions {
  /** Tilesets (the only def block a renderer strictly needs). */
  readonly tilesets: readonly LdtkTilesetDef[];
  /** Enum definitions (used for typed entity fields). */
  readonly enums: readonly LdtkEnumDef[];
  /** Layer definitions (IntGrid values, auto-rules, parallax). */
  readonly layers: readonly LdtkLayerDef[];
  /** Entity definitions — the palette an author places instances from. */
  readonly entities: readonly LdtkEntityDef[];
}

/** Enum value. */
export interface LdtkEnumValueDef {
  readonly id: string;
  readonly color: string;
}

/** Enum definition. */
export interface LdtkEnumDef {
  readonly identifier: string;
  readonly uid: number;
  readonly values: readonly LdtkEnumValueDef[];
  /** Tags applied to enum values. */
  readonly tags: readonly string[];
}

/** An IntGrid value definition (color + identifier). */
export interface LdtkIntGridValueDef {
  /** Human identifier (e.g. `'walls'`). */
  readonly identifier: string | null;
  /** Integer value (1-indexed; `0` is empty). */
  readonly value: number;
  /** Display color hex. */
  readonly color: string;
  /**
   * Uid of the {@link LdtkIntGridValueGroupDef} this value belongs to, or `0`
   * when ungrouped. Auto-layer rule patterns can match a whole group — see
   * {@link LDTK_RULE_GROUP_STRIDE}.
   */
  readonly groupUid?: number;
}

/** A named group of IntGrid values, referenced collectively by rule patterns. */
export interface LdtkIntGridValueGroupDef {
  readonly uid: number;
  readonly identifier: string | null;
  readonly color: string | null;
}

/**
 * How an auto-rule paints the tiles it selects.
 *
 * - `Single` — one tile per matching cell.
 * - `Stamp` — a multi-tile block anchored by `pivotX`/`pivotY`; each entry of
 *   `tileRectsIds` is one whole stamp.
 */
export type LdtkTileMode = 'Single' | 'Stamp';

/** Alternating-cell filter applied on top of a pattern match. */
export type LdtkCheckerMode = 'None' | 'Horizontal' | 'Vertical';

/**
 * A single auto-layer rule.
 *
 * The `pattern` is a flat `size × size` row-major window centred on the cell
 * under test. Its values are sentinel-encoded; see
 * {@link LDTK_RULE_ANY_VALUE} and {@link LDTK_RULE_GROUP_STRIDE}.
 */
export interface LdtkAutoRule {
  readonly uid: number;
  /** Disabled rules are skipped entirely. */
  readonly active: boolean;
  /** Pattern edge length. Always odd (observed: 1, 3, 5, 7, 9). */
  readonly size: number;
  /** Flat `size * size` sentinel-encoded pattern, row-major. */
  readonly pattern: readonly number[];
  /**
   * Candidate tile groups. Each entry is one alternative: a single tile id for
   * `Single` mode, or the ordered tiles of one block for `Stamp` mode.
   */
  readonly tileRectsIds: readonly (readonly number[])[];
  readonly tileMode: LdtkTileMode;
  /** Per-tile alpha multiplier in `[0,1]`. */
  readonly alpha: number;
  /** Probability in `[0,1]` that a matching cell actually paints. */
  readonly chance: number;
  /** When true, a match stops later rules from painting this cell. */
  readonly breakOnMatch: boolean;
  /** Also try the pattern mirrored on X, emitting a flipped tile. */
  readonly flipX: boolean;
  /** Also try the pattern mirrored on Y, emitting a flipped tile. */
  readonly flipY: boolean;
  /** Only paint every Nth column (1 = every column). */
  readonly xModulo: number;
  /** Only paint every Nth row (1 = every row). */
  readonly yModulo: number;
  /** Phase offset for `xModulo`. */
  readonly xOffset: number;
  /** Phase offset for `yModulo`. */
  readonly yOffset: number;
  /** Static nudge applied to the painted tile's grid position. */
  readonly tileXOffset: number;
  /** Static nudge applied to the painted tile's grid position. */
  readonly tileYOffset: number;
  /** Inclusive random nudge range on X. */
  readonly tileRandomXMin: number;
  readonly tileRandomXMax: number;
  /** Inclusive random nudge range on Y. */
  readonly tileRandomYMin: number;
  readonly tileRandomYMax: number;
  readonly checker: LdtkCheckerMode;
  /** Stamp anchor within the block, in tiles. */
  readonly pivotX: number;
  readonly pivotY: number;
  /**
   * IntGrid value assumed for cells outside the layer bounds. `null` means
   * an out-of-bounds cell never satisfies the pattern.
   */
  readonly outOfBoundsValue: number | null;
  /** When true, a Perlin field gates matches instead of flat `chance`. */
  readonly perlinActive: boolean;
  readonly perlinSeed: number;
  readonly perlinScale: number;
  readonly perlinOctaves: number;
}

/** An ordered, independently toggleable set of {@link LdtkAutoRule}s. */
export interface LdtkAutoRuleGroup {
  readonly uid: number;
  readonly name: string;
  /** Disabled groups are skipped entirely. */
  readonly active: boolean;
  /**
   * When true the group only runs if its uid appears in the layer instance's
   * `optionalRules`. Lets one ruleset drive several visual presets.
   */
  readonly isOptional: boolean;
  readonly rules: readonly LdtkAutoRule[];
  /** IntGrid values gating this group by biome. Empty = always eligible. */
  readonly requiredBiomeValues: readonly string[];
  /** `0` = any of the required values; `1` = all of them. */
  readonly biomeRequirementMode: number;
}

/** Layer definition (runtime + authoring subset). */
export interface LdtkLayerDef {
  readonly __type: LdtkLayerType;
  readonly identifier: string;
  readonly uid: number;
  readonly gridSize: number;
  /** IntGrid value definitions (IntGrid layers only). */
  readonly intGridValues?: readonly LdtkIntGridValueDef[];
  /** Value groups referenced collectively by rule patterns. */
  readonly intGridValuesGroups?: readonly LdtkIntGridValueGroupDef[];
  /** Default tileset uid (Tiles/AutoLayer). Prefer instance `__tilesetDefUid`. */
  readonly tilesetDefUid?: number | null;
  /** Tileset the auto-rules draw from. Prefer this over `tilesetDefUid`. */
  readonly autoTilesetDefUid?: number | null;
  /**
   * Uid of the layer whose IntGrid feeds this layer's rules. `null` means the
   * layer reads its own. An AutoLayer always sources from another layer.
   */
  readonly autoSourceLayerDefUid?: number | null;
  /** Auto-tiling rules, in evaluation order. */
  readonly autoRuleGroups?: readonly LdtkAutoRuleGroup[];
  /** Horizontal parallax factor in `[-1,1]`. */
  readonly parallaxFactorX?: number;
  /** Vertical parallax factor in `[-1,1]`. */
  readonly parallaxFactorY?: number;
  /** Whether parallax also scales the layer. */
  readonly parallaxScaling?: boolean;
  /** Editor display opacity. */
  readonly displayOpacity?: number;
  /** Definition-level pixel offset (instance offsets are added on top). */
  readonly pxOffsetX?: number;
  readonly pxOffsetY?: number;
  /** Anchor within a tile, in tiles. Shifts stamp blocks laid by auto-rules. */
  readonly tilePivotX?: number;
  readonly tilePivotY?: number;
  /**
   * Uid of the level field holding this layer's biome value(s). Rule groups
   * declaring `requiredBiomeValues` are gated on it, which is how one ruleset
   * paints different terrain per level.
   */
  readonly biomeFieldUid?: number | null;
}

/**
 * Pattern sentinel: matches any non-empty IntGrid value. Negated
 * (`-LDTK_RULE_ANY_VALUE`) it matches only empty cells.
 */
export const LDTK_RULE_ANY_VALUE = 1000001;

/**
 * Pattern group-reference stride. A pattern value `±(groupUid + 1) * 1000`
 * with magnitude below {@link LDTK_RULE_ANY_VALUE} tests membership of the
 * matching {@link LdtkIntGridValueGroupDef}.
 */
export const LDTK_RULE_GROUP_STRIDE = 1000;

/** An entity field definition (authoring metadata for `fieldInstances`). */
export interface LdtkFieldDef {
  readonly identifier: string;
  readonly uid: number;
  /** Raw LDtk type string, e.g. `'F_Int'`, `'F_Enum(Mood)'`. */
  readonly __type: string;
  readonly canBeNull: boolean;
  readonly isArray: boolean;
  readonly defaultOverride: unknown;
}

/** How an entity renders in the editor. */
export type LdtkEntityRenderMode = 'Rectangle' | 'Ellipse' | 'Tile' | 'Cross';

/**
 * How a tile-bearing entity's display tile renders inside the entity bounds
 * (`tileRenderMode` on LDtk entity defs). All seven schema values — see
 * https://ldtk.io/json/.
 */
export type LdtkTileRenderMode =
  | 'Cover'
  | 'FitInside'
  | 'Repeat'
  | 'Stretch'
  | 'FullSizeCropped'
  | 'FullSizeUncropped'
  | 'NineSlice';

/**
 * Entity definition — the palette entry an author places instances of.
 * Needed to offer an entity palette and to size new instances correctly.
 */
export interface LdtkEntityDef {
  readonly identifier: string;
  readonly uid: number;
  readonly tags: readonly string[];
  /** Default instance size in pixels. */
  readonly width: number;
  readonly height: number;
  readonly resizableX: boolean;
  readonly resizableY: boolean;
  /** Display color hex. */
  readonly color: string;
  readonly renderMode: LdtkEntityRenderMode;
  /**
   * How the display tile renders inside resized instances (`Repeat` tiles,
   * `Stretch` scales, `FitInside` letterboxes — see
   * {@link LdtkTileRenderMode}). Parsed from the raw def; defs omitting the
   * key resolve to `'FitInside'`.
   */
  readonly tileRenderMode: LdtkTileRenderMode;
  /** Pivot in `[0,1]` (0,0 = top-left). */
  readonly pivotX: number;
  readonly pivotY: number;
  /** Tileset the display tile comes from. `null` when none. */
  readonly tilesetId: number | null;
  /** Display tile rect. `null` when the entity renders as a shape. */
  readonly tileRect: {
    readonly tilesetUid: number;
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
  } | null;
  readonly fieldDefs: readonly LdtkFieldDef[];
}

/** A world (multi-worlds mode). Empty unless that advanced flag is set. */
export interface LdtkWorld {
  readonly identifier: string;
  readonly iid: string;
  readonly worldLayout: LdtkWorldLayout;
  readonly worldGridWidth: number | null;
  readonly worldGridHeight: number | null;
  readonly levels: readonly LdtkLevel[];
}

/** The full LDtk project — the parsed root of a `.ldtk` file. */
export interface LdtkProject {
  /** Format version string (e.g. `'1.5.3'`). */
  readonly jsonVersion: string;
  /** Project iid. */
  readonly iid: string;
  /** Background color hex. */
  readonly bgColor: string;
  /** Definitions (tilesets, enums, layers). */
  readonly defs: LdtkDefinitions;
  /** Levels (single-world mode). Empty when multi-worlds is active. */
  readonly levels: readonly LdtkLevel[];
  /** If true, each level's layers live in a separate `.ldtkl` file. */
  readonly externalLevels: boolean;
  /** World layout mode. */
  readonly worldLayout: LdtkWorldLayout;
  /** World grid width (GridVania). */
  readonly worldGridWidth: number | null;
  /** World grid height (GridVania). */
  readonly worldGridHeight: number | null;
  /** Worlds (multi-worlds mode). Empty in single-world mode. */
  readonly worlds: readonly LdtkWorld[];
}

/** Result of parsing a `.ldtk` file (mirrors `ValidationResult`). */
export interface LdtkParseResult {
  /** `true` iff parsing succeeded with no error-severity diagnostics. */
  readonly ok: boolean;
  /** The parsed project, or `undefined` on failure. */
  readonly project?: LdtkProject;
  /** Diagnostics (errors and warnings). */
  readonly errors: readonly LdtkParseError[];
}

/** A single parse diagnostic. */
export interface LdtkParseError {
  /** Dotted path or context label. */
  readonly path: string;
  /** Human-readable description. */
  readonly message: string;
  /** `'error'` blocks success; `'warning'` is informational. */
  readonly severity: 'error' | 'warning';
}
