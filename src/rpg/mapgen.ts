/**
 * Seeded starter-world generation: one outdoor field map plus one fixed
 * clinic interior connected by two warps.
 *
 * Constrained by design rather than a roguelike algorithm: perimeter
 * collision, hand-placed required anchors (start, NPC, clinic door, grass
 * patch), L-shaped carved paths guaranteeing connectivity, obstacle clusters
 * only on unreserved cells, and a fixed clinic layout. Every stochastic
 * choice draws from address-derived streams (`deriveSeed`), so the same seed
 * regenerates a byte-identical world. Output is validated and BFS-verified
 * before returning; unreachable anchors are repaired deterministically by
 * corridor carving, and anything still failing ships as diagnostics — never
 * a throw.
 */

import { advanceRng, createRngState } from '../rng/state';
import { deriveSeed } from '../rng/derive-seed';
import { verifyRpgWorld } from './map-verify';
import type { RpgMapDefinition, RpgTerrainKind } from './map';
import type { RpgDiagnostic, RpgEncounterTableId, RpgTileRef } from './types';
import { validateRpgMap, validateRpgMapCatalog } from './validation';

export const STARTER_FIELD_MAP_ID = 'starter-field';
export const STARTER_CLINIC_MAP_ID = 'starter-clinic';
export const STARTER_FIELD_START_ID = 'start';
export const STARTER_FIELD_RETURN_ID = 'clinic-return';
export const STARTER_CLINIC_ENTRY_ID = 'entry';

export interface RpgWorldGenConfig {
  readonly outdoorWidthTiles: number;
  readonly outdoorHeightTiles: number;
  readonly clinicWidthTiles: number;
  readonly clinicHeightTiles: number;
  readonly encounterTableId: RpgEncounterTableId;
  readonly grassTargetTiles: number;
  readonly obstacleClusterCount: number;
}

export const DEFAULT_WORLD_GEN_CONFIG: Readonly<RpgWorldGenConfig> = Object.freeze({
  outdoorWidthTiles: 26,
  outdoorHeightTiles: 18,
  clinicWidthTiles: 9,
  clinicHeightTiles: 7,
  encounterTableId: 'starter-grass',
  grassTargetTiles: 24,
  obstacleClusterCount: 7,
});

export interface RpgWorldGenResult {
  readonly maps: readonly RpgMapDefinition[];
  readonly diagnostics: readonly RpgDiagnostic[];
}

interface Grid {
  terrain: RpgTerrainKind[];
  collision: boolean[];
  zones: (RpgEncounterTableId | null)[];
}

function makeGrid(width: number, height: number): Grid {
  return {
    terrain: new Array<RpgTerrainKind>(width * height).fill('ground'),
    collision: new Array<boolean>(width * height).fill(false),
    zones: new Array<RpgEncounterTableId | null>(width * height).fill(null),
  };
}

function sameTile(a: RpgTileRef, b: RpgTileRef): boolean {
  return a.tileX === b.tileX && a.tileY === b.tileY;
}

function clamp(value: number, min: number, max: number): { value: number; clamped: boolean } {
  const safe = Number.isFinite(value) ? Math.floor(value) : min;
  const clampedValue = Math.min(max, Math.max(min, safe));
  return { value: clampedValue, clamped: clampedValue !== Math.floor(value) };
}

function carvePath(grid: Grid, width: number, from: RpgTileRef, to: RpgTileRef): void {
  let x = from.tileX;
  let y = from.tileY;
  const clear = (tx: number, ty: number) => {
    const i = ty * width + tx;
    grid.collision[i] = false;
    if (grid.terrain[i] === 'ground') grid.terrain[i] = 'path';
  };
  clear(x, y);
  while (x !== to.tileX) {
    x += to.tileX > x ? 1 : -1;
    clear(x, y);
  }
  while (y !== to.tileY) {
    y += to.tileY > y ? 1 : -1;
    clear(x, y);
  }
}

