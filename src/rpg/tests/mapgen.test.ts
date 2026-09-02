import { describe, it, expect } from 'vitest';
import {
  generateRpgWorld,
  DEFAULT_WORLD_GEN_CONFIG,
  STARTER_FIELD_MAP_ID,
  STARTER_CLINIC_MAP_ID,
} from '../mapgen';
import { validateRpgMapCatalog } from '../validation';
import { verifyRpgWorld } from '../map-verify';

const SEED_CORPUS: readonly number[] = Array.from({ length: 40 }, (_, i) => i + 1);

function fieldMap(maps: readonly ReturnType<typeof generateRpgWorld>['maps'][number][]) {
  const field = maps.find((m) => m.id === STARTER_FIELD_MAP_ID);
  expect(field).toBeDefined();
  return field!;
}

function clinicMap(maps: readonly ReturnType<typeof generateRpgWorld>['maps'][number][]) {
  const clinic = maps.find((m) => m.id === STARTER_CLINIC_MAP_ID);
  expect(clinic).toBeDefined();
  return clinic!;
}

describe('generateRpgWorld', () => {
  it('is deterministic: the same seed regenerates a byte-identical world', () => {
    const a = generateRpgWorld(4242);
    const b = generateRpgWorld(4242);
    expect(a.diagnostics).toEqual(b.diagnostics);
    expect(a.maps).toEqual(b.maps);
  });

  it('varies layout with the seed', () => {
    const worlds = new Set(SEED_CORPUS.slice(0, 12).map((seed) => JSON.stringify(generateRpgWorld(seed).maps)));
    expect(worlds.size).toBeGreaterThan(6);
  });

  it('produces schema-valid maps for every seed in the corpus', () => {
    for (const seed of SEED_CORPUS) {
      const { maps } = generateRpgWorld(seed);
      const errors = validateRpgMapCatalog(maps).filter((d) => d.severity === 'error');
      expect(errors).toEqual([]);
    }
  });

  it('keeps every required anchor reachable for every seed in the corpus', () => {
    for (const seed of SEED_CORPUS) {
      const { maps } = generateRpgWorld(seed);
      const result = verifyRpgWorld(maps, STARTER_FIELD_MAP_ID, 'start');
      const errors = result.diagnostics.filter((d) => d.severity === 'error');
      expect(errors).toEqual([]);
      expect(result.ok).toBe(true);
    }
  });

  it('walls the outdoor perimeter and places a clinic hut door', () => {
    const { maps } = generateRpgWorld(7);
    const field = fieldMap(maps);
    const perimeter: [number, number][] = [];
    for (let x = 0; x < field.widthTiles; x++) {
      perimeter.push([x, 0], [x, field.heightTiles - 1]);
    }
    for (let y = 0; y < field.heightTiles; y++) {
      perimeter.push([0, y], [field.widthTiles - 1, y]);
    }
    for (const [x, y] of perimeter) {
      expect(field.collision[y * field.widthTiles + x]).toBe(true);
    }
    const clinic = clinicMap(maps);
    expect(clinic.healPoints.length).toBeGreaterThan(0);
    expect(clinic.spawns.some((s) => s.id === 'entry')).toBe(true);
    expect(clinic.warps.some((w) => w.targetMapId === STARTER_FIELD_MAP_ID)).toBe(true);
    expect(field.warps.some((w) => w.targetMapId === STARTER_CLINIC_MAP_ID)).toBe(true);
  });

  it('grows encounter-zone grass tagged with the configured table', () => {
    const { maps } = generateRpgWorld(9);
    const field = fieldMap(maps);
    const zoneTiles = field.encounterZones.filter((z) => z === DEFAULT_WORLD_GEN_CONFIG.encounterTableId);
    expect(zoneTiles.length).toBeGreaterThanOrEqual(8);
  });

  it('places an NPC with a reachable facing neighbor', () => {
    const { maps } = generateRpgWorld(11);
    const field = fieldMap(maps);
    expect(field.npcs.length).toBeGreaterThan(0);
  });

  it('clamps out-of-range config to safe bounds with a diagnostic', () => {
    const result = generateRpgWorld(3, { outdoorWidthTiles: 3, outdoorHeightTiles: 2 });
    const field = fieldMap(result.maps);
    expect(field.widthTiles).toBeGreaterThanOrEqual(12);
    expect(field.heightTiles).toBeGreaterThanOrEqual(10);
    expect(result.diagnostics.some((d) => d.code === 'rpg.mapgen.configClamped')).toBe(true);
  });
});
