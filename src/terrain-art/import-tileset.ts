import type {
  TerrainArtPixelAtlas,
  TerrainArtRuleSet,
  TerrainArtTilesetBinding,
  TerrainMaterialDefinition,
  TerrainTilesetRoleMap,
  TerrainTilesetTileRef,
} from './types';
import type { TerrainArtImportedAssetResolver } from './compositor';
import { createTerrainArtMaterial } from './factory';

export type { TerrainTilesetRoleMap, TerrainTilesetTileRef, TerrainArtTilesetBinding };

/**
 * Quarter-tile assembly of an existing edge-based tileset into the dual-grid
 * corner atlas this engine renders from.
 *
 * The engine draws a 4×4 atlas indexed by a clockwise corner mask
 * (north-west `1`, north-east `2`, south-east `4`, south-west `8`), with each
 * dual tile offset half a cell from the logical grid. Almost every published
 * tileset is authored the other way round — as edges around a cell — so the two
 * cannot be mapped tile-for-tile.
 *
 * They map cleanly at *quarter*-tile granularity. Split each output tile into
 * four quadrants, one per corner bit. A quadrant is solid exactly when its bit
 * is set, and its only visible boundaries are the two it shares with the other
 * quadrants of the same tile: the outer two edges continue into the neighbouring
 * dual tile, which covers the same logical cell. So a quadrant's appearance
 * depends on just three bits — itself, its horizontal neighbour, its vertical
 * neighbour:
 *
 * | self | h | v | quadrant        |
 * |------|---|---|-----------------|
 * | 0    | – | – | empty           |
 * | 1    | 0 | 0 | outer corner    |
 * | 1    | 0 | 1 | edge, h side    |
 * | 1    | 1 | 0 | edge, v side    |
 * | 1    | 1 | 1 | fill            |
 *
 * Notably there is no inner-corner case. A concave corner is where two exposed
 * faces meet at 270°, and in a dual tile that meeting point always falls on the
 * shared vertex at the tile centre — so it emerges on its own from two edge
 * quadrants abutting. Inner-corner artwork is a requirement of the 47-tile blob
 * scheme, not of this one. Nine source roles suffice: a fill, four edges and
 * four outer corners, which is exactly a standard 3×3 minimal wall block.
 */

/** RGBA source image plus the grid describing how its tiles are laid out. */
export interface TerrainTilesetSource {
  /** Row-major RGBA bytes, four per pixel. */
  readonly pixels: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  /** Edge length of one source tile in pixels. */
  readonly tileSize: number;
  /** Pixels of padding before the first tile. Defaults to zero. */
  readonly margin?: number;
  /** Pixels between adjacent tiles. Defaults to zero. */
  readonly spacing?: number;
}

export interface ImportTerrainArtTilesetOptions {
  readonly materialId: string;
  readonly variantId?: string;
}

const ROLE_KEYS = Object.freeze([
  'fill', 'top', 'right', 'bottom', 'left',
  'topLeft', 'topRight', 'bottomRight', 'bottomLeft',
] as const);

type RoleKey = (typeof ROLE_KEYS)[number];

/** One output quadrant: its own bit, its in-tile neighbours, and its corner. */
interface QuadrantSpec {
  readonly bit: number;
  /** Neighbour across the vertical midline, and the face exposed when it is empty. */
  readonly horizontal: { readonly bit: number; readonly side: 'left' | 'right' };
  /** Neighbour across the horizontal midline, and the face exposed when it is empty. */
  readonly vertical: { readonly bit: number; readonly side: 'top' | 'bottom' };
  readonly column: 'left' | 'right';
  readonly row: 'top' | 'bottom';
}

/**
 * Convex-corner role for a quadrant exposed on both axes, keyed by the faces it
 * exposes rather than by where it sits.
 *
 * These two differ, which is the easiest thing to get wrong here. A dual tile is
 * offset half a cell, so its south-east quadrant draws the *top-left* quarter of
 * logical cell `(dx, dy)` — the quadrant sits bottom-right within its tile while
 * showing the cell's top-left corner. Deriving the role from the exposed sides
 * keeps that inversion in one place instead of inviting a hand-written table to
 * drift back to the intuitive-but-wrong mapping.
 */