function buildFieldMap(
  seed: number,
  width: number,
  height: number,
  config: RpgWorldGenConfig,
): RpgMapDefinition {
  const grid = makeGrid(width, height);
  const at = (x: number, y: number) => y * width + x;

  for (let x = 0; x < width; x++) {
    grid.terrain[at(x, 0)] = 'obstacle';
    grid.collision[at(x, 0)] = true;
    grid.terrain[at(x, height - 1)] = 'obstacle';
    grid.collision[at(x, height - 1)] = true;
  }
  for (let y = 0; y < height; y++) {
    grid.terrain[at(0, y)] = 'obstacle';
    grid.collision[at(0, y)] = true;
    grid.terrain[at(width - 1, y)] = 'obstacle';
    grid.collision[at(width - 1, y)] = true;
  }

  const start: RpgTileRef = { tileX: 2, tileY: Math.floor(height / 2) };
  const npcTile: RpgTileRef = { tileX: Math.floor(width / 2), tileY: 3 };
  const npcApproach: RpgTileRef = { tileX: npcTile.tileX, tileY: npcTile.tileY + 1 };
  const door: RpgTileRef = { tileX: width - 5, tileY: 2 };
  const doorFront: RpgTileRef = { tileX: door.tileX, tileY: door.tileY + 1 };
  const grassX0 = Math.floor(width * 0.35);
  const grassX1 = width - 7;
  const grassY0 = Math.floor(height * 0.55);
  const grassY1 = height - 3;
  const grassCenter: RpgTileRef = {
    tileX: Math.floor((grassX0 + grassX1) / 2),
    tileY: Math.floor((grassY0 + grassY1) / 2),
  };

  // Clinic hut marker: a wall cap above the door with side walls.
  for (const [hx, hy] of [
    [door.tileX - 1, door.tileY - 1], [door.tileX, door.tileY - 1], [door.tileX + 1, door.tileY - 1],
    [door.tileX - 1, door.tileY], [door.tileX + 1, door.tileY],
  ] as const) {
    if (hx > 0 && hx < width - 1 && hy > 0) {
      grid.terrain[at(hx, hy)] = 'obstacle';
      grid.collision[at(hx, hy)] = true;
    }
  }

  carvePath(grid, width, start, npcApproach);
  carvePath(grid, width, npcApproach, grassCenter);
  carvePath(grid, width, grassCenter, doorFront);
  carvePath(grid, width, doorFront, door);

  const reserved = new Set<number>();
  const reserve = (tile: RpgTileRef) => {
    if (tile.tileX >= 0 && tile.tileX < width && tile.tileY >= 0 && tile.tileY < height) {
      reserved.add(at(tile.tileX, tile.tileY));
    }
  };
  const reserveAround = (tile: RpgTileRef) => {
    reserve(tile);
    reserve({ tileX: tile.tileX, tileY: tile.tileY - 1 });
    reserve({ tileX: tile.tileX, tileY: tile.tileY + 1 });
    reserve({ tileX: tile.tileX - 1, tileY: tile.tileY });
    reserve({ tileX: tile.tileX + 1, tileY: tile.tileY });
  };
  reserveAround(start);
  reserveAround(npcTile);
  reserveAround(door);
  reserveAround(doorFront);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (grid.terrain[at(x, y)] === 'path') reserve({ tileX: x, tileY: y });
      if (x >= grassX0 && x <= grassX1 && y >= grassY0 && y <= grassY1) reserve({ tileX: x, tileY: y });
    }
  }

  let rng = createRngState(deriveSeed(seed, 'mapgen', 'obstacles'));
  let clustersPlaced = 0;
  let attempts = 0;
  while (clustersPlaced < config.obstacleClusterCount && attempts < config.obstacleClusterCount * 30) {
    attempts += 1;
    const pickX = advanceRng(rng);
    rng = pickX.state;
    const pickY = advanceRng(rng);
    rng = pickY.state;
    const pickSize = advanceRng(rng);
    rng = pickSize.state;
    const baseX = 2 + Math.floor(pickX.value * (width - 4));
    const baseY = 2 + Math.floor(pickY.value * (height - 4));
    if (reserved.has(at(baseX, baseY))) continue;
    const clusterSize = 1 + Math.floor(pickSize.value * 3);
    const cluster: RpgTileRef[] = [{ tileX: baseX, tileY: baseY }];
    while (cluster.length < clusterSize) {
      const anchorTile = cluster[cluster.length - 1];
      const pickDir = advanceRng(rng);
      rng = pickDir.state;
      const dir = Math.floor(pickDir.value * 4);
      const next: RpgTileRef = {
        tileX: anchorTile.tileX + (dir === 2 ? -1 : dir === 3 ? 1 : 0),
        tileY: anchorTile.tileY + (dir === 0 ? -1 : dir === 1 ? 1 : 0),
      };
      if (next.tileX < 2 || next.tileX > width - 3 || next.tileY < 2 || next.tileY > height - 3) break;
      if (reserved.has(at(next.tileX, next.tileY))) break;
      if (cluster.some((tile) => sameTile(tile, next))) break;
      cluster.push(next);
    }
    for (const tile of cluster) {
      grid.terrain[at(tile.tileX, tile.tileY)] = 'obstacle';
      grid.collision[at(tile.tileX, tile.tileY)] = true;
    }
    clustersPlaced += 1;
  }

  let grassPlaced = 0;
  for (let y = grassY0; y <= grassY1 && grassPlaced < config.grassTargetTiles; y++) {
    for (let x = grassX0; x <= grassX1 && grassPlaced < config.grassTargetTiles; x++) {
      const i = at(x, y);
      if (grid.terrain[i] !== 'ground' || grid.collision[i]) continue;
      grid.terrain[i] = 'grass';
      grid.zones[i] = config.encounterTableId;
      grassPlaced += 1;
    }
  }

  return {
    schemaVersion: 1,
    id: STARTER_FIELD_MAP_ID,
    name: 'Meadow',
    widthTiles: width,
    heightTiles: height,
    tileSize: 16,
    terrain: grid.terrain,
    collision: grid.collision,
    encounterZones: grid.zones,
    spawns: [
      { id: STARTER_FIELD_START_ID, tile: start, facing: 'right' },
      { id: STARTER_FIELD_RETURN_ID, tile: doorFront, facing: 'down' },
    ],
    npcs: [{
      id: 'field-guide',
      name: 'Field Guide',
      tile: npcTile,
      facing: 'down',
      dialogueId: 'dlg-field-guide',
      visualSeed: deriveSeed(seed, 'npc', 'field-guide'),
    }],
    warps: [{
      id: 'clinic-door',
      source: door,
      targetMapId: STARTER_CLINIC_MAP_ID,
      targetAnchorId: STARTER_CLINIC_ENTRY_ID,
      targetFacing: 'up',
    }],
    healPoints: [],
    themeId: 'meadow',
  };
}

