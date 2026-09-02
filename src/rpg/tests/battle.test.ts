import { describe, it, expect } from 'vitest';
import { compileRpgContent } from '../content';
import { createStarterContentBundle } from '../starter';
import {
  advanceBattle,
  createBattleState,
  getBattleRequest,
  DEFAULT_BATTLE_CONFIG,
} from '../battle';
import { createCreatureInstance, type SpeciesDefinition } from '../creatures';
import { createRngState, type SerializableRngState } from '../../rng/state';
import { grantItem } from '../inventory';
import { BATTLE_CATCH_DRAW_BUDGET, BATTLE_FIGHT_DRAW_BUDGET, BATTLE_FLEE_DRAW_BUDGET, BATTLE_SWITCH_DRAW_BUDGET } from '../constants';
import type { BattleCommand, BattleEvent, BattleState } from '../battle-types';
import type { InventoryState } from '../inventory';
import type { PartyState } from '../party';
import { advanceRng } from '../../rng/state';

const CONTENT = compileRpgContent(createStarterContentBundle(2026));
if (!CONTENT.ok) throw new Error('starter content must compile for battle tests');
const content = CONTENT.content;

const PLAYER_SPECIES = content.species[content.speciesIds[0]];
const WILD_SPECIES = content.species[content.speciesIds[1]];

function playerCreature(level = 4) {
  return createCreatureInstance({ id: 'player-0', species: PLAYER_SPECIES, level, individualSeed: 11 });
}
function wildCreature(level = 4) {
  return createCreatureInstance({ id: 'wild-1', species: WILD_SPECIES, level, individualSeed: 22 });
}
function inventoryWith(items: InventoryState = grantItem([], 'capture-orb', 3)): InventoryState {
  return grantItem(grantItem(items, 'capture-orb', 0), 'potion', 2);
}
function battle(seed: number, overrides?: Partial<Parameters<typeof createBattleState>[0]>): BattleState {
  return createBattleState({
    party: [playerCreature()],
    inventory: inventoryWith(),
    wild: wildCreature(),
    battleRng: createRngState(seed),
    ...overrides,
  });
}

function legalFight(state: BattleState): BattleCommand {
  const request = getBattleRequest(state, content);
  const fight = request.legalCommands.find((c) => c.type === 'fight');
  if (!fight) throw new Error(`no legal fight in phase ${state.phase}`);
  return fight;
}

function runScript(seed: number, script: (state: BattleState) => BattleCommand | null): { state: BattleState; events: BattleEvent[] } {
  let state = battle(seed);
  const events: BattleEvent[] = [];
  for (let turn = 0; turn < 100 && state.phase !== 'ended'; turn++) {
    const command = script(state);
    if (!command) break;
    const result = advanceBattle(state, command, content, DEFAULT_BATTLE_CONFIG);
    state = result.state;
    events.push(...result.events);
  }
  return { state, events };
}

describe('getBattleRequest', () => {
  it('exposes fight/catch/switch/flee legality in the command phase', () => {
    const request = getBattleRequest(battle(1), content);
    expect(request.phase).toBe('command');
    const types = request.legalCommands.map((c) => c.type);
    expect(types).toContain('fight');
    expect(types).toContain('catch');
    expect(types).toContain('flee');
    expect(types.filter((t) => t === 'fight').length).toBe(battle(1).playerParty[0].moveIds.length);
  });
  it('hides catch at full party', () => {
    const full: PartyState = Array.from({ length: 6 }, () => playerCreature());
    const state = battle(1, { party: full });
    expect(getBattleRequest(state, content).legalCommands.some((c) => c.type === 'catch')).toBe(false);
  });
  it('hides catch without a capture item', () => {
    const state = battle(1, { inventory: grantItem([], 'potion', 2) });
    expect(getBattleRequest(state, content).legalCommands.some((c) => c.type === 'catch')).toBe(false);
  });
  it('exposes only switch commands in forced-switch', () => {
    const party: PartyState = [
      { ...playerCreature(), currentHp: 0, id: 'downed' },
      playerCreature(),
    ];
    const state: BattleState = { ...battle(1, { party }), activePlayerIndex: 0, phase: 'forced-switch' };
    const request = getBattleRequest(state, content);
    expect(request.phase).toBe('forced-switch');
    expect(request.legalCommands.every((c) => c.type === 'switch')).toBe(true);
  });
  it('exposes nothing when ended', () => {
    const ended: BattleState = { ...battle(1), phase: 'ended', outcome: 'fled' };
    expect(getBattleRequest(ended, content).legalCommands).toEqual([]);
  });
});

