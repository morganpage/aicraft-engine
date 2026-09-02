import { describe, it, expect } from 'vitest';
import { deriveMaxHp, deriveCreatureStats } from '../creatures';
import { healPartyFully } from '../party';
import type { CreatureInstance, SpeciesDefinition } from '../creatures';
import type { CreatureStats } from '../types';

const BASE: CreatureStats = { hp: 12, attack: 13, defense: 11, speed: 12 };

function makeSpecies(id: string, hp: number): SpeciesDefinition {
  return {
    id,
    name: id,
    typeId: 'ember',
    baseStats: { hp, attack: 12, defense: 10, speed: 11 },
    catchBasisPoints: 4000,
    expYield: 30,
    learnset: [{ level: 1, moveId: 'spark-bite' }],
    visual: {
      generatorVersion: 1,
      bodyPlan: 'blob',
      paletteSeed: 1,
      proportions: {},
      features: [],
    },
  };
}

function makeInstance(speciesId: string, level: number, currentHp: number): CreatureInstance {
  return {
    id: `inst-${speciesId}`,
    speciesId,
    individualSeed: 7,
    level,
    xp: 0,
    currentHp,
    moveIds: ['spark-bite'],
  };
}

describe('deriveMaxHp', () => {
  it('follows the balance envelope: base hp + 3 × level', () => {
    expect(deriveMaxHp(12, 4)).toBe(24);
    expect(deriveMaxHp(8, 1)).toBe(11);
    expect(deriveMaxHp(16, 20)).toBe(76);
  });
  it('coerces non-finite input and clamps level instead of throwing', () => {
    expect(deriveMaxHp(Number.NaN, 4)).toBe(12);
    expect(deriveMaxHp(10, Number.NaN)).toBe(13);
    expect(deriveMaxHp(10, 99)).toBe(deriveMaxHp(10, 20));
  });
});

describe('deriveCreatureStats', () => {
  it('derives hp with 3× level and other stats with 1× level', () => {
    expect(deriveCreatureStats(BASE, 4)).toEqual({ hp: 24, attack: 17, defense: 15, speed: 16 });
  });
});

describe('healPartyFully', () => {
  it('restores every member to its derived maximum HP', () => {
    const species: Record<string, SpeciesDefinition> = {
      cub: makeSpecies('cub', 10),
    };
    const party = [makeInstance('cub', 4, 1), makeInstance('cub', 6, 9)];
    const healed = healPartyFully(party, species);
    expect(healed[0].currentHp).toBe(deriveMaxHp(10, 4));
    expect(healed[1].currentHp).toBe(deriveMaxHp(10, 6));
    expect(party[0].currentHp).toBe(1);
  });
  it('leaves members with unknown species unchanged instead of throwing', () => {
    const party = [makeInstance('ghost', 4, 3)];
    const healed = healPartyFully(party, {});
    expect(healed[0].currentHp).toBe(3);
  });
  it('handles an empty party', () => {
    expect(healPartyFully([], {})).toEqual([]);
  });
});
