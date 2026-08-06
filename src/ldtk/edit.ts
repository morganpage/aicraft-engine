/**
 * Pure editing operations over a parsed LDtk project.
 *
 * Every operation returns a new project rather than mutating: an editor gets
 * undo for free by keeping the previous value, and nothing can observe a
 * half-applied edit. Structural sharing keeps that cheap — only the level, the
 * layer, and the array actually touched are rebuilt.
 *
 * Operations also report which cells changed, so the caller can re-run
 * auto-tiling over a small neighbourhood instead of the whole layer. That
 * matters at brush speed: a full re-resolve of a large layer is milliseconds,
 * per pointer move.
 *
 * Determinism note: pure functions over plain data. No `Math.random`, no
 * `Date.now`. **Never throws** — out-of-range coordinates and unknown ids are
 * silent no-ops, matching the engine's editor conventions.
 *
 * @module
 */

import type {
  LdtkEntityInstance,
  LdtkLayerDef,
  LdtkLayerInstance,
  LdtkLevel,
  LdtkProject,
  LdtkTile,
} from './types';

/** A rectangle of cells, in layer grid coordinates. */
export interface LdtkCellRect {
  readonly cx: number;
  readonly cy: number;
  readonly cols: number;
  readonly rows: number;
}

/**
 * The outcome of an edit: the new project, plus what it invalidated.
 *
 * `changed` is `false` when the edit was a no-op — painting the value a cell
 * already had, or addressing something that does not exist. Callers should skip
 * re-tiling and skip pushing an undo entry in that case.
 */
export interface LdtkEditResult {
  readonly project: LdtkProject;
  readonly changed: boolean;
  /**
   * Cells whose auto-tiling may now be stale, already widened by rule reach.
   * `undefined` when nothing needs re-tiling.
   */
  readonly dirty?: LdtkCellRect;
}

/** A single cell assignment. */
export interface LdtkCellEdit {
  readonly cx: number;
  readonly cy: number;
  /** IntGrid value to write. `0` clears the cell. */
  readonly value: number;
}

/**
 * Largest pattern LDtk allows. A rule can read this far from the cell it
 * paints, so an edit invalidates a neighbourhood of half this radius.
 */
export const LDTK_MAX_PATTERN_SIZE = 9;

/** Locate a level by iid across both single-world and multi-world projects. */
function findLevel(project: LdtkProject, levelIid: string): LdtkLevel | undefined {
  for (const level of project.levels) {
    if (level.iid === levelIid) return level;
  }
  for (const world of project.worlds) {
    for (const level of world.levels) {
      if (level.iid === levelIid) return level;
    }
  }
  return undefined;
}

/**
 * Replace a level wherever it lives, preserving world structure.
 *
 * Levels appear either at the project root or inside a world, never both, so
 * this rebuilds only the container that actually holds the level.
 */
function replaceLevel(project: LdtkProject, next: LdtkLevel): LdtkProject {
  let found = false;
  const levels = project.levels.map((level) => {
    if (level.iid !== next.iid) return level;
    found = true;
    return next;
  });
  if (found) return { ...project, levels };

  const worlds = project.worlds.map((world) => {
    if (!world.levels.some((level) => level.iid === next.iid)) return world;
    return {
      ...world,
      levels: world.levels.map((level) => (level.iid === next.iid ? next : level)),
    };
  });
  return { ...project, worlds };
}

/** Replace one layer instance within a level. */
function replaceLayer(level: LdtkLevel, next: LdtkLayerInstance): LdtkLevel {
  if (level.layerInstances === null) return level;
  return {
    ...level,
    layerInstances: level.layerInstances.map((layer) => (layer.iid === next.iid ? next : layer)),
  };
}

/** Find a layer instance by iid. */
function findLayer(level: LdtkLevel, layerIid: string): LdtkLayerInstance | undefined {
  return level.layerInstances?.find((layer) => layer.iid === layerIid);
}

/**
 * Grow a cell rectangle by the reach of a layer's widest rule.
 *
 * A rule with an N×N pattern reads ⌊N/2⌋ cells in every direction, so changing
 * one cell can change the tiles of every cell within that radius. Stamps extend
 * further still — a stamp anchored outside the edit can drop tiles inside it —
 * so the radius is widened by the largest stamp extent as well.
 */