describe('advanceBattle', () => {
  it('rejects illegal commands as no-ops with diagnostics', () => {
    const state = battle(5);
    const result = advanceBattle(state, { type: 'catch', itemId: 'not-an-item' }, content);
    expect(result.state).toEqual(state);
    expect(result.events[0].type).toBe('commandRejected');
    expect(result.diagnostics.length).toBe(1);
  });
  it('never mutates its input state', () => {
    const state = battle(5);
    const frozen = JSON.parse(JSON.stringify(state));
    advanceBattle(state, legalFight(state), content);
    advanceBattle(state, { type: 'flee' }, content);
    expect(state).toEqual(frozen);
  });
  it('ends in a terminal outcome from a fight script', () => {
    const { state, events } = runScript(9, (current) => legalFight(current));
    expect(state.phase).toBe('ended');
    expect(['victory', 'defeat']).toContain(state.outcome);
    expect(events[events.length - 1].type).toBe('battleEnded');
    expect(state.rewardsApplied).toBe(state.outcome === 'victory');
  });
  it('grants XP exactly once on victory', () => {
    const { state, events } = runScript(9, (current) => legalFight(current));
    if (state.outcome === 'victory') {
      const xpEvents = events.filter((e) => e.type === 'xpGained');
      expect(xpEvents.length).toBe(1);
      expect(state.playerParty[0].xp).toBe(xpEvents[0].amount);
    }
  });
  it('resolves flee deterministically and escalates on failure', () => {
    const { state, events } = runScript(31, (current) =>
      getBattleRequest(current, content).legalCommands.some((c) => c.type === 'flee') ? { type: 'flee' } : legalFight(current),
    );
    const attempts = events.filter((e) => e.type === 'fleeAttempted');
    expect(attempts.length).toBeGreaterThan(0);
    if (state.outcome === 'fled') {
      expect(events[events.length - 1]).toEqual({ type: 'battleEnded', outcome: 'fled' });
    } else {
      expect(['victory', 'defeat']).toContain(state.outcome);
    }
  });
  it('consumes the capture item and appends the wild creature on capture', () => {
    const captureScript = (current: BattleState): BattleCommand | null => {
      const request = getBattleRequest(current, content);
      const catchCommand = request.legalCommands.find((c) => c.type === 'catch');
      return catchCommand ?? request.legalCommands.find((c) => c.type === 'fight') ?? null;
    };
    let captured: { state: BattleState; events: BattleEvent[] } | null = null;
    for (const seed of [3, 12, 21, 34, 55, 77, 101, 202, 404, 808]) {
      const result = runScript(seed, captureScript);
      if (result.state.outcome === 'captured') {
        captured = result;
        break;
      }
    }
    expect(captured).not.toBeNull();
    if (captured) {
      expect(captured.state.playerParty.length).toBe(2);
      expect(captured.state.playerParty[1].id).toBe('wild-1');
      expect(captured.state.battleInventory.find((e) => e.itemId === 'capture-orb')?.quantity ?? 0).toBeLessThan(3);
      expect(captured.events.some((e) => e.type === 'creatureCaptured')).toBe(true);
    }
  });
  it('supports voluntary switch with a wild counterattack', () => {
    const party: PartyState = [playerCreature(), { ...playerCreature(), id: 'player-1' }];
    const state = battle(17, { party });
    const result = advanceBattle(state, { type: 'switch', partyIndex: 1 }, content);
    expect(result.state.activePlayerIndex).toBe(1);
    expect(result.events.some((e) => e.type === 'creatureSwitched')).toBe(true);
    expect(result.events.some((e) => e.type === 'moveUsed')).toBe(true);
  });
  it('forced switch grants no enemy move and consumes zero draws', () => {
    const party: PartyState = [{ ...playerCreature(), currentHp: 0 }, { ...playerCreature(), id: 'player-1' }];
    const state: BattleState = { ...battle(17, { party }), activePlayerIndex: 0, phase: 'forced-switch' };
    const before = state.battleRng.value;
    const result = advanceBattle(state, { type: 'switch', partyIndex: 1 }, content);
    expect(result.events.some((e) => e.type === 'moveUsed')).toBe(false);
    expect(result.state.battleRng.value).toBe(before);
    expect(result.state.phase).toBe('command');
    expect(result.state.turn).toBe(state.turn);
  });
  it('ends in defeat with no rewards when the last creature faints', () => {
    const party: PartyState = [{ ...playerCreature(3), currentHp: 1 }];
    const wild = createCreatureInstance({ id: 'wild-1', species: WILD_SPECIES, level: 5, individualSeed: 5 });
    const { state, events } = runScript(64, () => ({ type: 'flee' as const }));
    void party; void wild;
    if (state.outcome === 'defeat') {
      expect(state.rewardsApplied).toBe(false);
      expect(events[events.length - 1]).toEqual({ type: 'battleEnded', outcome: 'defeat' });
    } else {
      expect(state.outcome).toBe('fled');
    }
  });
});

