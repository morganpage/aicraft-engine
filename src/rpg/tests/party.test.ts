import { describe, it, expect } from 'vitest';
import { partyHasSpace, appendCreature, firstAliveIndex, aliveCount, type PartyState } from '../party';
import { createCreatureInstance, type SpeciesDefinition } from '../creatures';

const SPECIES: SpeciesDefinition = {
  id: 'cub',
  name: 'Cub',
  typeId: 'ember',
  baseStats: { hp: 12, attack: 12, defense: 12, speed: 12 },
  catchBasisPoints: 4000,
  expYield: 30,
  learnset: [
    { level: 1, moveId: 'ember-jab' },
    { level: 4, moveId: 'ember-burst' },
    { level: 7, moveId: 'grove-whip' },
  ],
  visual: { generatorVersion: 1, bodyPlan: 'blob', paletteSeed: 1, proportions: {}, features: [] },
};

function creature(id: string, hp: number) {
  return { ...createCreatureInstance({ id, species: SPECIES, level: 4, individualSeed: 1 }), currentHp: hp };
}

describe('createCreatureInstance', () => {
  it('starts at derived max HP with learnset moves at or below the level', () => {
    const instance = createCreatureInstance({ id: 'a', species: SPECIES, level: 4, individualSeed: 3 });
    expect(instance.currentHp).toBe(12 + 3 * 4);
    expect(instance.speciesId).toBe('cub');
    expect(instance.moveIds).toEqual(['ember-jab', 'ember-burst']);
    expect(instance.xp).toBe(0);
  });
  it('does not learn moves above the creation level', () => {
    const instance = createCreatureInstance({ id: 'a', species: SPECIES, level: 2, individualSeed: 3 });
    expect(instance.moveIds).toEqual(['ember-jab']);
  });
});

describe('party operations', () => {
  it('reports capacity and appends only while space exists', () => {
    let party: PartyState = [creature('a', 10)];
    expect(partyHasSpace(party, 6)).toBe(true);
    for (let i = 0; i < 6; i++) party = appendCreature(party, creature(`x${i}`, 10));
    expect(party.length).toBe(6);
    expect(partyHasSpace(party, 6)).toBe(false);
    expect(appendCreature(party, creature('overflow', 10)).length).toBe(6);
  });
  it('finds the first alive index and counts survivors', () => {
    const party = [creature('a', 0), creature('b', 5), creature('c', 0)];
    expect(firstAliveIndex(party)).toBe(1);
    expect(aliveCount(party)).toBe(1);
    expect(firstAliveIndex([creature('d', 0)])).toBe(-1);
  });
});
