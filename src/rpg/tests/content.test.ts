import { describe, it, expect } from 'vitest';
import { compileRpgContent, type RpgContentBundle } from '../content';
import {
  STARTER_TYPES,
  STARTER_MOVES,
  STARTER_ITEMS,
  STARTER_DIALOGUE,
} from '../starter';
import { generateSpeciesSet } from '../creature-generator';
import { generateRpgWorld } from '../mapgen';
import type { RpgMapDefinition, RpgTerrainKind } from '../map';

const W = 10;
const H = 8;

function makeMap(id: string): RpgMapDefinition {
  return {
    schemaVersion: 1,
    id,
    name: id,
    widthTiles: W,
    heightTiles: H,
    tileSize: 16,
    terrain: new Array<RpgTerrainKind>(W * H).fill('ground'),
    collision: new Array<boolean>(W * H).fill(false),
    encounterZones: new Array<string | null>(W * H).fill(null),
    spawns: [{ id: 'start', tile: { tileX: 1, tileY: 1 }, facing: 'down' }],
    npcs: [],
    warps: [],
    healPoints: [],
  };
}

function validBundle(overrides?: Partial<RpgContentBundle>): RpgContentBundle {
  const species = generateSpeciesSet(5, { typeIds: STARTER_TYPES.map((t) => t.id), moves: STARTER_MOVES });
  return {
    schemaVersion: 1,
    types: STARTER_TYPES,
    moves: STARTER_MOVES,
    species,
    items: STARTER_ITEMS,
    encounters: [{
      id: 'grass',
      triggerBasisPoints: 2500,
      entries: species.map((def) => ({ speciesId: def.id, weight: 4, minLevel: 3, maxLevel: 5 })),
    }],
    dialogues: [STARTER_DIALOGUE],
    maps: [makeMap('field'), makeMap('clinic')],
    ...overrides,
  };
}

function errorsOf(bundle: RpgContentBundle) {
  const result = compileRpgContent(bundle);
  return result.ok ? [] : result.diagnostics;
}