const CORNER_ROLE = Object.freeze({
  top: Object.freeze({ left: 'topLeft', right: 'topRight' }),
  bottom: Object.freeze({ left: 'bottomLeft', right: 'bottomRight' }),
}) as Readonly<Record<'top' | 'bottom', Readonly<Record<'left' | 'right', RoleKey>>>>;

/** Clockwise from north-west, matching the engine's mask bit order. */
const QUADRANTS: readonly QuadrantSpec[] = Object.freeze([
  {
    bit: 1,
    horizontal: { bit: 2, side: 'right' },
    vertical: { bit: 8, side: 'bottom' },
    column: 'left', row: 'top',
  },
  {
    bit: 2,
    horizontal: { bit: 1, side: 'left' },
    vertical: { bit: 4, side: 'bottom' },
    column: 'right', row: 'top',
  },
  {
    bit: 4,
    horizontal: { bit: 8, side: 'left' },
    vertical: { bit: 2, side: 'top' },
    column: 'right', row: 'bottom',
  },
  {
    bit: 8,
    horizontal: { bit: 4, side: 'right' },
    vertical: { bit: 1, side: 'top' },
    column: 'left', row: 'bottom',
  },
]);

/**
 * Pick the source quadrant for one output quadrant.
 *
 * An exposed axis pins that axis to the exposed side, because that is where the
 * artwork's boundary lives. An unexposed axis follows the output quadrant's own
 * side instead, which keeps the texture's phase — the left half of a tile stays
 * on the left — so repeating detail does not visibly duplicate.
 */
function selectSourceQuadrant(
  quadrant: Readonly<QuadrantSpec>,
  mask: number,
): { readonly role: RoleKey; readonly column: 'left' | 'right'; readonly row: 'top' | 'bottom' } | null {
  if ((mask & quadrant.bit) === 0) return null;
  const horizontalOpen = (mask & quadrant.horizontal.bit) === 0;
  const verticalOpen = (mask & quadrant.vertical.bit) === 0;
  if (horizontalOpen && verticalOpen) {
    return {
      role: CORNER_ROLE[quadrant.vertical.side][quadrant.horizontal.side],
      column: quadrant.horizontal.side,
      row: quadrant.vertical.side,
    };
  }
  if (horizontalOpen) {
    return {
      role: quadrant.horizontal.side,
      column: quadrant.horizontal.side,
      row: quadrant.row,
    };
  }
  if (verticalOpen) {
    return {
      role: quadrant.vertical.side,
      column: quadrant.column,
      row: quadrant.vertical.side,
    };
  }
  return { role: 'fill', column: quadrant.column, row: quadrant.row };
}

function emptyAtlas(materialId: string, variantId: string): TerrainArtPixelAtlas {
  return Object.freeze({
    materialId,
    variantId,
    width: 0,
    height: 0,
    tileSize: 0,
    columns: 4 as const,
    rows: 4 as const,
    pixels: new Uint8ClampedArray(0),
    maskToIndex: Object.freeze(Array.from({ length: 16 }, (_, mask) => mask)),
  });
}

function tileOrigin(source: Readonly<TerrainTilesetSource>, ref: Readonly<TerrainTilesetTileRef>): { x: number; y: number } {
  const margin = Number.isInteger(source.margin) ? source.margin! : 0;
  const spacing = Number.isInteger(source.spacing) ? source.spacing! : 0;
  return {
    x: margin + ref.col * (source.tileSize + spacing),
    y: margin + ref.row * (source.tileSize + spacing),
  };
}