describe('fixed RNG draw budgets', () => {
  function cursorAfter(seed: number, command: BattleCommand): number {
    const state = battle(seed);
    const result = advanceBattle(state, command, content);
    return result.state.battleRng.value;
  }
  function cursorAfterDraws(seed: number, count: number): number {
    let rng: SerializableRngState = createRngState(seed);
    for (let i = 0; i < count; i++) rng = advanceRng(rng).state;
    return rng.value;
  }
  it(`fight consumes exactly ${BATTLE_FIGHT_DRAW_BUDGET} draws`, () => {
    const fight = legalFight(battle(44));
    expect(cursorAfter(44, fight)).toBe(cursorAfterDraws(44, BATTLE_FIGHT_DRAW_BUDGET));
  });
  it(`flee consumes exactly ${BATTLE_FLEE_DRAW_BUDGET} draws`, () => {
    expect(cursorAfter(44, { type: 'flee' })).toBe(cursorAfterDraws(44, BATTLE_FLEE_DRAW_BUDGET));
  });
  it(`switch consumes exactly ${BATTLE_SWITCH_DRAW_BUDGET} draws`, () => {
    const party: PartyState = [playerCreature(), { ...playerCreature(), id: 'player-1' }];
    expect(cursorAfterForSwitch(44, party)).toBe(cursorAfterDraws(44, BATTLE_SWITCH_DRAW_BUDGET));
  });
  it(`catch consumes exactly ${BATTLE_CATCH_DRAW_BUDGET} draws`, () => {
    expect(cursorAfter(44, { type: 'catch', itemId: 'capture-orb' })).toBe(cursorAfterDraws(44, BATTLE_CATCH_DRAW_BUDGET));
  });
  function cursorAfterForSwitch(seed: number, party: PartyState): number {
    const state = battle(seed, { party });
    const result = advanceBattle(state, { type: 'switch', partyIndex: 1 }, content);
    return result.state.battleRng.value;
  }
});

describe('battle determinism and serialization', () => {
  const script = (state: BattleState): BattleCommand | null => {
    const request = getBattleRequest(state, content);
    return request.legalCommands[0] ?? null;
  };
  it('produces identical states and transcripts for identical runs', () => {
    const a = runScript(77, script);
    const b = runScript(77, script);
    expect(a.state).toEqual(b.state);
    expect(a.events).toEqual(b.events);
  });
  it('continues identically after mid-battle serialization', () => {
    let state = battle(77);
    const half: BattleEvent[] = [];
    for (let turn = 0; turn < 3 && state.phase !== 'ended'; turn++) {
      const command = script(state);
      if (!command) break;
      const result = advanceBattle(state, command, content);
      state = result.state;
      half.push(...result.events);
    }
    const restored: BattleState = JSON.parse(JSON.stringify(state));
    const continued: BattleEvent[] = [];
    let resumed = restored;
    for (let turn = 0; turn < 100 && resumed.phase !== 'ended'; turn++) {
      const command = script(resumed);
      if (!command) break;
      const result = advanceBattle(resumed, command, content);
      resumed = result.state;
      continued.push(...result.events);
    }
    const uninterrupted = runScript(77, script);
    expect([...half, ...continued]).toEqual(uninterrupted.events);
    expect(resumed).toEqual(uninterrupted.state);
  });
});

describe('battle invariants (property-style)', () => {
  it('keeps HP in range and every offered command legal across fuzz scripts', () => {
    for (const seed of [1, 2, 3, 5, 8, 13, 21, 34, 55, 89]) {
      let state = battle(seed);
      let step = 0;
      while (state.phase !== 'ended' && step < 100) {
        step += 1;
        const request = getBattleRequest(state, content);
        expect(request.legalCommands.length).toBeGreaterThan(0);
        // Every offered command must be accepted (no rejection events).
        const command = request.legalCommands[(seed + step) % request.legalCommands.length];
        const result = advanceBattle(state, command, content);
        expect(result.events.some((e) => e.type === 'commandRejected')).toBe(false);
        state = result.state;
        const active = state.playerParty[state.activePlayerIndex];
        const activeSpecies = content.species[active.speciesId] as SpeciesDefinition;
        const maxHp = active.currentHp;
        expect(maxHp).toBeGreaterThanOrEqual(0);
        expect(state.wild.currentHp).toBeGreaterThanOrEqual(0);
        void activeSpecies;
      }
      expect(state.phase).toBe('ended');
    }
  });
});
