/**
 * Defensive `.ldtk` JSON parser.
 *
 * `JSON.parse` + structural validation against the LDtk schema subset in
 * `types.ts`. **Never throws** — returns a {@link LdtkParseResult} with
 * diagnostics, mirroring the engine's existing `validateLevel` contract.
 *
 * Determinism note: no `Math.random`, no `Date.now`, no global state.
 * The same input string always yields the same output.
 *
 * @module
 */

import type {
  LdtkAutoRule,
  LdtkAutoRuleGroup,
  LdtkCheckerMode,
  LdtkDefinitions,
  LdtkEntityDef,
  LdtkEntityInstance,
  LdtkEntityRenderMode,
  LdtkFieldDef,
  LdtkFieldInstance,
  LdtkIntGridValueGroupDef,
  LdtkLayerDef,
  LdtkLayerInstance,
  LdtkLayerType,
  LdtkLevel,
  LdtkParseError,
  LdtkParseResult,
  LdtkProject,
  LdtkTile,
  LdtkTilesetDef,
  LdtkTileMode,
  LdtkTileRenderMode,
  LdtkWorld,
} from './types';

/** Truthy narrow for a plain non-null object record (not an array). */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** True iff `v` is a finite `number`. */
function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** True iff `v` is a finite integer. */
function isFiniteInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && Number.isFinite(v);
}

/** Build a diagnostic. */
function diag(path: string, message: string, severity: 'error' | 'warning' = 'error'): LdtkParseError {
  return { path, message, severity };
}

/** Coerce to `number | undefined` (finite only). */
function num(v: unknown): number | undefined {
  return isFiniteNumber(v) ? v : undefined;
}

/** Coerce to `integer | undefined`. */
function int(v: unknown): number | undefined {
  return isFiniteInt(v) ? v : undefined;
}

/** Coerce to `string | undefined`. */
function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/** Coerce to a `[number, number]` tuple or `undefined`. */
function tuple2(v: unknown): readonly [number, number] | undefined {
  if (!Array.isArray(v) || v.length < 2) return undefined;
  const a = num(v[0]);
  const b = num(v[1]);
  if (a === undefined || b === undefined) return undefined;
  return [a, b];
}

/** Coerce an unknown value into an array (non-arrays → empty). */
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/**
 * Parse a tile. Tolerates missing `f`/`a` (defaulted downstream). Returns
 * `undefined` if `px` or `src` are missing/malformed (a tile we can't draw).
 */
function parseTile(raw: unknown, path: string, errors: LdtkParseError[]): LdtkTile | undefined {
  if (!isPlainObject(raw)) {
    errors.push(diag(path, 'tile is not an object'));
    return undefined;
  }
  const px = tuple2(raw.px);
  const src = tuple2(raw.src);
  if (px === undefined || src === undefined) return undefined;
  const t = int(raw.t) ?? 0;
  const f = int(raw.f);
  const a = num(raw.a);
  const tile: {
    px: readonly [number, number];
    src: readonly [number, number];
    t: number;
    f?: number;
    a?: number;
    d?: readonly number[];
  } = { px, src, t };
  if (f !== undefined) tile.f = f;
  if (a !== undefined) tile.a = a;
  if (Array.isArray(raw.d)) tile.d = raw.d.filter((v): v is number => isFiniteInt(v));
  return tile;
}

function parseField(raw: unknown): LdtkFieldInstance | undefined {
  if (!isPlainObject(raw)) return undefined;
  const identifier = str(raw.__identifier) ?? '';
  const type = str(raw.__type) ?? '';
  return { __identifier: identifier, __type: type, __value: raw.__value, defUid: int(raw.defUid) ?? 0 };
}

function parseFields(raw: unknown): LdtkFieldInstance[] {
  const out: LdtkFieldInstance[] = [];
  for (const item of arr(raw)) {
    const field = parseField(item);
    if (field !== undefined) out.push(field);
  }
  return out;
}