function buildClinicMap(width: number, height: number): RpgMapDefinition {
  const grid = makeGrid(width, height);
  const at = (x: number, y: number) => y * width + x;

  for (let x = 0; x < width; x++) {
    grid.terrain[at(x, 0)] = 'obstacle';
    grid.collision[at(x, 0)] = true;
    grid.terrain[at(x, height - 1)] = 'obstacle';
    grid.collision[at(x, height - 1)] = true;
  }
  for (let y = 0; y < height; y++) {
    grid.terrain[at(0, y)] = 'obstacle';
    grid.collision[at(0, y)] = true;
    grid.terrain[at(width - 1, y)] = 'obstacle';
    grid.collision[at(width - 1, y)] = true;
  }

  const doorX = Math.floor(width / 2);
  const door: RpgTileRef = { tileX: doorX, tileY: height - 1 };
  const entry: RpgTileRef = { tileX: doorX, tileY: height - 2 };
  const mat: RpgTileRef = { tileX: doorX, tileY: Math.floor(height / 2) };
  grid.terrain[at(door.tileX, door.tileY)] = 'path';
  grid.collision[at(door.tileX, door.tileY)] = false;
  grid.terrain[at(mat.tileX, mat.tileY)] = 'path';

  return {
    schemaVersion: 1,
    id: STARTER_CLINIC_MAP_ID,
    name: 'Rest House',
    widthTiles: width,
    heightTiles: height,
    tileSize: 16,
    terrain: grid.terrain,
    collision: grid.collision,
    encounterZones: grid.zones,
    spawns: [{ id: STARTER_CLINIC_ENTRY_ID, tile: entry, facing: 'up' }],
    npcs: [],
    warps: [{
      id: 'clinic-exit',
      source: door,
      targetMapId: STARTER_FIELD_MAP_ID,
      targetAnchorId: STARTER_FIELD_RETURN_ID,
      targetFacing: 'down',
    }],
    healPoints: [{ id: 'clinic-mat', tile: mat }],
    themeId: 'rest-house',
  };
}