function validRef(source: Readonly<TerrainTilesetSource>, ref: unknown): ref is TerrainTilesetTileRef {
  if (ref === null || typeof ref !== 'object') return false;
  const candidate = ref as TerrainTilesetTileRef;
  if (!Number.isInteger(candidate.col) || !Number.isInteger(candidate.row)) return false;
  if (candidate.col < 0 || candidate.row < 0) return false;
  const origin = tileOrigin(source, candidate);
  return origin.x + source.tileSize <= source.width && origin.y + source.tileSize <= source.height;
}

/**
 * Assemble a dual-grid corner atlas from an edge-based tileset.
 *
 * @deprecated This quarter-tile import path slices whole-tile tilesets into
 * corner fragments and clips them to the dual-grid coverage silhouette, which
 * destroys authored art and produced the import artifacts the engine moved
 * away from. For real auto-tiled tilesets, use the **LDtk pipeline**
 * (`src/ldtk/`) — author in LDtk, parse its pre-resolved `.ldtk` output.
 * For in-engine whole-tile auto-tiling, use {@link createRuleTerrainArtMaterial}.
 * Retained for backward compatibility only; no new features will land here.
 *
 * The atlas keeps the source's native `tileSize`; nothing is resampled. The
 * renderer scales atlas tiles to the world tile size when it draws, and a
 * material can pin the same value through `TerrainMaterialDefinition.resolution`
 * so the authoring side agrees.
 *
 * Returns a zero-sized atlas when the source or role map is unusable, matching
 * how the procedural atlas generator reports an unrenderable material.
 */
export function importTerrainArtTilesetAtlas(
  source: Readonly<TerrainTilesetSource>,
  roles: Readonly<TerrainTilesetRoleMap>,
  options: Readonly<ImportTerrainArtTilesetOptions>,
): TerrainArtPixelAtlas {
  const variantId = options.variantId ?? 'default';
  if (
    source === null || typeof source !== 'object' ||
    roles === null || typeof roles !== 'object' ||
    !Number.isInteger(source.tileSize) || source.tileSize <= 0 ||
    !Number.isInteger(source.width) || source.width <= 0 ||
    !Number.isInteger(source.height) || source.height <= 0 ||
    !(source.pixels instanceof Uint8ClampedArray) ||
    source.pixels.length !== source.width * source.height * 4 ||
    !ROLE_KEYS.every((key) => validRef(source, roles[key]))
  ) return emptyAtlas(options.materialId, variantId);

  const tileSize = source.tileSize;
  // Split odd sizes consistently for source and destination so the two halves
  // always reassemble to exactly `tileSize`.
  const leftWidth = Math.ceil(tileSize / 2);
  const topHeight = Math.ceil(tileSize / 2);
  const width = tileSize * 4;
  const height = tileSize * 4;
  const pixels = new Uint8ClampedArray(width * height * 4);

  for (let mask = 0; mask < 16; mask++) {
    const atlasX = (mask % 4) * tileSize;
    const atlasY = Math.floor(mask / 4) * tileSize;
    for (const quadrant of QUADRANTS) {
      const selection = selectSourceQuadrant(quadrant, mask);
      if (selection === null) continue;
      const origin = tileOrigin(source, roles[selection.role]);
      // The output quadrant sits at its own corner, which may differ from the
      // corner the pixels were taken from. Its size is authoritative: at an odd
      // tile size the two halves differ by a pixel, so sizing from the source
      // would leave a seam or overrun the tile. The source read is anchored to
      // the edge it was selected for, keeping boundary artwork flush.
      const targetWidth = quadrant.column === 'left' ? leftWidth : tileSize - leftWidth;
      const targetHeight = quadrant.row === 'top' ? topHeight : tileSize - topHeight;
      const sourceX = origin.x + (selection.column === 'left' ? 0 : tileSize - targetWidth);
      const sourceY = origin.y + (selection.row === 'top' ? 0 : tileSize - targetHeight);
      const targetX = atlasX + (quadrant.column === 'left' ? 0 : leftWidth);
      const targetY = atlasY + (quadrant.row === 'top' ? 0 : topHeight);
      const copyWidth = targetWidth;
      const copyHeight = targetHeight;
      for (let y = 0; y < copyHeight; y++) {
        const from = ((sourceY + y) * source.width + sourceX) * 4;
        const to = ((targetY + y) * width + targetX) * 4;
        pixels.set(source.pixels.subarray(from, from + copyWidth * 4), to);
      }
    }
  }

  return Object.freeze({
    materialId: options.materialId,
    variantId,
    width,
    height,
    tileSize,
    columns: 4 as const,
    rows: 4 as const,
    pixels,
    maskToIndex: Object.freeze(Array.from({ length: 16 }, (_, mask) => mask)),
  });
}

