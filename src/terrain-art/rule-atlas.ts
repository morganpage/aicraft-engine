/**
 * Whole-tile rule atlas builder.
 *
 * Packs one complete source tile per rule into a contact sheet. Each tile is
 * copied byte-for-byte (1:1) — never sliced into quadrants and never clipped to
 * a coverage silhouette. This is what makes conventional whole-unit tilesets
 * (Kenney, etc.) render correctly: the authored art survives intact.
 *
 * The atlas is indexed by rule index (the position in the rule set), so the
 * renderer can look up the right whole tile for each matched cell.
 *
 * @module
 */

import type { TerrainTilesetSource } from './import-tileset';

/** One whole tile's position within a `TerrainArtRuleAtlas`. */
export interface TerrainArtRuleAtlasEntry {
  /** Rule index this tile was packed for. */
  readonly ruleIndex: number;
  /** Top-left of the tile within the atlas (pixels). */
  readonly x: number;
  readonly y: number;
  /** Whether this entry was packed from a horizontally-mirrored source read. */
  readonly mirroredX: boolean;
}

/**
 * A contact sheet of whole tiles, one per rule. Dimensions are plain `number`
 * (not the literal `4` of the 16-mask atlas) because the tile count is
 * data-driven by the rule set.
 */
export interface TerrainArtRuleAtlas {
  readonly pixels: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  readonly tileSize: number;
  /** One entry per rule, in rule-set order. */
  readonly entries: readonly TerrainArtRuleAtlasEntry[];
}

function tileOrigin(
  source: Readonly<TerrainTilesetSource>,
  ref: { readonly col: number; readonly row: number },
): { x: number; y: number } {
  const margin = Number.isInteger(source.margin) ? source.margin! : 0;
  const spacing = Number.isInteger(source.spacing) ? source.spacing! : 0;
  return {
    x: margin + ref.col * (source.tileSize + spacing),
    y: margin + ref.row * (source.tileSize + spacing),
  };
}

function usableSource(source: Readonly<TerrainTilesetSource>): boolean {
  return (
    source !== null && typeof source === 'object' &&
    Number.isInteger(source.tileSize) && source.tileSize > 0 &&
    Number.isInteger(source.width) && source.width > 0 &&
    Number.isInteger(source.height) && source.height > 0 &&
    source.pixels instanceof Uint8ClampedArray &&
    source.pixels.length === source.width * source.height * 4
  );
}

/**
 * Build a whole-tile atlas by copying the source tile named by each rule.
 *
 * Rules whose tile ref falls outside the sheet are packed as fully transparent
 * tiles (the renderer still finds them at their index) rather than skewing the
 * layout. The `mirroredX` flag on each entry records whether the source read was
 * flipped horizontally — left for the resolver to set when it picks a mirror;
 * here it is always `false` because the base copy is unmirrored.
 *
 * The atlas lays tiles out left-to-right, wrapping into rows of a fixed column
 * count so the sheet stays reasonably wide for GPU upload.
 */
export function buildTerrainArtRuleAtlas(
  source: Readonly<TerrainTilesetSource>,
  rules: ReadonlyArray<{
    readonly tile: { readonly col: number; readonly row: number };
    readonly fillBottom?: number;
    readonly fillTile?: { readonly col: number; readonly row: number };
  }>,
  columns = 8,
): TerrainArtRuleAtlas {
  const safeColumns = Number.isInteger(columns) && columns > 0 ? columns : 8;
  if (!usableSource(source)) {
    return Object.freeze({ pixels: new Uint8ClampedArray(0), width: 0, height: 0, tileSize: 0, entries: Object.freeze([]) });
  }
  const tileSize = source.tileSize;
  const count = rules.length;
  if (count === 0) {
    return Object.freeze({ pixels: new Uint8ClampedArray(0), width: 0, height: 0, tileSize, entries: Object.freeze([]) });
  }
  const cols = Math.min(safeColumns, count);
  const rows = Math.ceil(count / cols);
  const width = cols * tileSize;
  const height = rows * tileSize;
  const pixels = new Uint8ClampedArray(width * height * 4);
  const entries: TerrainArtRuleAtlasEntry[] = [];

  for (let ruleIndex = 0; ruleIndex < count; ruleIndex++) {
    const rule = rules[ruleIndex]!;
    const ref = rule.tile;
    const targetX = (ruleIndex % cols) * tileSize;
    const targetY = Math.floor(ruleIndex / cols) * tileSize;
    entries.push(Object.freeze({ ruleIndex, x: targetX, y: targetY, mirroredX: false }));

    const origin = tileOrigin(source, ref);
    const fits = origin.x + tileSize <= source.width && origin.y + tileSize <= source.height;
    if (!fits) continue; // leave transparent
    // Copy the whole tile first.
    for (let y = 0; y < tileSize; y++) {
      const from = ((origin.y + y) * source.width + origin.x) * 4;
      const to = ((targetY + y) * width + targetX) * 4;
      pixels.set(source.pixels.subarray(from, from + tileSize * 4), to);
    }
    // Composite seam fix: replace this tile's bottom `fillBottom` rows with the
    // matching rows of the fill body tile. This removes a surface tile's bottom
    // outline (which only belongs on a 1-tile-thick platform) when the tile is
    // used where solid sits below, so grass-on-dirt has no seam.
    const fillRows = Number.isInteger(rule.fillBottom) && rule.fillBottom! > 0 ? rule.fillBottom! : 0;
    if (fillRows > 0 && rule.fillTile !== undefined) {
      const fillOrigin = tileOrigin(source, rule.fillTile);
      const fillFits = fillOrigin.x + tileSize <= source.width && fillOrigin.y + tileSize <= source.height;
      if (fillFits) {
        for (let y = tileSize - fillRows; y < tileSize; y++) {
          const from = ((fillOrigin.y + y) * source.width + fillOrigin.x) * 4;
          const to = ((targetY + y) * width + targetX) * 4;
          pixels.set(source.pixels.subarray(from, from + tileSize * 4), to);
        }
      }
    }
  }

  return Object.freeze({
    pixels,
    width,
    height,
    tileSize,
    entries: Object.freeze(entries),
  });
}
