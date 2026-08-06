/**
 * LDtk auto-layer rule engine — turn an IntGrid into tiles.
 *
 * LDtk's desktop editor resolves auto-tiling at save time and ships the result
 * in `autoLayerTiles`. That is enough to *play* a level but not to *draw* one:
 * the moment a cell changes, the baked tiles are stale and nothing recomputes
 * them. This module is that recomputation, and it is what lets the engine's
 * editor paint into an LDtk project and get the same art LDtk would have.
 *
 * Correctness here is not a matter of looking plausible. Every vendored sample
 * carries LDtk's own output for the same inputs, so the engine is held to an
 * exact match — see `src/tests/ldtk-rules-oracle.test.ts`.
 *
 * The grid is supplied through {@link LdtkRuleGridSource} rather than an LDtk
 * document, so a procedurally generated level can be skinned with an authored
 * LDtk ruleset without ever touching a `.ldtk` file.
 *
 * Determinism note: pure functions over plain data. Randomness comes only from
 * `rng.ts`, seeded by cell coordinates. Never throws.
 *
 * @module
 */

import { ldtkPerlin, ldtkRandSeedCoords } from './rng';
import {
  LDTK_RULE_ANY_VALUE,
  LDTK_RULE_GROUP_STRIDE,
  type LdtkAutoRule,
  type LdtkLayerDef,
  type LdtkTile,
} from './types';

/**
 * The IntGrid a ruleset reads.
 *
 * Deliberately an interface rather than a concrete grid: this is the seam that
 * lets `generateLevel()` output, an in-editor working buffer, or a parsed
 * `.ldtk` layer all feed the same engine.
 */
export interface LdtkRuleGridSource {
  readonly cols: number;
  readonly rows: number;
  /** IntGrid value at a cell; `undefined` when out of bounds. `0` = empty. */
  readonly valueAt: (cx: number, cy: number) => number | undefined;
  /** Group uid owning an IntGrid value, or `0` when ungrouped. */
  readonly groupOf: (value: number) => number;
}

/** The tileset geometry needed to turn a tile id into a source rectangle. */
export interface LdtkRuleTileset {
  /** Tileset width in tiles. */
  readonly cWid: number;
  /** Edge length of one tile in pixels. */
  readonly tileGridSize: number;
  /** Outer padding in pixels. */
  readonly padding: number;
  /** Gap between tiles in pixels. */
  readonly spacing: number;
  /**
   * Whether every pixel of a tile is fully opaque. Drives occlusion culling
   * (see {@link runLdtkAutoLayer}); omitting it makes the engine emit tiles
   * LDtk would have discarded as hidden.
   */
  readonly isOpaque?: (tileId: number) => boolean;
}

/** Options for {@link runLdtkAutoLayer}. */
export interface RunLdtkAutoLayerOptions {
  /**
   * The layer instance's `seed`. Every stochastic decision derives from this,
   * so passing LDtk's own seed reproduces LDtk's own bake.
   */
  readonly seed: number;
  /** Layer cell size in pixels — the stride for emitted tile positions. */
  readonly gridSize: number;
  /** Tileset geometry. Omitted geometry falls back to `gridSize` squares. */
  readonly tileset?: Readonly<LdtkRuleTileset>;
  /** Uids of optional rule groups enabled on this layer instance. */
  readonly enabledOptionalGroups?: readonly number[];
  /** Level biome values, gating groups that declare `requiredBiomeValues`. */
  readonly biomeValues?: readonly string[];
  /**
   * Restrict emitted tiles to this cell rectangle. Pattern matching still reads
   * the whole grid, so a windowed run yields exactly the tiles a full run would
   * have placed inside the window.
   */
  readonly region?: Readonly<{
    readonly cx: number;
    readonly cy: number;
    readonly cols: number;
    readonly rows: number;
  }>;
}

/**
 * Build a {@link LdtkRuleGridSource} over a flat row-major IntGrid.
 *
 * @param csv - Row-major IntGrid values, `0` = empty.
 * @param cols - Grid width in cells.
 * @param rows - Grid height in cells.
 * @param layerDef - Supplies the value→group mapping rules may test against.
 */