function parseEntity(raw: unknown): LdtkEntityInstance | undefined {
  if (!isPlainObject(raw)) return undefined;
  const identifier = str(raw.__identifier) ?? '';
  const defUid = int(raw.defUid) ?? 0;
  const iid = str(raw.iid) ?? '';
  const tags = arr(raw.__tags).filter((t): t is string => typeof t === 'string');
  const px = tuple2(raw.px) ?? [0, 0];
  const width = num(raw.width) ?? 0;
  const height = num(raw.height) ?? 0;
  const grid = tuple2(raw.__grid) ?? [0, 0];
  const pivot = tuple2(raw.__pivot) ?? [0, 0];
  let tile: LdtkEntityInstance['__tile'] = null;
  if (isPlainObject(raw.__tile)) {
    const t = raw.__tile;
    const tu = int(t.tilesetUid);
    const tx = num(t.x);
    const ty = num(t.y);
    const tw = num(t.w);
    const th = num(t.h);
    if (tu !== undefined && tx !== undefined && ty !== undefined && tw !== undefined && th !== undefined) {
      tile = { tilesetUid: tu, x: tx, y: ty, w: tw, h: th };
    }
  }
  return {
    __identifier: identifier,
    defUid,
    iid,
    __tags: tags,
    px,
    width,
    height,
    __grid: grid,
    __pivot: pivot,
    __tile: tile,
    fieldInstances: parseFields(raw.fieldInstances),
  };
}

/** Validate the `__type` discriminator against the known set. */
function parseLayerType(v: unknown): LdtkLayerType | undefined {
  if (v === 'IntGrid' || v === 'Tiles' || v === 'AutoLayer' || v === 'Entities') return v;
  return undefined;
}

function parseLayer(raw: unknown, path: string, errors: LdtkParseError[]): LdtkLayerInstance | undefined {
  if (!isPlainObject(raw)) {
    errors.push(diag(path, 'layer is not an object'));
    return undefined;
  }
  const type = parseLayerType(raw.__type);
  if (type === undefined) {
    errors.push(diag(`${path}.__type`, `unknown layer type ${JSON.stringify(raw.__type)}`));
    return undefined;
  }
  // intGridCsv
  let intGridCsv: readonly number[] | undefined;
  if (Array.isArray(raw.intGridCsv)) {
    intGridCsv = raw.intGridCsv.filter((v): v is number => isFiniteInt(v));
  }
  // gridTiles / autoLayerTiles
  let gridTiles: LdtkTile[] | undefined;
  if (Array.isArray(raw.gridTiles)) {
    gridTiles = [];
    for (let i = 0; i < raw.gridTiles.length; i++) {
      const tile = parseTile(raw.gridTiles[i], `${path}.gridTiles[${i}]`, errors);
      if (tile !== undefined) gridTiles.push(tile);
    }
  }
  let autoLayerTiles: LdtkTile[] | undefined;
  if (Array.isArray(raw.autoLayerTiles)) {
    autoLayerTiles = [];
    for (let i = 0; i < raw.autoLayerTiles.length; i++) {
      const tile = parseTile(raw.autoLayerTiles[i], `${path}.autoLayerTiles[${i}]`, errors);
      if (tile !== undefined) autoLayerTiles.push(tile);
    }
  }
  // entities
  let entityInstances: LdtkEntityInstance[] | undefined;
  if (Array.isArray(raw.entityInstances)) {
    entityInstances = [];
    for (const item of raw.entityInstances) {
      const entity = parseEntity(item);
      if (entity !== undefined) entityInstances.push(entity);
    }
  }
  const tilesetDefUid = raw.__tilesetDefUid === null ? null : int(raw.__tilesetDefUid) ?? null;
  return {
    __type: type,
    __identifier: str(raw.__identifier) ?? '',
    __cWid: int(raw.__cWid) ?? 0,
    __cHei: int(raw.__cHei) ?? 0,
    __gridSize: int(raw.__gridSize) ?? 0,
    __opacity: num(raw.__opacity) ?? 1,
    __pxTotalOffsetX: num(raw.__pxTotalOffsetX) ?? 0,
    __pxTotalOffsetY: num(raw.__pxTotalOffsetY) ?? 0,
    visible: typeof raw.visible === 'boolean' ? raw.visible : true,
    iid: str(raw.iid) ?? '',
    levelId: str(raw.levelId) ?? '',
    layerDefUid: int(raw.layerDefUid) ?? 0,
    intGridCsv,
    gridTiles,
    autoLayerTiles,
    entityInstances,
    __tilesetDefUid: tilesetDefUid,
    __tilesetRelPath: raw.__tilesetRelPath === null ? null : str(raw.__tilesetRelPath) ?? null,
    seed: int(raw.seed) ?? 0,
    optionalRules: arr(raw.optionalRules).filter((v): v is number => isFiniteInt(v)),
    overrideTilesetUid: nullableUid(raw.overrideTilesetUid),
  };
}