export function widenDirtyRect(
  rect: Readonly<LdtkCellRect>,
  layerDef: Readonly<LdtkLayerDef> | undefined,
): LdtkCellRect {
  let radius = Math.floor(LDTK_MAX_PATTERN_SIZE / 2);
  if (layerDef !== undefined) {
    let widest = 1;
    let stampReach = 0;
    for (const group of layerDef.autoRuleGroups ?? []) {
      for (const rule of group.rules) {
        if (rule.size > widest) widest = rule.size;
        if (rule.tileMode === 'Stamp') {
          for (const ids of rule.tileRectsIds) stampReach = Math.max(stampReach, ids.length);
        }
      }
    }
    radius = Math.floor(widest / 2) + stampReach;
  }
  return {
    cx: rect.cx - radius,
    cy: rect.cy - radius,
    cols: rect.cols + radius * 2,
    rows: rect.rows + radius * 2,
  };
}

/** Bounding rectangle of a set of cells. */
function boundsOf(cells: readonly LdtkCellEdit[]): LdtkCellRect | undefined {
  if (cells.length === 0) return undefined;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const cell of cells) {
    minX = Math.min(minX, cell.cx);
    minY = Math.min(minY, cell.cy);
    maxX = Math.max(maxX, cell.cx);
    maxY = Math.max(maxY, cell.cy);
  }
  return { cx: minX, cy: minY, cols: maxX - minX + 1, rows: maxY - minY + 1 };
}

/** A result that changed nothing. */
function unchanged(project: LdtkProject): LdtkEditResult {
  return { project, changed: false };
}

/**
 * Write IntGrid values into a layer.
 *
 * Batching a whole brush stroke into one call keeps it a single undo entry and
 * a single re-tile. Cells outside the layer are ignored, and writing a value a
 * cell already holds is dropped — so a drag that revisits cells reports no
 * change rather than forcing needless work.
 *
 * @param project - The project to edit.
 * @param levelIid - Level to edit.
 * @param layerIid - IntGrid layer to edit.
 * @param cells - Cell assignments to apply, in order.
 * @returns The new project plus the dirty region, already widened by rule reach.
 */
export function paintLdtkIntGrid(
  project: Readonly<LdtkProject>,
  levelIid: string,
  layerIid: string,
  cells: readonly LdtkCellEdit[],
): LdtkEditResult {
  const base = project as LdtkProject;
  if (cells.length === 0) return unchanged(base);

  const level = findLevel(base, levelIid);
  if (level === undefined) return unchanged(base);
  const layer = findLayer(level, layerIid);
  if (layer === undefined || layer.intGridCsv === undefined) return unchanged(base);

  const cols = layer.__cWid;
  const rows = layer.__cHei;
  const next = [...layer.intGridCsv];
  const applied: LdtkCellEdit[] = [];
  for (const cell of cells) {
    if (cell.cx < 0 || cell.cy < 0 || cell.cx >= cols || cell.cy >= rows) continue;
    const index = cell.cx + cell.cy * cols;
    const value = Number.isFinite(cell.value) ? Math.trunc(cell.value) : 0;
    if (next[index] === value) continue;
    next[index] = value;
    applied.push(cell);
  }
  if (applied.length === 0) return unchanged(base);

  const layerDef = base.defs.layers.find((def) => def.uid === layer.layerDefUid);
  const bounds = boundsOf(applied);
  return {
    project: replaceLevel(base, replaceLayer(level, { ...layer, intGridCsv: next })),
    changed: true,
    ...(bounds === undefined ? {} : { dirty: widenDirtyRect(bounds, layerDef) }),
  };
}

/**
 * Replace a layer's resolved tiles.
 *
 * Auto-tiling produces the whole layer's worth of tiles, so this is a wholesale
 * replacement rather than a merge; the caller owns deciding what the new set is.
 * Written to `autoLayerTiles` for rule-driven layers and `gridTiles` for hand
 * `Tiles` layers, matching where LDtk itself stores them.
 */