/**
 * Build the *project data* for a material backed by an imported tileset: the
 * pinned native resolution, one imported layer naming the asset, and the manual
 * layer so an author can still retouch on top. The procedural layers are
 * dropped, since they would composite underneath imported pixels and only muddy
 * them.
 *
 * @deprecated Backs the deprecated quarter-tile `'imported'` layer. Prefer the
 * LDtk pipeline (`src/ldtk/`) or {@link createRuleTerrainArtMaterial}.
 *
 * Pass `binding` to make the material render through the normal path: the
 * compositor forwards the slicing to a `TerrainArtImportedAssetResolver`, and
 * `createTerrainArtTilesetResolver` turns it into pixels. Without a binding —
 * or without a resolver at render time — the material composites to a correctly
 * sized but fully transparent atlas, since there is nothing to draw.
 *
 * `resolution` must equal the binding's `tileSize`; the resolver refuses a
 * mismatch rather than rescaling behind your back.
 */
export function createImportedTerrainArtMaterial(
  id: string,
  name: string,
  resolution: number,
  assetId: string,
  binding?: Readonly<TerrainArtTilesetBinding>,
): TerrainMaterialDefinition {
  const base = createTerrainArtMaterial(id, name);
  return Object.freeze({
    ...base,
    resolution,
    layers: Object.freeze([
      Object.freeze({
        id: 'imported',
        name: 'Imported Tileset',
        type: 'imported' as const,
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'normal' as const,
        clipMode: 'none' as const,
        assetId,
        ...(binding === undefined ? {} : { tileset: binding }),
      }),
      ...base.layers.filter((layer) => layer.type === 'manual'),
    ]),
  });
}

/**
 * Build a material backed by an LDtk-style whole-tile rule set.
 *
 * Like `createImportedTerrainArtMaterial` this pins the native `resolution` and
 * names an `assetId`, but the single art layer is a `'rule'` layer carrying the
 * auto-tiling rules. At render time the rule engine paints one whole source
 * tile per matched cell (no quarter-slicing), which is what conventional
 * whole-unit tilesets are authored for.
 */
export function createRuleTerrainArtMaterial(
  id: string,
  name: string,
  resolution: number,
  assetId: string,
  binding: Readonly<TerrainArtTilesetBinding>,
  rules: Readonly<TerrainArtRuleSet>,
): TerrainMaterialDefinition {
  const base = createTerrainArtMaterial(id, name);
  return Object.freeze({
    ...base,
    resolution,
    layers: Object.freeze([
      Object.freeze({
        id: 'rules',
        name: 'Auto-Tile Rules',
        type: 'rule' as const,
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'normal' as const,
        clipMode: 'none' as const,
        assetId,
        tileset: binding,
        rules,
      }),
      ...base.layers.filter((layer) => layer.type === 'manual'),
    ]),
  });
}

/** The nine roles an importer needs, for callers building their own role maps. */
export const TERRAIN_TILESET_ROLE_KEYS = ROLE_KEYS;