export function ldtkRuleSourceFromCsv(
  csv: readonly number[],
  cols: number,
  rows: number,
  layerDef?: Readonly<LdtkLayerDef>,
): LdtkRuleGridSource {
  const groups = new Map<number, number>();
  for (const value of layerDef?.intGridValues ?? []) {
    groups.set(value.value, value.groupUid ?? 0);
  }
  return {
    cols,
    rows,
    valueAt(cx, cy) {
      if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return undefined;
      return csv[cx + cy * cols] ?? 0;
    },
    groupOf(value) {
      return groups.get(value) ?? 0;
    },
  };
}

/**
 * Build the opacity predicate {@link LdtkRuleTileset} wants from a tileset
 * definition's cached flags.
 *
 * Returns `undefined` when the project carries no cached data, which callers
 * should treat as "assume nothing is opaque": over-emitting hidden tiles is a
 * cosmetic cost, whereas guessing them opaque would delete visible art.
 *
 * @param tileset - A parsed tileset definition.
 * @returns A tile-id predicate, or `undefined` when unavailable.
 */
export function ldtkOpaqueTileLookup(
  tileset: Readonly<{ opaqueTiles?: string }>,
): ((tileId: number) => boolean) | undefined {
  const flags = tileset.opaqueTiles;
  if (typeof flags !== 'string' || flags.length === 0) return undefined;
  return (tileId) => flags[tileId] === '1';
}

/**
 * Test one pattern cell against one IntGrid value.
 *
 * Pattern values are sentinel-encoded rather than plain: see
 * {@link LDTK_RULE_ANY_VALUE} and {@link LDTK_RULE_GROUP_STRIDE}. A negative
 * requirement is always the logical negation of its positive counterpart.
 */
function satisfies(
  requirement: number,
  value: number,
  groupOf: (value: number) => number,
): boolean {
  if (requirement === 0) return true;
  const magnitude = Math.abs(requirement);
  const positive = requirement > 0;

  if (magnitude === LDTK_RULE_ANY_VALUE) {
    return positive ? value !== 0 : value === 0;
  }
  if (magnitude >= LDTK_RULE_GROUP_STRIDE && magnitude % LDTK_RULE_GROUP_STRIDE === 0) {
    const groupUid = magnitude / LDTK_RULE_GROUP_STRIDE - 1;
    const inGroup = value !== 0 && groupOf(value) === groupUid;
    return positive ? inGroup : !inGroup;
  }
  return positive ? value === magnitude : value !== magnitude;
}

/**
 * Match a rule's pattern centred on a cell.
 *
 * `dirX`/`dirY` of `-1` mirror the sampling offsets, which is how one authored
 * pattern covers its own mirror images without storing them.
 */
function matchesAt(
  source: LdtkRuleGridSource,
  rule: Readonly<LdtkAutoRule>,
  cx: number,
  cy: number,
  dirX: number,
  dirY: number,
): boolean {
  const radius = (rule.size - 1) / 2;
  for (let py = 0; py < rule.size; py++) {
    for (let px = 0; px < rule.size; px++) {
      const requirement = rule.pattern[px + py * rule.size];
      if (requirement === 0) continue;
      const offsetX = (px - radius) * dirX;
      const offsetY = (py - radius) * dirY;
      let value = source.valueAt(cx + offsetX, cy + offsetY);
      if (value === undefined) {
        // Outside the grid. A rule either declares what lies beyond its edge or
        // refuses to match there at all.
        if (rule.outOfBoundsValue === null) return false;
        value = rule.outOfBoundsValue;
      }
      if (!satisfies(requirement, value, source.groupOf)) return false;
    }
  }
  return true;
}

/** Orientations a rule may be tried in, and the flip bits each one emits. */
interface Orientation {
  readonly dirX: number;
  readonly dirY: number;
  readonly flipBits: number;
}

/**
 * Orientations to attempt, in LDtk's emission order: unmirrored, then X, then
 * Y, then both.
 *
 * Every matching orientation paints — they do not compete. A pattern like
 * "solid on one side, empty here" legitimately matches both mirrorings where a
 * gap has walls on both sides, and LDtk stacks both tiles there.
 */
function orientationsOf(rule: Readonly<LdtkAutoRule>): readonly Orientation[] {
  const out: Orientation[] = [{ dirX: 1, dirY: 1, flipBits: 0 }];
  if (rule.flipX) out.push({ dirX: -1, dirY: 1, flipBits: 1 });
  if (rule.flipY) out.push({ dirX: 1, dirY: -1, flipBits: 2 });
  if (rule.flipX && rule.flipY) out.push({ dirX: -1, dirY: -1, flipBits: 3 });
  return out;
}