describe('compileRpgContent', () => {
  it('compiles a valid bundle with zero error diagnostics and a fingerprint', () => {
    const result = compileRpgContent(validBundle());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(result.content.fingerprint).toMatch(/^fnv1a-[0-9a-f]+$/);
    expect(result.content.speciesIds.length).toBe(6);
    expect(result.content.typeEffectiveness.ember.grove).toEqual({ numerator: 2, denominator: 1 });
  });

  it('is deterministic: identical bundles produce identical fingerprints', () => {
    const fingerprintOf = (bundle: RpgContentBundle): string | undefined => {
      const result = compileRpgContent(bundle);
      return result.ok ? result.content.fingerprint : undefined;
    };
    const a = fingerprintOf(validBundle());
    const b = fingerprintOf(validBundle());
    expect(a).toBe(b);
    const c = fingerprintOf(validBundle({ moves: [...STARTER_MOVES] }));
    expect(c).toBe(a);
    const changed = validBundle();
    const d = fingerprintOf({ ...changed, items: [...STARTER_ITEMS, { id: 'extra', name: 'Extra', kind: 'potion', healAmount: 5 }] });
    expect(d).not.toBe(a);
  });

  it('flags duplicate ids with the offending index in the path', () => {
    const diagnostics = errorsOf(validBundle({ types: [...STARTER_TYPES, STARTER_TYPES[0]] }));
    const duplicate = diagnostics.find((d) => d.code === 'rpg.content.duplicateId');
    expect(duplicate?.path).toBe('types[4].id');
  });

  it('flags missing cross-references with stable paths', () => {
    const species = [...generateSpeciesSet(5, { typeIds: STARTER_TYPES.map((t) => t.id), moves: STARTER_MOVES })];
    species[2] = { ...species[2], learnset: [{ level: 1, moveId: 'ghost-move' }] };
    const diagnostics = errorsOf(validBundle({ species }));
    const missing = diagnostics.find((d) => d.code === 'rpg.content.missingReference');
    expect(missing?.path).toBe('species[2].learnset[0].moveId');
  });

  it('rejects incomplete or non-allowed type matrices', () => {
    const broken = STARTER_TYPES.map((t) => ({ ...t, effectiveness: { ...t.effectiveness } }));
    delete broken[0].effectiveness.grove;
    let diagnostics = errorsOf(validBundle({ types: broken }));
    expect(diagnostics.some((d) => d.code === 'rpg.content.typeMatrixIncomplete')).toBe(true);

    const odd = STARTER_TYPES.map((t) => ({ ...t, effectiveness: { ...t.effectiveness } }));
    odd[0].effectiveness.grove = { numerator: 3, denominator: 1 };
    diagnostics = errorsOf(validBundle({ types: odd }));
    expect(diagnostics.some((d) => d.code === 'rpg.content.typeMatrixMultiplier')).toBe(true);
  });

  it('rejects invalid weights, empty tables, and bad level ranges', () => {
    const species = [...generateSpeciesSet(5, { typeIds: ['ember', 'tide', 'grove', 'spark'], moves: STARTER_MOVES })];
    const encounters = [{
      id: 'grass',
      triggerBasisPoints: 2500,
      entries: [{ speciesId: species[0].id, weight: 0, minLevel: 5, maxLevel: 3 }],
    }];
    const diagnostics = errorsOf(validBundle({ species, encounters }));
    expect(diagnostics.some((d) => d.code === 'rpg.content.invalidRange' && d.path.includes('weight'))).toBe(true);
    expect(diagnostics.some((d) => d.code === 'rpg.content.invalidRange' && d.path.includes('entries[0]'))).toBe(true);

    const empty = errorsOf(validBundle({ encounters: [{ id: 'grass', triggerBasisPoints: 2500, entries: [] }] }));
    expect(empty.some((d) => d.code === 'rpg.content.emptyTable')).toBe(true);
  });

  it('rejects out-of-order learnsets and duplicate learnset moves', () => {
    const species = [...generateSpeciesSet(5, { typeIds: ['ember', 'tide', 'grove', 'spark'], moves: STARTER_MOVES })];
    species[1] = {
      ...species[1],
      learnset: [
        { level: 4, moveId: species[1].learnset[1]?.moveId ?? 'ember-burst' },
        { level: 1, moveId: species[1].learnset[0].moveId },
        { level: 2, moveId: species[1].learnset[0].moveId },
      ],
    };
    const diagnostics = errorsOf(validBundle({ species }));
    expect(diagnostics.some((d) => d.code === 'rpg.content.learnsetOrder')).toBe(true);
    expect(diagnostics.some((d) => d.code === 'rpg.content.duplicateId' && d.path.includes('learnset'))).toBe(true);
  });

  it('rejects item definitions with missing kind fields', () => {
    const diagnostics = errorsOf(validBundle({
      items: [
        { id: 'potion', name: 'Potion', kind: 'potion' },
        { id: 'orb', name: 'Orb', kind: 'capture' },
      ],
    }));
    expect(diagnostics.some((d) => d.code === 'rpg.content.invalidRange' && d.path.includes('healAmount'))).toBe(true);
    expect(diagnostics.some((d) => d.code === 'rpg.content.invalidRange' && d.path.includes('catchBonus'))).toBe(true);
  });

  it('rejects terminal effects that are not sole and final', () => {
    const dialogue = {
      ...STARTER_DIALOGUE,
      nodes: [
        ...STARTER_DIALOGUE.nodes,
        {
          id: 'bad-node',
          speakerId: 'field-guide',
          text: 'oops',
          effects: [
            { kind: 'setFlag' as const, flag: 'x', value: true },
            { kind: 'endDialogue' as const },
            { kind: 'giveItem' as const, itemId: 'potion', quantity: 1 },
          ],
        },
      ],
    };
    const diagnostics = errorsOf(validBundle({ dialogues: [dialogue] }));
    const terminal = diagnostics.find((d) => d.code === 'rpg.content.terminalEffectOrder');
    expect(terminal?.path).toContain('bad-node');
  });

  it('flags unreachable dialogue nodes as warnings without failing compile', () => {
    const dialogue = {
      ...STARTER_DIALOGUE,
      nodes: [
        ...STARTER_DIALOGUE.nodes,
        { id: 'lonely', speakerId: 'field-guide', text: 'anyone?' },
      ],
    };
    const result = compileRpgContent(validBundle({ dialogues: [dialogue] }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.diagnostics.some((d) => d.code === 'rpg.content.dialogueUnreachableNode')).toBe(true);
    }
  });

  it('validates map NPC dialogue references and encounter-zone references', () => {
    const zones = new Array<string | null>(W * H).fill(null);
    zones[10] = 'ghost-table';
    const map = makeMap('field');
    const tampered = {
      ...map,
      npcs: [{ id: 'guide', name: 'Guide', tile: { tileX: 2, tileY: 2 }, facing: 'down' as const, dialogueId: 'dlg-ghost' }],
      encounterZones: zones,
    };
    const diagnostics = errorsOf(validBundle({ maps: [tampered] }));
    expect(diagnostics.some((d) => d.code === 'rpg.content.missingReference' && d.path.includes('dialogueId'))).toBe(true);
    expect(diagnostics.some((d) => d.code === 'rpg.content.missingReference' && d.path.includes('encounterZones'))).toBe(true);
  });

  it('rejects generated worlds whose maps fail structural validation', () => {
    const broken = generateRpgWorld(3);
    const tampered = broken.maps.map((map, i) =>
      i === 0 ? { ...map, collision: [false] } : map,
    );
    const diagnostics = errorsOf(validBundle({ maps: tampered }));
    expect(diagnostics.some((d) => d.code === 'rpg.map.gridLength')).toBe(true);
  });
});