/** Raw pixels for one tileset image, keyed in a resolver by its `assetId`. */
export interface TerrainArtTilesetImage {
  readonly pixels: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

/**
 * Bridge imported tilesets into the normal render path.
 *
 * The project stores the slicing and names an `assetId`; this supplies the
 * pixels behind that name. Hand the result to `generateTerrainArtMaterialAtlas`,
 * `compileTerrainArtRuntime`, or any other entry point that takes a resolver,
 * and `imported` layers composite like every other layer type.
 *
 * Assembled atlases are memoized per asset and slicing, so re-rendering all
 * sixteen masks — which the atlas generator does on every call — assembles each
 * tileset once rather than sixteen times. Pass a mutable record and later edits
 * are picked up, because lookup happens per request.
 */
export function createTerrainArtTilesetResolver(
  images: Readonly<Record<string, Readonly<TerrainArtTilesetImage>>>,
): TerrainArtImportedAssetResolver {
  const cache = new Map<string, TerrainArtPixelAtlas>();
  return (request) => {
    const image = images[request.assetId];
    const binding = request.tileset;
    if (image === undefined || binding === undefined) return null;
    const key = `${request.assetId}:${image.width}x${image.height}:${JSON.stringify(binding)}`;
    let atlas = cache.get(key);
    if (atlas === undefined) {
      atlas = importTerrainArtTilesetAtlas(
        {
          pixels: image.pixels,
          width: image.width,
          height: image.height,
          tileSize: binding.tileSize,
          ...(binding.margin === undefined ? {} : { margin: binding.margin }),
          ...(binding.spacing === undefined ? {} : { spacing: binding.spacing }),
        },
        binding.roles,
        { materialId: request.materialId, variantId: request.variantId },
      );
      cache.set(key, atlas);
    }
    // The compositor sizes its buffer from the material's resolution. A
    // mismatch means the material is not pinned to this tileset's tile size, and
    // silently rescaling would hide that; refuse instead.
    if (atlas.tileSize !== request.width || atlas.tileSize !== request.height) return null;
    const size = atlas.tileSize;
    const originX = (request.mask % 4) * size;
    const originY = Math.floor(request.mask / 4) * size;
    const tile = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) {
      const from = ((originY + y) * atlas.width + originX) * 4;
      tile.set(atlas.pixels.subarray(from, from + size * 4), y * size * 4);
    }
    return tile;
  };
}

/**
 * Build the serializable slicing for an imported layer. Pair it with
 * `createImportedTerrainArtMaterial`, whose `resolution` must match `tileSize`
 * or the resolver will decline to serve the material.
 */
export function createTerrainArtTilesetBinding(
  tileSize: number,
  roles: Readonly<TerrainTilesetRoleMap>,
  margin = 0,
  spacing = 0,
): TerrainArtTilesetBinding {
  return Object.freeze({
    tileSize,
    ...(margin === 0 ? {} : { margin }),
    ...(spacing === 0 ? {} : { spacing }),
    roles: Object.freeze({ ...roles }),
  });
}

/**
 * Role map for Kenney's Pixel Platformer terrain block (CC0), addressing
 * `Tilemap/tilemap_packed.png` at 18px tiles with no margin or spacing.
 *
 * The pack lays terrain out as four columns — capped both sides, capped left,
 * uncapped, capped right — rather than as a 3×3 square, so the surface row
 * supplies the top edge and both top corners while rows 6 and 7 supply the body
 * and the bottom. Pass the row of the surface you want: 0 grass, 2 sand,
 * 4 snow. Each has a second variant one row below.
 */
export function kenneyPixelPlatformerRoles(surfaceRow: 0 | 1 | 2 | 3 | 4 | 5 = 0): TerrainTilesetRoleMap {
  return Object.freeze({
    topLeft: Object.freeze({ col: 1, row: surfaceRow }),
    top: Object.freeze({ col: 2, row: surfaceRow }),
    topRight: Object.freeze({ col: 3, row: surfaceRow }),
    left: Object.freeze({ col: 1, row: 6 }),
    fill: Object.freeze({ col: 2, row: 6 }),
    right: Object.freeze({ col: 3, row: 6 }),
    bottomLeft: Object.freeze({ col: 1, row: 7 }),
    bottom: Object.freeze({ col: 2, row: 7 }),
    bottomRight: Object.freeze({ col: 3, row: 7 }),
  });
}