/** Euclidean modulo — used for tileset indexing, where negatives must wrap. */
function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/**
 * True when the rule's spacing phase admits this cell.
 *
 * Checker and modulo are one interlocking test rather than two independent
 * ones: a checker axis derives its phase from the *other* axis's modulo, which
 * is what staggers alternate rows instead of merely skipping every other one.
 * The sign-preserving `%` is deliberate — it matches Haxe, and a Euclidean
 * modulo here would shift the phase on negative coordinates.
 */
function passesSpacing(rule: Readonly<LdtkAutoRule>, cx: number, cy: number): boolean {
  const xModulo = rule.xModulo > 0 ? rule.xModulo : 1;
  const yModulo = rule.yModulo > 0 ? rule.yModulo : 1;

  if (rule.checker !== 'Vertical' && (cy - rule.yOffset) % yModulo !== 0) return false;
  if (
    rule.checker === 'Vertical' &&
    (cy + (Math.trunc(cx / xModulo) % 2)) % yModulo !== 0
  ) return false;

  if (rule.checker !== 'Horizontal' && (cx - rule.xOffset) % xModulo !== 0) return false;
  if (
    rule.checker === 'Horizontal' &&
    (cx + (Math.trunc(cy / yModulo) % 2)) % xModulo !== 0
  ) return false;

  return true;
}

/**
 * True when a `chance`- or Perlin-gated rule fires at this cell.
 *
 * Both are stable functions of the coordinate, never of evaluation order, so
 * resolving a single dirty cell agrees with resolving the whole layer.
 */
function passesRandomGate(
  rule: Readonly<LdtkAutoRule>,
  seed: number,
  cx: number,
  cy: number,
): boolean {
  if (rule.chance <= 0) return false;
  if (rule.chance < 1 && ldtkRandSeedCoords(seed + rule.uid, cx, cy, 100) >= rule.chance * 100) {
    return false;
  }
  if (rule.perlinActive) {
    const noise = ldtkPerlin(
      seed + rule.perlinSeed,
      cx * rule.perlinScale,
      cy * rule.perlinScale,
      rule.perlinOctaves,
    );
    if (noise < 0) return false;
  }
  return true;
}

/** Convert a tileset tile id into its pixel source rectangle origin. */
function tileSrc(
  tileId: number,
  tileset: Readonly<LdtkRuleTileset>,
): readonly [number, number] {
  const columns = tileset.cWid > 0 ? tileset.cWid : 1;
  const stride = tileset.tileGridSize + tileset.spacing;
  const gx = mod(tileId, columns);
  const gy = Math.floor(tileId / columns);
  return [tileset.padding + gx * stride, tileset.padding + gy * stride];
}

/**
 * Choose which of a rule's tile alternatives to use at a cell.
 *
 * A single alternative needs no draw at all — important, because taking one
 * would consume a different RNG stream than LDtk does and desynchronise every
 * later decision.
 */
function pickAlternative(
  rule: Readonly<LdtkAutoRule>,
  seed: number,
  flipBits: number,
  cx: number,
  cy: number,
): readonly number[] {
  if (rule.tileRectsIds.length <= 1) return rule.tileRectsIds[0] ?? [];
  // The flip bits participate in the seed, so a mirrored match draws a
  // different alternative than its unmirrored twin at the same cell.
  //
  // The draw is used unguarded, exactly as LDtk does. It can be negative, in
  // which case the lookup misses and the rule paints nothing at this cell —
  // reproducing that miss is the point, since LDtk's saved output has the same
  // gap. Clamping here would invent tiles no `.ldtk` file contains.
  const index = ldtkRandSeedCoords(rule.uid + seed + flipBits, cx, cy, rule.tileRectsIds.length);
  return rule.tileRectsIds[index] ?? [];
}

/**
 * Tile displacement in cells along one axis.
 *
 * Mirroring negates the whole offset — the author's static nudge included, not
 * just the random part — so a flipped stamp leans the other way.
 */
