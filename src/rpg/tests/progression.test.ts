import { describe, it, expect } from 'vitest';
import { grantXpAward, xpForLevelStart, xpThresholdToAdvance } from '../progression';
import { createCreatureInstance, deriveMaxHp, type SpeciesDefinition } from '../creatures';

const SPECIES: SpeciesDefinition = {
  id: 'cub',
  name: 'Cub',
  typeId: 'ember',
  baseStats: { hp: 12, attack: 12, defense: 12, speed: 12 },
  catchBasisPoints: 4000,
  expYield: 30,
  learnset: [
    { level: 1, moveId: 'ember-jab' },
    { level: 5, moveId: 'ember-burst' },
    { level: 6, moveId: 'grove-whip' },
    { level: 7, moveId: 'tide-splash' },
    { level: 8, moveId: 'spark-nip' },
    { level: 9, moveId: 'grove-slam' },
  ],
  visual: { generatorVersion: 1, bodyPlan: 'blob', paletteSeed: 1, proportions: {}, features: [] },
};

describe('xp thresholds', () => {
  it('follows the 10 × level² envelope', () => {
    expect(xpForLevelStart(1)).toBe(0);
    expect(xpForLevelStart(4)).toBe(90);
    expect(xpForLevelStart(5)).toBe(160);
    expect(xpThresholdToAdvance(4)).toBe(160);
    expect(xpThresholdToAdvance(5)).toBe(250);
  });
});

describe('grantXpAward', () => {
  it('emits xpGained without a level below the threshold', () => {
    const creature = createCreatureInstance({ id: 'a', species: SPECIES, level: 4, individualSeed: 1 });
    const result = grantXpAward(creature, SPECIES, 20);
    expect(result.creature.level).toBe(4);
    expect(result.events).toEqual([{ type: 'xpGained', creatureId: 'a', amount: 20 }]);
  });

  it('levels up at the threshold, learning moves and preserving missing HP', () => {
    const creature = {
      ...createCreatureInstance({ id: 'a', species: SPECIES, level: 4, individualSeed: 1 }),
      currentHp: 10,
    };
    // Level 4→5 needs 160 cumulative; instance starts at 0 xp.
    const result = grantXpAward(creature, SPECIES, 160);
    expect(result.creature.level).toBe(5);
    expect(result.creature.currentHp).toBe(13); // missing HP preserved: +3 max HP
    expect(result.creature.moveIds).toContain('ember-burst');
    const types = result.events.map((event) => event.type);
    expect(types).toContain('levelGained');
    expect(types).toContain('moveLearned');
  });

  it('supports multiple level-ups in one award', () => {
    const creature = createCreatureInstance({ id: 'a', species: SPECIES, level: 4, individualSeed: 1 });
    const result = grantXpAward(creature, SPECIES, 250); // reaches level 6
    expect(result.creature.level).toBe(6);
    expect(result.events.filter((event) => event.type === 'levelGained').length).toBe(2);
  });

  it('defers move learning once four moves are known', () => {
    const creature = createCreatureInstance({ id: 'a', species: SPECIES, level: 4, individualSeed: 1 });
    // Level 4 with moves [ember-jab]; push through levels 5..9 so the
    // creature reaches the four-move cap, then one more.
    const result = grantXpAward(creature, SPECIES, 900);
    const deferred = result.events.filter((event) => event.type === 'moveLearnDeferred');
    expect(deferred.length).toBeGreaterThan(0);
    expect(result.creature.moveIds.length).toBeLessThanOrEqual(4);
  });

  it('stops at the level cap', () => {
    const creature = {
      ...createCreatureInstance({ id: 'a', species: SPECIES, level: 20, individualSeed: 1 }),
    };
    const result = grantXpAward(creature, SPECIES, 5000);
    expect(result.creature.level).toBe(20);
    expect(result.events.some((event) => event.type === 'levelGained')).toBe(false);
  });

  it('applies the starter envelope: level 4 + 150 xp guarantees level 5', () => {
    const creature = {
      ...createCreatureInstance({ id: 'a', species: SPECIES, level: 4, individualSeed: 1 }),
      xp: 150,
    };
    // Envelope XP award: max(1, floor(30 × 5 / 5)) = 30 against wild level 5.
    const award = Math.max(1, Math.floor((30 * 5) / 5));
    const result = grantXpAward(creature, SPECIES, award);
    expect(result.creature.level).toBe(5);
    expect(result.creature.currentHp).toBe(deriveMaxHp(12, 5));
  });
});
