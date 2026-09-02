import { describe, it, expect } from 'vitest';
import { rollEncounter, deriveEncounterSeeds, type EncounterTable } from '../encounters';
import { createRngState, advanceRng } from '../../rng/state';

const TABLE: EncounterTable = {
  id: 'grass',
  triggerBasisPoints: 10000, // always triggers
  entries: [
    { speciesId: 'alpha', weight: 3, minLevel: 3, maxLevel: 3 },
    { speciesId: 'beta', weight: 1, minLevel: 4, maxLevel: 5 },
  ],
};

describe('rollEncounter', () => {
  it('consumes exactly three draws even when the trigger fails', () => {
    const never: EncounterTable = { ...TABLE, triggerBasisPoints: 0 };
    const result = rollEncounter(createRngState(42), never);
    expect(result.encounter).toBeNull();
    let rng = createRngState(42);
    for (let i = 0; i < 3; i++) rng = advanceRng(rng).state;
    expect(result.worldRng).toEqual(rng);
  });
  it('consumes the same three draws on a trigger and a failure', () => {
    const always: EncounterTable = { ...TABLE, triggerBasisPoints: 10000 };
    const never: EncounterTable = { ...TABLE, triggerBasisPoints: 0 };
    const hit = rollEncounter(createRngState(7), always);
    const miss = rollEncounter(createRngState(7), never);
    expect(hit.worldRng).toEqual(miss.worldRng);
    expect(hit.encounter).not.toBeNull();
  });
  it('selects species by weight and level within the rolled entry', () => {
    let rng = createRngState(123);
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const result = rollEncounter(rng, TABLE);
      rng = result.worldRng;
      expect(result.encounter).not.toBeNull();
      const encounter = result.encounter as NonNullable<typeof result.encounter>;
      if (encounter.speciesId === 'alpha') {
        expect(encounter.level).toBe(3);
      } else {
        expect(encounter.speciesId).toBe('beta');
        expect(encounter.level).toBeGreaterThanOrEqual(4);
        expect(encounter.level).toBeLessThanOrEqual(5);
      }
      seen.add(encounter.speciesId);
    }
    expect(seen.size).toBe(2);
  });
  it('is deterministic and pure', () => {
    const a = rollEncounter(createRngState(99), TABLE);
    const b = rollEncounter(createRngState(99), TABLE);
    expect(a).toEqual(b);
  });
  it('handles an empty table defensively without throwing', () => {
    const result = rollEncounter(createRngState(1), { id: 'x', triggerBasisPoints: 10000, entries: [] });
    expect(result.encounter).toBeNull();
  });
});

describe('deriveEncounterSeeds', () => {
  it('addresses streams by the stable encounter index', () => {
    const a = deriveEncounterSeeds(500, 1);
    const b = deriveEncounterSeeds(500, 2);
    expect(a.battleSeed).not.toBe(b.battleSeed);
    expect(a.creatureSeed).not.toBe(b.creatureSeed);
    expect(a.battleSeed).not.toBe(a.creatureSeed);
    expect(deriveEncounterSeeds(500, 1)).toEqual(a);
  });
  it('produces unsigned 32-bit seeds', () => {
    for (const index of [0, 1, 7, 999]) {
      const seeds = deriveEncounterSeeds(777, index);
      for (const seed of [seeds.battleSeed, seeds.creatureSeed]) {
        expect(Number.isInteger(seed)).toBe(true);
        expect(seed).toBeGreaterThanOrEqual(0);
        expect(seed).toBeLessThanOrEqual(0xffffffff);
      }
    }
  });
});