export function setLdtkLayerTiles(
  project: Readonly<LdtkProject>,
  levelIid: string,
  layerIid: string,
  tiles: readonly LdtkTile[],
): LdtkEditResult {
  const base = project as LdtkProject;
  const level = findLevel(base, levelIid);
  if (level === undefined) return unchanged(base);
  const layer = findLayer(level, layerIid);
  if (layer === undefined) return unchanged(base);

  const next: LdtkLayerInstance = layer.__type === 'Tiles'
    ? { ...layer, gridTiles: tiles }
    : { ...layer, autoLayerTiles: tiles };
  return {
    project: replaceLevel(base, replaceLayer(level, next)),
    changed: true,
  };
}

/**
 * Add an entity instance to an Entities layer.
 *
 * The caller supplies a fully-formed instance because identity (`iid`) and
 * field defaults come from the host's id policy and the entity definition, not
 * from anything this module can derive deterministically.
 */
export function addLdtkEntity(
  project: Readonly<LdtkProject>,
  levelIid: string,
  layerIid: string,
  entity: Readonly<LdtkEntityInstance>,
): LdtkEditResult {
  const base = project as LdtkProject;
  const level = findLevel(base, levelIid);
  if (level === undefined) return unchanged(base);
  const layer = findLayer(level, layerIid);
  if (layer === undefined || layer.__type !== 'Entities') return unchanged(base);

  const next = { ...layer, entityInstances: [...(layer.entityInstances ?? []), entity] };
  return { project: replaceLevel(base, replaceLayer(level, next)), changed: true };
}

/** Remove an entity instance by iid. */
export function removeLdtkEntity(
  project: Readonly<LdtkProject>,
  levelIid: string,
  layerIid: string,
  entityIid: string,
): LdtkEditResult {
  const base = project as LdtkProject;
  const level = findLevel(base, levelIid);
  if (level === undefined) return unchanged(base);
  const layer = findLayer(level, layerIid);
  if (layer === undefined || layer.entityInstances === undefined) return unchanged(base);

  const remaining = layer.entityInstances.filter((e) => e.iid !== entityIid);
  if (remaining.length === layer.entityInstances.length) return unchanged(base);
  return {
    project: replaceLevel(base, replaceLayer(level, { ...layer, entityInstances: remaining })),
    changed: true,
  };
}

/**
 * Move an entity to a pixel position within its level.
 *
 * `__grid` is kept consistent with the new pixel position, since consumers and
 * LDtk itself read it as a derived convenience rather than an independent value.
 */
export function moveLdtkEntity(
  project: Readonly<LdtkProject>,
  levelIid: string,
  layerIid: string,
  entityIid: string,
  x: number,
  y: number,
): LdtkEditResult {
  const base = project as LdtkProject;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return unchanged(base);
  const level = findLevel(base, levelIid);
  if (level === undefined) return unchanged(base);
  const layer = findLayer(level, layerIid);
  if (layer === undefined || layer.entityInstances === undefined) return unchanged(base);

  const gridSize = layer.__gridSize > 0 ? layer.__gridSize : 1;
  let changed = false;
  const entities = layer.entityInstances.map((entity) => {
    if (entity.iid !== entityIid) return entity;
    if (entity.px[0] === x && entity.px[1] === y) return entity;
    changed = true;
    return {
      ...entity,
      px: [x, y] as const,
      __grid: [Math.floor(x / gridSize), Math.floor(y / gridSize)] as const,
    };
  });
  if (!changed) return unchanged(base);
  return {
    project: replaceLevel(base, replaceLayer(level, { ...layer, entityInstances: entities })),
    changed: true,
  };
}

/** Set one field value on an entity instance. */
export function setLdtkEntityField(
  project: Readonly<LdtkProject>,
  levelIid: string,
  layerIid: string,
  entityIid: string,
  fieldIdentifier: string,
  value: unknown,
): LdtkEditResult {
  const base = project as LdtkProject;
  const level = findLevel(base, levelIid);
  if (level === undefined) return unchanged(base);
  const layer = findLayer(level, layerIid);
  if (layer === undefined || layer.entityInstances === undefined) return unchanged(base);

  let changed = false;
  const entities = layer.entityInstances.map((entity) => {
    if (entity.iid !== entityIid) return entity;
    if (!entity.fieldInstances.some((f) => f.__identifier === fieldIdentifier)) return entity;
    changed = true;
    return {
      ...entity,
      fieldInstances: entity.fieldInstances.map((field) =>
        field.__identifier === fieldIdentifier ? { ...field, __value: value } : field,
      ),
    };
  });
  if (!changed) return unchanged(base);
  return {
    project: replaceLevel(base, replaceLayer(level, { ...layer, entityInstances: entities })),
    changed: true,
  };
}

