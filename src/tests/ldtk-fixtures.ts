/**
 * Shared loader for the vendored LDtk sample projects.
 *
 * These files are the auto-tiler's correctness oracle. Each one carries both
 * the inputs to auto-tiling (an IntGrid plus the rule definitions that skin it)
 * *and* the output LDtk itself produced at save time (`autoLayerTiles`). Any
 * divergence between our engine's output and those baked tiles is a bug in our
 * engine, which makes the samples worth far more than hand-written fixtures.
 *
 * They are test fixtures only — never imported by `src/` and never shipped in
 * `dist/`. See `THIRD_PARTY.md` for their provenance and licensing.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseLdtkProject } from '../ldtk/parse';
import { ldtkOpaqueTileLookup } from '../ldtk/rules';
import type {
  LdtkAutoRuleGroup,
  LdtkLayerDef,
  LdtkLayerInstance,
  LdtkLevel,
  LdtkProject,
  LdtkTile,
} from '../ldtk/types';

/** Directory holding the vendored `.ldtk` sample projects. */
export const LDTK_SAMPLE_DIR = new URL('../../assets/ldtk/samples/', import.meta.url).pathname;

/** A parsed sample project paired with its filename. */
export interface LdtkSample {
  readonly name: string;
  readonly project: LdtkProject;
}

/** Read and parse every `.ldtk` file in the sample directory, sorted by name. */
export function loadLdtkSamples(): readonly LdtkSample[] {
  const names = readdirSync(LDTK_SAMPLE_DIR)
    .filter((n) => n.endsWith('.ldtk'))
    .sort();
  const out: LdtkSample[] = [];
  for (const name of names) {
    const text = readFileSync(join(LDTK_SAMPLE_DIR, name), 'utf8');
    const { project } = parseLdtkProject(text);
    if (project !== undefined) out.push({ name, project });
  }
  return out;
}

/**
 * One auto-tiling problem extracted from a sample: the IntGrid to read, the
 * rules to apply, and the tiles LDtk produced from exactly that pairing.
 */
export interface LdtkOracleCase {
  readonly sample: string;
  /** The project this case came from — editing tests need the whole document. */
  readonly project: LdtkProject;
  readonly level: string;
  /** Iid of the containing level, for addressing edit operations. */
  readonly levelIid: string;
  /** The layer instance whose `autoLayerTiles` are the expected output. */
  readonly layer: LdtkLayerInstance;
  /** The definition supplying the rules. */
  readonly layerDef: LdtkLayerDef;
  /**
   * IntGrid values feeding the rules, row-major. Resolved through
   * `autoSourceLayerDefUid` when the rules read another layer's grid.
   */
  readonly intGrid: readonly number[];
  readonly cols: number;
  readonly rows: number;
  /** Geometry of the tileset the rules paint from. */
  readonly tileset: {
    readonly cWid: number;
    readonly tileGridSize: number;
    readonly padding: number;
    readonly spacing: number;
    readonly isOpaque?: (tileId: number) => boolean;
  };
  /**
   * The level's biome values, or `undefined` when the level has no biome
   * field. The distinction matters: absent is not the same as empty.
   */
  readonly biomeValues?: readonly string[];
  /** LDtk's own output — what our engine must reproduce. */
  readonly expected: readonly LdtkTile[];
}

/**
 * Read the biome values a layer's rules are gated on.
 *
 * Returns `undefined` when the level carries no such field at all, which LDtk
 * treats differently from a field that is present but empty.
 */
function biomeValuesOf(
  level: LdtkLevel,
  def: LdtkLayerDef,
): readonly string[] | undefined {
  const uid = def.biomeFieldUid;
  if (uid === undefined || uid === null) return undefined;
  const field = level.fieldInstances.find((f) => f.defUid === uid);
  if (field === undefined) return undefined;
  const raw = field.__value;
  const values = Array.isArray(raw) ? raw : [raw];
  return values.filter((v): v is string => typeof v === 'string');
}

/** Every rule group in a layer def, flattened, in evaluation order. */
export function ruleGroupsOf(def: LdtkLayerDef): readonly LdtkAutoRuleGroup[] {
  return def.autoRuleGroups ?? [];
}

/** Total rule count across a layer def's groups. */
export function ruleCountOf(def: LdtkLayerDef): number {
  let n = 0;
  for (const group of ruleGroupsOf(def)) n += group.rules.length;
  return n;
}