function axisOffset(
  staticOffset: number,
  min: number,
  max: number,
  seed: number,
  cx: number,
  cy: number,
  mirrored: boolean,
): number {
  const random = min === 0 && max === 0
    ? 0
    : ldtkRandSeedCoords(seed, cx, cy, max - min + 1) + min;
  return (mirrored ? -1 : 1) * (staticOffset + random);
}

/**
 * Pixel offsets for each tile of a stamp, relative to the matched cell.
 *
 * A stamp's tiles are stored as bare tileset ids; their arrangement is implied
 * by where they sit in the tileset grid, so the block is reconstructed from the
 * bounding box of those ids. The rule's pivot then chooses which point of the
 * block lands on the matched cell.
 *
 * Mirroring negates the offsets outright rather than reflecting the block, so a
 * flipped stamp extends the opposite way from the same anchor.
 */
function stampOffsets(
  tileIds: readonly number[],
  columns: number,
  rule: Readonly<LdtkAutoRule>,
  gridSize: number,
  tilePivotX: number,
  tilePivotY: number,
  flipBits: number,
): Map<number, { readonly x: number; readonly y: number }> {
  const out = new Map<number, { readonly x: number; readonly y: number }>();
  const safeColumns = columns > 0 ? columns : 1;
  const cxOf = (id: number): number => mod(id, safeColumns);
  const cyOf = (id: number): number => Math.floor(id / safeColumns);

  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const id of tileIds) {
    left = Math.min(left, cxOf(id));
    right = Math.max(right, cxOf(id));
    top = Math.min(top, cyOf(id));
    bottom = Math.max(bottom, cyOf(id));
  }

  const signX = (flipBits & 1) !== 0 ? -1 : 1;
  const signY = (flipBits & 2) !== 0 ? -1 : 1;
  for (const id of tileIds) {
    out.set(id, {
      x: Math.trunc((cxOf(id) - left - rule.pivotX * (right - left) + tilePivotX) * gridSize) * signX,
      y: Math.trunc((cyOf(id) - top - rule.pivotY * (bottom - top) + tilePivotY) * gridSize) * signY,
    });
  }
  return out;
}

/**
 * Resolve an IntGrid into tiles by applying a layer's auto-rules.
 *
 * Rules run in definition order — groups outer, rules inner. A rule with
 * `breakOnMatch` claims its cell, so later rules skip it; without it, matches
 * stack and later tiles draw on top. The returned array is in that same
 * evaluation order, which is also back-to-front draw order.
 *
 * **Never throws.** A layer with no rules, no tileset, or a malformed grid
 * yields an empty array.
 *
 * @param source - The IntGrid the rules read.
 * @param layerDef - Supplies the rule groups.
 * @param options - Seed, geometry, and optional-group/biome/region filters.
 * @returns Tiles in evaluation (draw) order.
 *
 * @example
 * ```ts
 * const source = ldtkRuleSourceFromCsv(csv, cols, rows, layerDef);
 * const tiles = runLdtkAutoLayer(source, layerDef, {
 *   seed: layer.seed ?? 0,
 *   gridSize: layer.__gridSize,
 *   tileset: { cWid, tileGridSize, padding, spacing },
 * });
 * ```
 */
