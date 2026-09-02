import { describe, it, expect } from 'vitest';
import { generateSpecies, generateSpeciesSet } from '../creature-generator';
import { STARTER_MOVES, STARTER_TYPE_IDS } from '../starter';

const CATALOG = { typeIds: STARTER_TYPE_IDS, moves: STARTER_MOVES };

const NAME_BLACKLIST = new Set([
  'pikachu', 'eevee', 'charmander', 'squirtle', 'bulbasaur', 'pokemon',
]);

describe('generateSpecies', () => {
  it('is deterministic per (seed, index)', () => {
    expect(generateSpecies(42, 0, CATALOG)).toEqual(generateSpecies(42, 0, CATALOG));
    expect(generateSpecies(42, 3, CATALOG)).toEqual(generateSpecies(42, 3, CATALOG));
  });
  it('varies with seed and index', () => {
    const seeds = new Set([1, 2, 3, 4, 5, 6].map((seed) => generateSpecies(seed, 0, CATALOG).name));
    expect(seeds.size).toBeGreaterThan(3);
    expect(generateSpecies(42, 0, CATALOG).id).not.toBe(generateSpecies(42, 1, CATALOG).id);
  });
  it('produces JSON-serializable definitions', () => {
    const def = generateSpecies(7, 2, CATALOG);
    expect(JSON.parse(JSON.stringify(def))).toEqual(def);
  });
});

describe('generateSpeciesSet', () => {
  const SET = generateSpeciesSet(2026, CATALOG);

  it('produces exactly six species with unique safe ids', () => {
    expect(SET.length).toBe(6);
    const ids = new Set(SET.map((def) => def.id));
    expect(ids.size).toBe(6);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it('never emits a reserved name', () => {
    for (let seed = 1; seed <= 50; seed++) {
      for (const def of generateSpeciesSet(seed, CATALOG)) {
        const normalized = def.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        expect(NAME_BLACKLIST.has(normalized)).toBe(false);
      }
    }
  });

  it('meets the exact stat budget: sum 48 with each stat 8–16', () => {
    for (const def of SET) {
      const stats = def.baseStats;
      const total = stats.hp + stats.attack + stats.defense + stats.speed;
      expect(total).toBe(48);
      for (const value of [stats.hp, stats.attack, stats.defense, stats.speed]) {
        expect(value).toBeGreaterThanOrEqual(8);
        expect(value).toBeLessThanOrEqual(16);
      }
    }
  });

  it('keeps expYield in the 24–40 envelope and catch rates sane', () => {
    for (const def of SET) {
      expect(def.expYield).toBeGreaterThanOrEqual(24);
      expect(def.expYield).toBeLessThanOrEqual(40);
      expect(def.catchBasisPoints).toBeGreaterThan(0);
      expect(def.catchBasisPoints).toBeLessThanOrEqual(9500);
    }
  });

  it('covers every body plan and every type at least once', () => {
    const plans = new Set(SET.map((def) => def.visual.bodyPlan));
    for (const plan of ['blob', 'quadruped', 'avian', 'sprout', 'shell']) {
      expect(plans.has(plan as never)).toBe(true);
    }
    const types = new Set(SET.map((def) => def.typeId));
    expect(types.size).toBe(4);
  });

  it('builds valid learnsets from the supplied catalog only', () => {
    const moveIds = new Set(STARTER_MOVES.map((move) => move.id));
    for (const def of SET) {
      expect(def.learnset.length).toBeGreaterThan(0);
      expect(def.learnset[0].level).toBe(1);
      const strong = def.learnset[def.learnset.length - 1];
      expect(strong.level).toBeLessThanOrEqual(4);
      for (const entry of def.learnset) {
        expect(moveIds.has(entry.moveId)).toBe(true);
        expect(STARTER_MOVES.find((m) => m.id === entry.moveId)?.typeId).toBe(def.typeId);
      }
    }
  });

  it('carries a stable generatorVersion and serializable visual manifest', () => {
    for (const def of SET) {
      expect(def.visual.generatorVersion).toBe(1);
      expect(JSON.parse(JSON.stringify(def.visual))).toEqual(def.visual);
    }
  });
});