function parseLevel(raw: unknown, path: string, errors: LdtkParseError[]): LdtkLevel | undefined {
  if (!isPlainObject(raw)) {
    errors.push(diag(path, 'level is not an object'));
    return undefined;
  }
  const identifier = str(raw.identifier) ?? '';
  const iid = str(raw.iid) ?? '';
  const uid = int(raw.uid) ?? 0;
  const pxWid = num(raw.pxWid) ?? 0;
  const pxHei = num(raw.pxHei) ?? 0;
  if (pxWid <= 0 || pxHei <= 0) {
    errors.push(diag(`${path}.pxWid/pxHei`, 'level pixel dimensions must be positive'));
  }
  let layers: LdtkLayerInstance[] | null = null;
  if (Array.isArray(raw.layerInstances)) {
    layers = [];
    for (let i = 0; i < raw.layerInstances.length; i++) {
      const layer = parseLayer(raw.layerInstances[i], `${path}.layerInstances[${i}]`, errors);
      if (layer !== undefined) layers.push(layer);
    }
  }
  const neighbours = arr(raw.__neighbours)
    .filter(isPlainObject)
    .map((n) => ({
      dir: str(n.dir) ?? '',
      levelIid: str(n.levelIid) ?? '',
    }));
  const externalRelPath = raw.externalRelPath === null ? null : str(raw.externalRelPath) ?? null;
  return {
    identifier,
    iid,
    uid,
    pxWid,
    pxHei,
    worldX: num(raw.worldX) ?? 0,
    worldY: num(raw.worldY) ?? 0,
    worldDepth: int(raw.worldDepth) ?? 0,
    fieldInstances: parseFields(raw.fieldInstances),
    layerInstances: layers,
    __neighbours: neighbours,
    externalRelPath,
    bgColor: raw.bgColor === null || raw.bgColor === undefined ? null : str(raw.bgColor) ?? null,
    bgRelPath: raw.bgRelPath === null || raw.bgRelPath === undefined ? null : str(raw.bgRelPath) ?? null,
    bgPos: raw.bgPos === null || raw.bgPos === undefined ? null : str(raw.bgPos) ?? null,
  };
}