/**
 * Whole-tile auto-tiling rules for the Kenney Pixel Platformer block (CC0),
 * derived from the same role map as `kenneyPixelPlatformerRoles`.
 *
 * Each rule is a 3×3 neighbourhood pattern that picks one whole source tile —
 * no quarter-slicing. Order matters (first match wins): convex outer corners
 * come first (most specific), then edges, then the interior fill last. Cardinal
 * edges use `flipX`/`flipY` so a single rule covers both left/right (and
 * top/bottom) halves, halving the rule count.
 *
 * Slot order `[NW, N, NE, W, C, E, SW, S, SE]`; `0` = must be empty, `1` = solid,
 * `-1` = wildcard. The centre is always `1` — only solid cells get a tile.
 */
export function kenneyPixelPlatformerRules(surfaceRow: 0 | 1 | 2 | 3 | 4 | 5 = 0): TerrainArtRuleSet {
  const roles = kenneyPixelPlatformerRoles(surfaceRow);
  // Helper: build a pattern from explicit corner/cardinal requirements.
  // corners and edges default to wildcard (-1); pass 0/1 to pin a slot.
  const p = (
    pins: Partial<{
      nw: number; n: number; ne: number; w: number; e: number; sw: number; s: number; se: number;
    }>,
  ): readonly number[] => [
    pins.nw ?? -1, pins.n ?? -1, pins.ne ?? -1,
    pins.w ?? -1, 1, pins.e ?? -1,
    pins.sw ?? -1, pins.s ?? -1, pins.se ?? -1,
  ];
  // The Kenney pack draws each surface tile as a complete bordered unit: the
  // grass tiles carry a 2px outline on their bottom edge meant for 1-tile-thick
  // platforms. When grass sits over a solid interior, that bottom outline would
  // form a grey seam against the borderless dirt — so the surface-over-interior
  // rules composite the tile, replacing its bottom 2 outline rows with the fill
  // body tile's rows. Surface-over-air rules keep the raw tile (its bottom
  // outline becomes the platform's bottom edge, as intended).
  const SEAM_ROWS = 2;
  return Object.freeze({
    rules: Object.freeze([
      // Top corners over interior (S solid) — composite the bottom outline away.
      { pattern: p({ n: 0, w: 0, s: 1 }), tile: roles.topLeft, fillBottom: SEAM_ROWS, fillTile: roles.fill },
      { pattern: p({ n: 0, e: 0, s: 1 }), tile: roles.topRight, fillBottom: SEAM_ROWS, fillTile: roles.fill },
      // Top corners over air (S empty) — thin platform, keep the outline as the edge.
      { pattern: p({ n: 0, w: 0 }), tile: roles.topLeft },
      { pattern: p({ n: 0, e: 0 }), tile: roles.topRight },
      // Top edge over interior (S solid) — composite.
      { pattern: p({ n: 0, s: 1 }), tile: roles.top, flipX: true, fillBottom: SEAM_ROWS, fillTile: roles.fill },
      // Top edge over air (S empty) — thin platform.
      { pattern: p({ n: 0 }), tile: roles.top, flipX: true },
      // Bottom corners — exposed bottom, keep the outline (platform's bottom edge).
      { pattern: p({ s: 0, w: 0 }), tile: roles.bottomLeft },
      { pattern: p({ s: 0, e: 0 }), tile: roles.bottomRight },
      // Side edges. flipX/flipY cover the mirrored half.
      { pattern: p({ w: 0 }), tile: roles.left, flipY: true },
      { pattern: p({ e: 0 }), tile: roles.right, flipY: true },
      // Bottom edge — exposed bottom.
      { pattern: p({ s: 0 }), tile: roles.bottom, flipX: true },
      // Interior fill — fully surrounded.
      { pattern: p({}), tile: roles.fill },
    ] as const),
  });
}