/**
 * Toggle an optional rule group on a layer instance.
 *
 * Optional groups are how one ruleset drives several looks, so this is an
 * ordinary authoring action rather than a definition change — it edits the
 * layer instance, and the whole layer needs re-tiling afterwards.
 */
export function setLdtkOptionalRuleGroup(
  project: Readonly<LdtkProject>,
  levelIid: string,
  layerIid: string,
  groupUid: number,
  enabled: boolean,
): LdtkEditResult {
  const base = project as LdtkProject;
  const level = findLevel(base, levelIid);
  if (level === undefined) return unchanged(base);
  const layer = findLayer(level, layerIid);
  if (layer === undefined) return unchanged(base);

  const current = layer.optionalRules ?? [];
  const has = current.includes(groupUid);
  if (has === enabled) return unchanged(base);
  const next = enabled ? [...current, groupUid] : current.filter((uid) => uid !== groupUid);

  return {
    project: replaceLevel(base, replaceLayer(level, { ...layer, optionalRules: next })),
    changed: true,
    dirty: { cx: 0, cy: 0, cols: layer.__cWid, rows: layer.__cHei },
  };
}

/**
 * Resize a level and every layer in it.
 *
 * IntGrid contents are re-laid out into the new dimensions rather than
 * reinterpreted: a naive array resize would shear the level, since row length
 * changes. Cells outside the new bounds are dropped; new cells start empty.
 * Tiles and entities beyond the new extent are discarded, which is what makes
 * shrinking a real operation rather than a hidden data leak.
 */
export function resizeLdtkLevel(
  project: Readonly<LdtkProject>,
  levelIid: string,
  pxWid: number,
  pxHei: number,
): LdtkEditResult {
  const base = project as LdtkProject;
  if (!Number.isFinite(pxWid) || !Number.isFinite(pxHei) || pxWid <= 0 || pxHei <= 0) {
    return unchanged(base);
  }
  const level = findLevel(base, levelIid);
  if (level === undefined) return unchanged(base);
  if (level.pxWid === pxWid && level.pxHei === pxHei) return unchanged(base);

  const layers = (level.layerInstances ?? []).map((layer) => {
    const gridSize = layer.__gridSize > 0 ? layer.__gridSize : 1;
    const cols = Math.max(0, Math.floor(pxWid / gridSize));
    const rows = Math.max(0, Math.floor(pxHei / gridSize));

    let intGridCsv = layer.intGridCsv;
    if (intGridCsv !== undefined) {
      const next = new Array<number>(cols * rows).fill(0);
      const copyCols = Math.min(cols, layer.__cWid);
      const copyRows = Math.min(rows, layer.__cHei);
      for (let cy = 0; cy < copyRows; cy++) {
        for (let cx = 0; cx < copyCols; cx++) {
          next[cx + cy * cols] = intGridCsv[cx + cy * layer.__cWid] ?? 0;
        }
      }
      intGridCsv = next;
    }

    const inside = (tile: LdtkTile): boolean =>
      tile.px[0] >= 0 && tile.px[1] >= 0 && tile.px[0] < pxWid && tile.px[1] < pxHei;

    return {
      ...layer,
      __cWid: cols,
      __cHei: rows,
      intGridCsv,
      gridTiles: layer.gridTiles?.filter(inside),
      autoLayerTiles: layer.autoLayerTiles?.filter(inside),
      entityInstances: layer.entityInstances?.filter(
        (e) => e.px[0] >= 0 && e.px[1] >= 0 && e.px[0] < pxWid && e.px[1] < pxHei,
      ),
    };
  });

  const next: LdtkLevel = { ...level, pxWid, pxHei, layerInstances: layers };
  return { project: replaceLevel(base, next), changed: true };
}