function parseTileset(raw: unknown): LdtkTilesetDef | undefined {
  if (!isPlainObject(raw)) return undefined;
  const tileGridSize = int(raw.tileGridSize) ?? 0;
  const pxWid = int(raw.pxWid) ?? 0;
  const pxHei = int(raw.pxHei) ?? 0;
  return {
    identifier: str(raw.identifier) ?? '',
    uid: int(raw.uid) ?? 0,
    relPath: raw.relPath === null || raw.relPath === undefined ? null : str(raw.relPath) ?? null,
    pxWid,
    pxHei,
    tileGridSize,
    padding: int(raw.padding) ?? 0,
    spacing: int(raw.spacing) ?? 0,
    __cWid: int(raw.__cWid) ?? (tileGridSize > 0 ? Math.floor(pxWid / tileGridSize) : 0),
    __cHei: int(raw.__cHei) ?? (tileGridSize > 0 ? Math.floor(pxHei / tileGridSize) : 0),
    embedAtlas: raw.embedAtlas === 'LdtkIcons' ? 'LdtkIcons' : null,
    opaqueTiles: isPlainObject(raw.cachedPixelData)
      ? str(raw.cachedPixelData.opaqueTiles)
      : undefined,
  };
}

/** Coerce a nullable uid field: `null`/absent/malformed all become `null`. */
function nullableUid(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  return int(v) ?? null;
}

function parseTileMode(v: unknown): LdtkTileMode {
  return v === 'Stamp' ? 'Stamp' : 'Single';
}

function parseChecker(v: unknown): LdtkCheckerMode {
  if (v === 'Horizontal' || v === 'Vertical') return v;
  return 'None';
}

/**
 * Parse one auto-rule. Rules whose `pattern` length disagrees with `size²` are
 * unusable — a partial window would silently match the wrong neighbourhood —
 * so they are dropped rather than repaired.
 */
function parseAutoRule(raw: unknown): LdtkAutoRule | undefined {
  if (!isPlainObject(raw)) return undefined;
  const size = int(raw.size) ?? 0;
  if (size <= 0) return undefined;
  const pattern = arr(raw.pattern).filter((v): v is number => isFiniteInt(v));
  if (pattern.length !== size * size) return undefined;

  const tileRectsIds: number[][] = [];
  for (const group of arr(raw.tileRectsIds)) {
    if (!Array.isArray(group)) continue;
    const ids = group.filter((v): v is number => isFiniteInt(v));
    if (ids.length > 0) tileRectsIds.push(ids);
  }

  return {
    uid: int(raw.uid) ?? 0,
    active: raw.active !== false,
    size,
    pattern,
    tileRectsIds,
    tileMode: parseTileMode(raw.tileMode),
    alpha: num(raw.alpha) ?? 1,
    chance: num(raw.chance) ?? 1,
    breakOnMatch: raw.breakOnMatch === true,
    flipX: raw.flipX === true,
    flipY: raw.flipY === true,
    xModulo: int(raw.xModulo) ?? 1,
    yModulo: int(raw.yModulo) ?? 1,
    xOffset: int(raw.xOffset) ?? 0,
    yOffset: int(raw.yOffset) ?? 0,
    tileXOffset: int(raw.tileXOffset) ?? 0,
    tileYOffset: int(raw.tileYOffset) ?? 0,
    tileRandomXMin: int(raw.tileRandomXMin) ?? 0,
    tileRandomXMax: int(raw.tileRandomXMax) ?? 0,
    tileRandomYMin: int(raw.tileRandomYMin) ?? 0,
    tileRandomYMax: int(raw.tileRandomYMax) ?? 0,
    checker: parseChecker(raw.checker),
    pivotX: num(raw.pivotX) ?? 0,
    pivotY: num(raw.pivotY) ?? 0,
    outOfBoundsValue: nullableUid(raw.outOfBoundsValue),
    perlinActive: raw.perlinActive === true,
    perlinSeed: num(raw.perlinSeed) ?? 0,
    perlinScale: num(raw.perlinScale) ?? 0,
    perlinOctaves: int(raw.perlinOctaves) ?? 0,
  };
}