export function runLdtkAutoLayer(
  source: Readonly<LdtkRuleGridSource>,
  layerDef: Readonly<LdtkLayerDef>,
  options: Readonly<RunLdtkAutoLayerOptions>,
): readonly LdtkTile[] {
  if (source === null || typeof source !== 'object') return [];
  if (layerDef === null || typeof layerDef !== 'object') return [];
  if (options === null || typeof options !== 'object') return [];

  const groups = layerDef.autoRuleGroups ?? [];
  if (groups.length === 0) return [];

  const gridSize = options.gridSize > 0 ? options.gridSize : 1;
  const tileset: LdtkRuleTileset = options.tileset ?? {
    cWid: 1,
    tileGridSize: gridSize,
    padding: 0,
    spacing: 0,
  };
  const seed = options.seed | 0;
  const tilePivotX = layerDef.tilePivotX ?? 0;
  const tilePivotY = layerDef.tilePivotY ?? 0;
  const enabledOptional = new Set(options.enabledOptionalGroups ?? []);
  const biomes = new Set(options.biomeValues ?? []);

  const region = options.region;
  const minX = region === undefined ? 0 : Math.max(0, region.cx);
  const minY = region === undefined ? 0 : Math.max(0, region.cy);
  const maxX = region === undefined ? source.cols - 1 : Math.min(source.cols - 1, region.cx + region.cols - 1);
  const maxY = region === undefined ? source.rows - 1 : Math.min(source.rows - 1, region.cy + region.rows - 1);

  // Emissions are collected per (rule, cell) rather than flattened immediately,
  // because whether a tile survives depends on what earlier rules put in the
  // same cell — resolved by the occlusion pass below.
  const emissions: Emission[] = [];

  for (const group of groups) {
    if (!group.active) continue;
    if (!isGroupApplied(group, enabledOptional, biomes, options.biomeValues !== undefined)) continue;

    for (const rule of group.rules) {
      if (!rule.active) continue;
      if (rule.tileRectsIds.length === 0) continue;
      const orientations = orientationsOf(rule);

      for (let cy = minY; cy <= maxY; cy++) {
        for (let cx = minX; cx <= maxX; cx++) {
          if (!passesSpacing(rule, cx, cy)) continue;

          const tiles: LdtkTile[] = [];
          for (const orientation of orientations) {
            // A rule that claims its cell stops at its first hit, so a
            // symmetric neighbourhood yields one tile rather than a mirrored
            // pair. Without breakOnMatch every matching mirror paints.
            if (tiles.length > 0 && rule.breakOnMatch) break;
            if (!matchesAt(source, rule, cx, cy, orientation.dirX, orientation.dirY)) continue;
            if (tiles.length === 0 && !passesRandomGate(rule, seed, cx, cy)) break;
            emitTiles(tiles, rule, orientation, tileset, gridSize, tilePivotX, tilePivotY, source.cols, seed, cx, cy);
          }
          if (tiles.length > 0) {
            emissions.push({ rule, cell: cx + cy * source.cols, tiles });
          }
        }
      }
    }
  }
  return resolveOcclusion(emissions, tileset);
}

/** Tiles one rule produced at one cell, before occlusion is resolved. */
interface Emission {
  readonly rule: Readonly<LdtkAutoRule>;
  readonly cell: number;
  readonly tiles: readonly LdtkTile[];
}

/**
 * Drop tiles that nothing could ever see.
 *
 * Walking a cell's emissions in evaluation order, the first rule that fully
 * covers it locks the cell and every later rule's tiles there are discarded.
 * A cell is locked by a `breakOnMatch` rule, or by a rule that paints an opaque
 * tile at full alpha without a position offset — an offset rule may land
 * elsewhere, so it cannot be assumed to cover anything.
 *
 * This is not merely an optimisation: LDtk omits these tiles from its saved
 * output, so emitting them would disagree with every existing `.ldtk` file.
 */
function resolveOcclusion(
  emissions: readonly Emission[],
  tileset: Readonly<LdtkRuleTileset>,
): readonly LdtkTile[] {
  const locked = new Set<number>();
  const byCell = new Map<number, Emission[]>();
  for (const emission of emissions) {
    const list = byCell.get(emission.cell);
    if (list === undefined) byCell.set(emission.cell, [emission]);
    else list.push(emission);
  }

  const dropped = new Set<Emission>();
  for (const list of byCell.values()) {
    locked.clear();
    for (const emission of list) {
      if (locked.has(emission.cell)) {
        dropped.add(emission);
        continue;
      }
      if (emission.rule.breakOnMatch) {
        locked.add(emission.cell);
      } else if (!hasPositionOffset(emission.rule) && emission.rule.alpha >= 1) {
        for (const tile of emission.tiles) {
          if (tileset.isOpaque?.(tile.t) === true) {
            locked.add(emission.cell);
            break;
          }
        }
      }
    }
  }

  const out: LdtkTile[] = [];
  for (const emission of emissions) {
    if (dropped.has(emission)) continue;
    for (const tile of emission.tiles) out.push(tile);
  }
  return out;
}

/** True when a rule can displace its tiles away from the matched cell. */
function hasPositionOffset(rule: Readonly<LdtkAutoRule>): boolean {
  return (
    rule.tileXOffset !== 0 ||
    rule.tileYOffset !== 0 ||
    rule.tileRandomXMin !== 0 ||
    rule.tileRandomXMax !== 0 ||
    rule.tileRandomYMin !== 0 ||
    rule.tileRandomYMax !== 0
  );
}