function findLayerInstance(
  level: LdtkLevel,
  layerDefUid: number,
): LdtkLayerInstance | undefined {
  return level.layerInstances?.find((l) => l.layerDefUid === layerDefUid);
}

/**
 * Build every oracle case in a project.
 *
 * A layer contributes a case when it has rules *and* baked output. Layers whose
 * rules read another layer's IntGrid (`autoSourceLayerDefUid`) resolve that
 * source here, so consumers always receive the grid the rules actually saw.
 */
export function oracleCasesOf(sample: LdtkSample): readonly LdtkOracleCase[] {
  const { project } = sample;
  const defsByUid = new Map(project.defs.layers.map((d) => [d.uid, d]));
  const levels =
    project.worlds.length > 0
      ? project.worlds.flatMap((w) => w.levels)
      : project.levels;

  const out: LdtkOracleCase[] = [];
  for (const level of levels) {
    if (level.layerInstances === null) continue;
    for (const layer of level.layerInstances) {
      const def = defsByUid.get(layer.layerDefUid);
      if (def === undefined || ruleCountOf(def) === 0) continue;

      // Rules may read a different layer's IntGrid than the one they paint on.
      const sourceUid = def.autoSourceLayerDefUid ?? def.uid;
      const sourceLayer =
        sourceUid === def.uid ? layer : findLayerInstance(level, sourceUid);
      const intGrid = sourceLayer?.intGridCsv;
      if (intGrid === undefined || intGrid.length === 0) continue;

      const tilesetUid =
        layer.overrideTilesetUid ?? layer.__tilesetDefUid ?? def.autoTilesetDefUid ?? def.tilesetDefUid;
      const tilesetDef = project.defs.tilesets.find((t) => t.uid === tilesetUid);
      if (tilesetDef === undefined) continue;

      out.push({
        project,
        levelIid: level.iid,
        tileset: {
          cWid: tilesetDef.__cWid,
          tileGridSize: tilesetDef.tileGridSize,
          padding: tilesetDef.padding ?? 0,
          spacing: tilesetDef.spacing ?? 0,
          isOpaque: ldtkOpaqueTileLookup(tilesetDef),
        },
        sample: sample.name,
        level: level.identifier,
        layer,
        layerDef: def,
        intGrid,
        cols: sourceLayer?.__cWid ?? layer.__cWid,
        rows: sourceLayer?.__cHei ?? layer.__cHei,
        biomeValues: biomeValuesOf(level, def),
        expected: layer.autoLayerTiles ?? [],
      });
    }
  }
  return out;
}

/** Every oracle case across every sample. */
export function allOracleCases(): readonly LdtkOracleCase[] {
  return loadLdtkSamples().flatMap(oracleCasesOf);
}

/**
 * Canonical key for one painted tile, used to compare our output against
 * LDtk's without depending on emission order.
 *
 * `t` is deliberately excluded: it is informational in the schema and `src` is
 * authoritative for what actually gets blitted.
 */
export function tileKey(tile: LdtkTile): string {
  return `${tile.px[0]},${tile.px[1]}:${tile.src[0]},${tile.src[1]}:${tile.f ?? 0}:${tile.a ?? 1}`;
}

/** Compare two tile lists as multisets. Returns match counts and samples of each difference. */
export function diffTiles(
  actual: readonly LdtkTile[],
  expected: readonly LdtkTile[],
): {
  matched: number;
  missing: readonly LdtkTile[];
  extra: readonly LdtkTile[];
} {
  const pool = new Map<string, number>();
  for (const tile of expected) {
    const key = tileKey(tile);
    pool.set(key, (pool.get(key) ?? 0) + 1);
  }
  const extra: LdtkTile[] = [];
  let matched = 0;
  for (const tile of actual) {
    const key = tileKey(tile);
    const left = pool.get(key) ?? 0;
    if (left > 0) {
      pool.set(key, left - 1);
      matched++;
    } else {
      extra.push(tile);
    }
  }
  const missing: LdtkTile[] = [];
  for (const tile of expected) {
    const key = tileKey(tile);
    const left = pool.get(key) ?? 0;
    if (left > 0) {
      pool.set(key, left - 1);
      missing.push(tile);
    }
  }
  return { matched, missing, extra };
}