function parseAutoRuleGroup(raw: unknown): LdtkAutoRuleGroup | undefined {
  if (!isPlainObject(raw)) return undefined;
  const rules: LdtkAutoRule[] = [];
  for (const item of arr(raw.rules)) {
    const rule = parseAutoRule(item);
    if (rule !== undefined) rules.push(rule);
  }
  return {
    uid: int(raw.uid) ?? 0,
    name: str(raw.name) ?? '',
    active: raw.active !== false,
    isOptional: raw.isOptional === true,
    rules,
    requiredBiomeValues: arr(raw.requiredBiomeValues).filter((v): v is string => typeof v === 'string'),
    biomeRequirementMode: int(raw.biomeRequirementMode) ?? 0,
  };
}

function parseLayerDef(raw: unknown): LdtkLayerDef | undefined {
  if (!isPlainObject(raw)) return undefined;
  const type = parseLayerType(raw.__type);
  if (type === undefined) return undefined;
  let intGridValues;
  if (Array.isArray(raw.intGridValues)) {
    intGridValues = raw.intGridValues
      .filter(isPlainObject)
      .map((v) => ({
        identifier: v.identifier === null ? null : str(v.identifier) ?? null,
        value: int(v.value) ?? 0,
        color: str(v.color) ?? '#000000',
        groupUid: int(v.groupUid) ?? 0,
      }));
  }
  let intGridValuesGroups: LdtkIntGridValueGroupDef[] | undefined;
  if (Array.isArray(raw.intGridValuesGroups)) {
    intGridValuesGroups = raw.intGridValuesGroups
      .filter(isPlainObject)
      .map((g) => ({
        uid: int(g.uid) ?? 0,
        identifier: g.identifier === null ? null : str(g.identifier) ?? null,
        color: g.color === null ? null : str(g.color) ?? null,
      }));
  }
  let autoRuleGroups: LdtkAutoRuleGroup[] | undefined;
  if (Array.isArray(raw.autoRuleGroups)) {
    autoRuleGroups = [];
    for (const item of raw.autoRuleGroups) {
      const group = parseAutoRuleGroup(item);
      if (group !== undefined) autoRuleGroups.push(group);
    }
  }
  return {
    __type: type,
    identifier: str(raw.identifier) ?? '',
    uid: int(raw.uid) ?? 0,
    gridSize: int(raw.gridSize) ?? 0,
    intGridValues,
    intGridValuesGroups,
    tilesetDefUid: nullableUid(raw.tilesetDefUid),
    autoTilesetDefUid: nullableUid(raw.autoTilesetDefUid),
    autoSourceLayerDefUid: nullableUid(raw.autoSourceLayerDefUid),
    autoRuleGroups,
    parallaxFactorX: num(raw.parallaxFactorX) ?? 0,
    parallaxFactorY: num(raw.parallaxFactorY) ?? 0,
    parallaxScaling: raw.parallaxScaling === true,
    displayOpacity: num(raw.displayOpacity) ?? 1,
    pxOffsetX: num(raw.pxOffsetX) ?? 0,
    pxOffsetY: num(raw.pxOffsetY) ?? 0,
    tilePivotX: num(raw.tilePivotX) ?? 0,
    tilePivotY: num(raw.tilePivotY) ?? 0,
    biomeFieldUid: nullableUid(raw.biomeFieldUid),
  };
}

function parseFieldDef(raw: unknown): LdtkFieldDef | undefined {
  if (!isPlainObject(raw)) return undefined;
  return {
    identifier: str(raw.identifier) ?? '',
    uid: int(raw.uid) ?? 0,
    __type: str(raw.__type) ?? '',
    canBeNull: raw.canBeNull === true,
    isArray: raw.isArray === true,
    defaultOverride: raw.defaultOverride,
  };
}

function parseEntityRenderMode(v: unknown): LdtkEntityRenderMode {
  if (v === 'Ellipse' || v === 'Tile' || v === 'Cross') return v;
  return 'Rectangle';
}

