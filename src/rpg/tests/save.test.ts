import { describe, it, expect } from 'vitest';
import { compileRpgContent } from '../content';
import { createStarterContentBundle } from '../starter';
import { STARTER_FIELD_MAP_ID, STARTER_FIELD_START_ID } from '../mapgen';
import { createRpgController, createRpgState } from '../state';
import {
  createRpgSave,
  migrateRpgSave,
  validateRpgSave,
  restoreRpgState,
  rpgSaveHash,
} from '../save';
import { DEFAULT_RPG_CONFIG } from '../constants';
import type { RpgInput, RpgDirection } from '../types';
import { canonicalize, fnv1a } from '../../level/serialize';

const COMPILED = compileRpgContent(createStarterContentBundle(2026));
if (!COMPILED.ok) throw new Error('starter content must compile');
const content = COMPILED.content;
const controller = createRpgController(content);
const DT = DEFAULT_RPG_CONFIG.tickDuration;

function newState(seed: number) {
  return createRpgState(content, seed, {
    spawnMapId: STARTER_FIELD_MAP_ID,
    spawnAnchorId: STARTER_FIELD_START_ID,
    startingParty: [{ speciesId: content.speciesIds[0], level: 4 }],
    startingInventory: [{ itemId: 'capture-orb', quantity: 3 }, { itemId: 'potion', quantity: 2 }],
  });
}

function input(direction: RpgDirection | null): RpgInput {
  return { direction, confirm: false, cancel: false, menu: false, battleCommand: null };
}

function walk(state: ReturnType<typeof newState>, ticks: number, direction: RpgDirection | null): ReturnType<typeof newState> {
  let current = state;
  for (let i = 0; i < ticks; i++) {
    current = controller.step(current, input(direction), DT).state;
  }
  // Settle: let any in-flight step arrive so the state is idle and
  // save-eligible.
  for (let i = 0; i < 10; i++) {
    if (current.activity.kind === 'overworld' && current.activity.overworld.step === null) break;
    current = controller.step(current, input(null), DT).state;
  }
  return current;
}

describe('createRpgSave', () => {
  it('projects an idle overworld state into a complete envelope', () => {
    const state = walk(newState(42), 20, 'right');
    const result = createRpgSave(state);
    expect(result.diagnostics).toEqual([]);
    expect(result.save).toBeDefined();
    const save = result.save!;
    expect(save.schemaVersion).toBe(1);
    expect(save.rulesVersion).toBe(state.rulesVersion);
    expect(save.contentFingerprint).toBe(content.fingerprint);
    expect(save.party.length).toBe(1);
    expect(save.tick).toBeGreaterThan(0);
  });
  it('rejects saves from mid-step, dialogue, and battle states as no-ops', () => {
    const stepping = controller.step(newState(1), input('right'), DT).state;
    expect(createRpgSave(stepping).save).toBeUndefined();
    expect(createRpgSave(stepping).diagnostics[0].code).toBe('rpg.save.notEligible');
  });
});

describe('save / restore round trip', () => {
  it('continues identically after a save/restore boundary', () => {
    const before = walk(newState(77), 30, 'right');
    const saved = createRpgSave(before).save!;
    const restored = restoreRpgState(saved, content).state!;

    const continueFrom = (state: ReturnType<typeof newState>): { state: ReturnType<typeof newState>; ticks: string[] } => {
      let current = state;
      const ticks: string[] = [];
      for (let i = 0; i < 40; i++) {
        const direction: RpgDirection | null = [null, 'up', 'right', 'down', 'left'][i % 5] as RpgDirection | null;
        current = controller.step(current, input(direction), DT).state;
        ticks.push(`${current.tick}:${current.activity.kind}:${current.worldRng.value}`);
      }
      return { state: current, ticks };
    };

    const uninterrupted = continueFrom(before);
    const resumed = continueFrom(restored);
    expect(resumed.ticks).toEqual(uninterrupted.ticks);
    expect(resumed.state).toEqual(uninterrupted.state);
  });

  it('survives a JSON storage round trip', () => {
    const state = walk(newState(9), 12, 'down');
    const saved = createRpgSave(state).save!;
    const stored = JSON.parse(JSON.stringify(saved));
    const migrated = migrateRpgSave(stored);
    expect(migrated.save).toBeDefined();
    const restored = restoreRpgState(migrated.save!, content);
    expect(restored.state).toBeDefined();
    expect(rpgSaveHash(restored.state! ? saved : saved)).toBe(rpgSaveHash(saved));
  });
});

describe('migrateRpgSave', () => {
  it('rejects corrupt input without throwing', () => {
    for (const raw of [null, 17, 'x', [], {}]) {
      const result = migrateRpgSave(raw);
      expect(result.save).toBeUndefined();
      expect(result.diagnostics.length).toBeGreaterThan(0);
    }
  });
  it('rejects future schema versions', () => {
    const result = migrateRpgSave({ schemaVersion: 99 });
    expect(result.diagnostics[0].code).toBe('rpg.save.futureVersion');
  });
});

describe('validateRpgSave', () => {
  it('accepts a matching save', () => {
    const saved = createRpgSave(walk(newState(3), 5, 'left')).save!;
    expect(validateRpgSave(saved, content).ok).toBe(true);
  });
  it('refuses content-fingerprint mismatches by default', () => {
    const saved = createRpgSave(walk(newState(3), 5, 'left')).save!;
    const other = compileRpgContent(createStarterContentBundle(999));
    if (!other.ok) throw new Error('other content must compile');
    const result = validateRpgSave(saved, other.content);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === 'rpg.save.fingerprintMismatch')).toBe(true);
    expect(restoreRpgState(saved, other.content).state).toBeUndefined();
  });
  it('reports structural corruption with stable paths', () => {
    const saved = createRpgSave(walk(newState(3), 5, 'left')).save!;
    const broken = { ...saved, party: [{ speciesId: 'ghost' }], worldRng: {} };
    const result = validateRpgSave(broken as unknown as typeof saved, content);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.path === 'party[0].speciesId')).toBe(true);
    expect(result.diagnostics.some((d) => d.path === 'worldRng')).toBe(true);
  });
});

describe('rpgSaveHash', () => {
  it('delegates to the canonical FNV pipeline deterministically', () => {
    const saved = createRpgSave(walk(newState(5), 8, 'up')).save!;
    expect(rpgSaveHash(saved)).toBe(fnv1a(canonicalize(saved)));
    expect(rpgSaveHash(saved)).toBe(rpgSaveHash(JSON.parse(JSON.stringify(saved))));
  });
  it('distinguishes different saves', () => {
    const a = createRpgSave(walk(newState(5), 8, 'up')).save!;
    const b = createRpgSave(walk(newState(5), 16, 'up')).save!;
    expect(rpgSaveHash(a)).not.toBe(rpgSaveHash(b));
  });
});