function repairUnreachable(
  field: RpgMapDefinition,
  diagnostics: readonly RpgDiagnostic[],
): RpgMapDefinition | null {
  const start = field.spawns.find((s) => s.id === STARTER_FIELD_START_ID);
  if (!start) return null;
  const collision = [...field.collision];
  const terrain = [...field.terrain];
  let repaired = false;
  for (const diagnostic of diagnostics) {
    if (!diagnostic.path.startsWith(`maps[${STARTER_FIELD_MAP_ID}]`)) continue;
    if (
      diagnostic.code !== 'rpg.world.anchorUnreachable' &&
      diagnostic.code !== 'rpg.world.warpUnreachable' &&
      diagnostic.code !== 'rpg.world.healUnreachable' &&
      diagnostic.code !== 'rpg.world.encounterZoneUnreachable'
    ) {
      continue;
    }
    const clear = (x: number, y: number) => {
      if (x < 1 || x > field.widthTiles - 2 || y < 1 || y > field.heightTiles - 2) return;
      const i = y * field.widthTiles + x;
      if (collision[i]) {
        collision[i] = false;
        if (terrain[i] === 'obstacle') terrain[i] = 'ground';
        repaired = true;
      }
    };
    let x = start.tile.tileX;
    let y = start.tile.tileY;
    let targetX = 1;
    let targetY = 1;
    if (diagnostic.code === 'rpg.world.encounterZoneUnreachable') {
      const firstZone = field.encounterZones.findIndex((zone) => zone != null);
      if (firstZone < 0) continue;
      targetX = firstZone % field.widthTiles;
      targetY = Math.floor(firstZone / field.widthTiles);
    } else {
      const anchorMatch = /(?:spawns|warps|healPoints)\[([^\]]+)\]/.exec(diagnostic.path);
      if (!anchorMatch) continue;
      const anchorId = anchorMatch[1];
      const spawn = field.spawns.find((s) => s.id === anchorId);
      const warp = field.warps.find((w) => w.id === anchorId);
      const heal = field.healPoints.find((hp) => hp.id === anchorId);
      const tile = spawn?.tile ?? warp?.source ?? heal?.tile;
      if (!tile) continue;
      targetX = tile.tileX;
      targetY = tile.tileY;
    }
    while (x !== targetX) {
      x += targetX > x ? 1 : -1;
      clear(x, y);
    }
    while (y !== targetY) {
      y += targetY > y ? 1 : -1;
      clear(x, y);
    }
  }
  return repaired ? { ...field, collision, terrain } : null;
}

/**
 * Generate the deterministic two-map starter world. Pure and never throws;
 * config values are clamped to safe bounds with a diagnostic when they fall
 * outside them.
 */
export function generateRpgWorld(
  seed: number,
  config?: Partial<RpgWorldGenConfig>,
): RpgWorldGenResult {
  const diagnostics: RpgDiagnostic[] = [];
  const clamped: Partial<RpgWorldGenConfig> = { ...config };
  const clampInto = (key: keyof RpgWorldGenConfig, min: number, max: number) => {
    const requested = (config?.[key] ?? DEFAULT_WORLD_GEN_CONFIG[key]) as number;
    const result = clamp(requested, min, max);
    (clamped as Record<string, number>)[key] = result.value;
    if (result.clamped) {
      diagnostics.push({
        code: 'rpg.mapgen.configClamped',
        severity: 'warning',
        path: `config.${key}`,
        message: `Config ${key}=${requested} clamped to ${result.value} (allowed ${min}–${max}).`,
      });
    }
  };
  clampInto('outdoorWidthTiles', 12, 64);
  clampInto('outdoorHeightTiles', 10, 48);
  clampInto('clinicWidthTiles', 7, 21);
  clampInto('clinicHeightTiles', 5, 15);
  clampInto('grassTargetTiles', 4, 200);
  clampInto('obstacleClusterCount', 0, 40);
  const resolved: RpgWorldGenConfig = {
    ...DEFAULT_WORLD_GEN_CONFIG,
    ...clamped,
    encounterTableId: config?.encounterTableId ?? DEFAULT_WORLD_GEN_CONFIG.encounterTableId,
  };

  const field = buildFieldMap(seed, resolved.outdoorWidthTiles, resolved.outdoorHeightTiles, resolved);
  const clinic = buildClinicMap(resolved.clinicWidthTiles, resolved.clinicHeightTiles);
  const maps: RpgMapDefinition[] = [field, clinic];

  for (const map of maps) {
    diagnostics.push(...validateRpgMap(map).map((d) => ({
      ...d,
      path: `maps[${map.id}].${d.path}`,
    })));
  }
  diagnostics.push(...validateRpgMapCatalog(maps));

  let verification = verifyRpgWorld(maps, STARTER_FIELD_MAP_ID, STARTER_FIELD_START_ID);
  if (!verification.ok) {
    const repairedField = repairUnreachable(maps[0], verification.diagnostics);
    if (repairedField) {
      maps[0] = repairedField;
      verification = verifyRpgWorld(maps, STARTER_FIELD_MAP_ID, STARTER_FIELD_START_ID);
    }
  }
  diagnostics.push(...verification.diagnostics);

  return { maps, diagnostics };
}