function parseTileRenderMode(v: unknown): LdtkTileRenderMode {
  if (
    v === 'Cover' || v === 'FitInside' || v === 'Repeat' || v === 'Stretch' ||
    v === 'FullSizeCropped' || v === 'FullSizeUncropped' || v === 'NineSlice'
  ) return v;
  // Modern LDtk writes the key on every def; older files without it get the
  // least-surprise single unscaled blit.
  return 'FitInside';
}

function parseNineSliceBorders(v: unknown): [number, number, number, number] | null {
  if (!Array.isArray(v) || v.length !== 4) return null;
  const borders: number[] = [];
  for (const item of v) {
    const n = int(item);
    if (n === undefined || n < 0) return null;
    borders.push(n);
  }
  return [borders[0], borders[1], borders[2], borders[3]];
}

function parseEntityDef(raw: unknown): LdtkEntityDef | undefined {
  if (!isPlainObject(raw)) return undefined;
  let tileRect: LdtkEntityDef['tileRect'] = null;
  if (isPlainObject(raw.tileRect)) {
    const r = raw.tileRect;
    const tu = int(r.tilesetUid);
    const x = num(r.x);
    const y = num(r.y);
    const w = num(r.w);
    const h = num(r.h);
    if (tu !== undefined && x !== undefined && y !== undefined && w !== undefined && h !== undefined) {
      tileRect = { tilesetUid: tu, x, y, w, h };
    }
  }
  const fieldDefs: LdtkFieldDef[] = [];
  for (const item of arr(raw.fieldDefs)) {
    const field = parseFieldDef(item);
    if (field !== undefined) fieldDefs.push(field);
  }
  return {
    identifier: str(raw.identifier) ?? '',
    uid: int(raw.uid) ?? 0,
    tags: arr(raw.tags).filter((t): t is string => typeof t === 'string'),
    width: num(raw.width) ?? 0,
    height: num(raw.height) ?? 0,
    resizableX: raw.resizableX === true,
    resizableY: raw.resizableY === true,
    color: str(raw.color) ?? '#94D9B3',
    renderMode: parseEntityRenderMode(raw.renderMode),
    tileRenderMode: parseTileRenderMode(raw.tileRenderMode),
    nineSliceBorders: parseNineSliceBorders(raw.nineSliceBorders),
    pivotX: num(raw.pivotX) ?? 0,
    pivotY: num(raw.pivotY) ?? 0,
    tilesetId: nullableUid(raw.tilesetId),
    tileRect,
    fieldDefs,
  };
}

function parseDefinitions(raw: unknown, errors: LdtkParseError[]): LdtkDefinitions {
  if (!isPlainObject(raw)) {
    errors.push(diag('defs', 'defs is not an object'));
    return { tilesets: [], enums: [], layers: [], entities: [] };
  }
  const tilesets = arr(raw.tilesets)
    .map(parseTileset)
    .filter((t): t is LdtkTilesetDef => t !== undefined);
  const layers = arr(raw.layers)
    .map(parseLayerDef)
    .filter((t): t is LdtkLayerDef => t !== undefined);
  const enums = arr(raw.enums)
    .filter(isPlainObject)
    .map((e) => ({
      identifier: str(e.identifier) ?? '',
      uid: int(e.uid) ?? 0,
      values: arr(e.values)
        .filter(isPlainObject)
        .map((vv) => ({ id: str(vv.id) ?? '', color: str(vv.color) ?? '#000000' })),
      tags: arr(e.tags).filter((t): t is string => typeof t === 'string'),
    }));
  const entities = arr(raw.entities)
    .map(parseEntityDef)
    .filter((e): e is LdtkEntityDef => e !== undefined);
  return { tilesets, enums, layers, entities };
}

function parseWorldLayout(v: unknown): LdtkProject['worldLayout'] {
  if (
    v === 'Free' || v === 'GridVania' ||
    v === 'LinearHorizontal' || v === 'LinearVertical' || v === null
  ) return v;
  return null;
}