/**
 * Whether a rule group runs on this layer instance.
 *
 * Biome gating and the optional-group toggle are alternatives, not a
 * conjunction: when a group declares biome requirements *and* the level
 * actually carries a biome field, the biome decides outright and the group's
 * `isOptional` flag is ignored. A biome-gated group in a level with no biome
 * field falls back to the ordinary optional check.
 *
 * @param group - The rule group under test.
 * @param enabledOptional - Uids listed in the layer instance's `optionalRules`.
 * @param biomes - The level's biome values.
 * @param hasBiomeField - Whether the level defines the biome field at all.
 */
function isGroupApplied(
  group: Readonly<{
    uid: number;
    isOptional: boolean;
    requiredBiomeValues: readonly string[];
    biomeRequirementMode: number;
  }>,
  enabledOptional: ReadonlySet<number>,
  biomes: ReadonlySet<string>,
  hasBiomeField: boolean,
): boolean {
  if (group.requiredBiomeValues.length > 0 && hasBiomeField) {
    // Mode 1 demands every declared value; mode 0 (the default) any one.
    return group.biomeRequirementMode === 1
      ? group.requiredBiomeValues.every((value) => biomes.has(value))
      : group.requiredBiomeValues.some((value) => biomes.has(value));
  }
  return !group.isOptional || enabledOptional.has(group.uid);
}

/** Append the tile(s) one matched rule produces at a cell. */
function emitTiles(
  out: LdtkTile[],
  rule: Readonly<LdtkAutoRule>,
  orientation: Orientation,
  tileset: Readonly<LdtkRuleTileset>,
  gridSize: number,
  tilePivotX: number,
  tilePivotY: number,
  cols: number,
  seed: number,
  cx: number,
  cy: number,
): void {
  const chosen = pickAlternative(rule, seed, orientation.flipBits, cx, cy);
  if (chosen.length === 0) return;

  // X shares the tile-pick seed (flips included); Y uses `uid + seed + 1`.
  // The asymmetry is LDtk's, not a typo here.
  const offsetX = axisOffset(
    rule.tileXOffset, rule.tileRandomXMin, rule.tileRandomXMax,
    rule.uid + seed + orientation.flipBits, cx, cy, orientation.dirX < 0,
  );
  const offsetY = axisOffset(
    rule.tileYOffset, rule.tileRandomYMin, rule.tileRandomYMax,
    rule.uid + seed + 1, cx, cy, orientation.dirY < 0,
  );
  // Positions are pixels throughout: the cell origin plus the rule's own
  // displacement, which is authored in pixels rather than whole cells and so
  // can land a tile off the grid entirely.
  const baseX = cx * gridSize + offsetX;
  const baseY = cy * gridSize + offsetY;
  const alpha = rule.alpha < 1 ? rule.alpha : undefined;

  const stamp = rule.tileMode === 'Stamp'
    ? stampOffsets(chosen, tileset.cWid, rule, gridSize, tilePivotX, tilePivotY, orientation.flipBits)
    : undefined;

  // Provenance, matching LDtk's own bookkeeping: which rule placed this tile,
  // and at which cell. Stamp tiles all carry the anchor cell, not their own.
  const provenance: readonly number[] = [rule.uid, cx + cy * cols];

  for (const id of chosen) {
    const local = stamp?.get(id);
    pushTile(
      out,
      baseX + (local?.x ?? 0),
      baseY + (local?.y ?? 0),
      id,
      tileset,
      orientation.flipBits,
      alpha,
      provenance,
    );
    if (stamp === undefined) break; // Single mode paints only the first id.
  }
}

/** Append one tile, omitting default `f`/`a` so output matches LDtk's shape. */
function pushTile(
  out: LdtkTile[],
  x: number,
  y: number,
  tileId: number,
  tileset: Readonly<LdtkRuleTileset>,
  flipBits: number,
  alpha: number | undefined,
  provenance: readonly number[],
): void {
  const tile: {
    px: readonly [number, number];
    src: readonly [number, number];
    t: number;
    f?: number;
    a?: number;
    d?: readonly number[];
  } = {
    px: [x, y],
    src: tileSrc(tileId, tileset),
    t: tileId,
    d: provenance,
  };
  if (flipBits !== 0) tile.f = flipBits;
  if (alpha !== undefined) tile.a = alpha;
  out.push(tile);
}