function parseWorlds(raw: unknown, errors: LdtkParseError[]): readonly LdtkWorld[] {
  const out: LdtkWorld[] = [];
  const items = arr(raw);
  for (let i = 0; i < items.length; i++) {
    const w = items[i];
    if (!isPlainObject(w)) continue;
    const levels: LdtkLevel[] = [];
    if (Array.isArray(w.levels)) {
      for (let j = 0; j < w.levels.length; j++) {
        const level = parseLevel(w.levels[j], `worlds[${i}].levels[${j}]`, errors);
        if (level !== undefined) levels.push(level);
      }
    }
    out.push({
      identifier: str(w.identifier) ?? '',
      iid: str(w.iid) ?? '',
      worldLayout: parseWorldLayout(w.worldLayout),
      worldGridWidth: int(w.worldGridWidth) ?? null,
      worldGridHeight: int(w.worldGridHeight) ?? null,
      levels,
    });
  }
  return out;
}

/**
 * Parse a `.ldtk` project JSON string. **Never throws.**
 *
 * Performs `JSON.parse` then defensive structural coercion into
 * {@link LdtkProject}. Malformed-but-recoverable fields are skipped with a
 * warning; structural failures produce error diagnostics. `ok === true` iff
 * there are no error-severity diagnostics.
 *
 * @example
 * ```ts
 * const text = await fs.readFile('level.ldtk', 'utf8');
 * const { ok, project, errors } = parseLdtkProject(text);
 * if (!ok || !project) { console.error(errors); return; }
 * ```
 *
 * @param json - Raw `.ldtk` file contents.
 * @returns A {@link LdtkParseResult}.
 */
export function parseLdtkProject(json: string): LdtkParseResult {
  let root: unknown;
  try {
    root = JSON.parse(json);
  } catch (e) {
    return {
      ok: false,
      errors: [diag('root', `JSON parse failed: ${(e as Error).message}`)],
    };
  }
  if (!isPlainObject(root)) {
    return { ok: false, errors: [diag('root', 'project root is not an object')] };
  }
  const errors: LdtkParseError[] = [];
  const jsonVersion = str(root.jsonVersion) ?? '';
  if (jsonVersion === '') {
    errors.push(diag('jsonVersion', 'missing jsonVersion'));
  }
  const defs = parseDefinitions(root.defs, errors);
  const levels: LdtkLevel[] = [];
  if (Array.isArray(root.levels)) {
    for (let i = 0; i < root.levels.length; i++) {
      const level = parseLevel(root.levels[i], `levels[${i}]`, errors);
      if (level !== undefined) levels.push(level);
    }
  }
  const project: LdtkProject = {
    jsonVersion,
    iid: str(root.iid) ?? '',
    bgColor: str(root.bgColor) ?? '#000000',
    defs,
    levels,
    externalLevels: typeof root.externalLevels === 'boolean' ? root.externalLevels : false,
    worldLayout: parseWorldLayout(root.worldLayout),
    worldGridWidth: int(root.worldGridWidth) ?? null,
    worldGridHeight: int(root.worldGridHeight) ?? null,
    worlds: parseWorlds(root.worlds, errors),
  };
  return { ok: errors.every((e) => e.severity !== 'error'), project, errors };
}

/**
 * Parse a standalone `.ldtkl` level file (used when `externalLevels: true`).
 * **Never throws.** Returns `{ ok, level?, errors }`.
 */
export function parseLdtkLevelFile(json: string): {
  ok: boolean;
  level?: LdtkLevel;
  errors: readonly LdtkParseError[];
} {
  let root: unknown;
  try {
    root = JSON.parse(json);
  } catch (e) {
    return { ok: false, errors: [diag('root', `JSON parse failed: ${(e as Error).message}`)] };
  }
  const errors: LdtkParseError[] = [];
  const level = parseLevel(root, 'level', errors);
  return { ok: errors.every((e) => e.severity !== 'error') && level !== undefined, level, errors };
}
