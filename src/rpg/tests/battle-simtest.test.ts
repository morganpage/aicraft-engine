import { describe, it, expect } from 'vitest';
import { compileRpgContent } from '../content';
import { createStarterContentBundle } from '../starter';
import { createBattleSimulationAdapter } from '../battle-simtest';
import { getBattleRequest } from '../battle';
import { createCreatureInstance } from '../creatures';
import { grantItem } from '../inventory';
import { createRngState } from '../../rng/state';
import { RPG_RULES_VERSION } from '../constants';

const COMPILED = compileRpgContent(createStarterContentBundle(2026));
if (!COMPILED.ok) throw new Error('starter content must compile');
const content = COMPILED.content;

function makeScenario() {
  const playerSpecies = content.species[content.speciesIds[0]];
  const wildSpecies = content.species[content.speciesIds[2]];
  return {
    party: [createCreatureInstance({ id: 'player-0', species: playerSpecies, level: 4, individualSeed: 1 })],
    inventory: grantItem(grantItem([], 'capture-orb', 2), 'potion', 1),
    wild: createCreatureInstance({ id: 'wild-1', species: wildSpecies, level: 4, individualSeed: 2 }),
    battleSeed: 4711,
  };
}

describe('createBattleSimulationAdapter', () => {
  it('binds id, rules version, and a scenario fingerprint', () => {
    const adapter = createBattleSimulationAdapter(makeScenario(), content);
    expect(adapter.id).toBe('rpg-battle');
    expect(adapter.version).toBe(RPG_RULES_VERSION);
    expect(adapter.scenarioFingerprint).toMatch(/^fnv1a-[0-9a-f]+$/);
  });
  it('varies the fingerprint with content and scenario', () => {
    const a = createBattleSimulationAdapter(makeScenario(), content).scenarioFingerprint;
    const scenario = makeScenario();
    scenario.battleSeed = 9999;
    const b = createBattleSimulationAdapter(scenario, content).scenarioFingerprint;
    expect(b).not.toBe(a);
  });
  it('creates deterministic initial state and enumerates legal actions', () => {
    const adapter = createBattleSimulationAdapter(makeScenario(), content);
    const state = adapter.createInitialState(0);
    expect(adapter.createInitialState(123)).toEqual(state);
    const actions = adapter.actions(state);
    expect(actions.length).toBeGreaterThan(0);
    expect(actions).toEqual(getBattleRequest(state, content).legalCommands);
  });
  it('steps purely toward a terminal outcome with a summary', () => {
    const adapter = createBattleSimulationAdapter(makeScenario(), content);
    let state = adapter.createInitialState(0);
    expect(adapter.outcome(state)).toBe('running');
    let steps = 0;
    while (adapter.outcome(state) === 'running' && steps < 100) {
      steps += 1;
      const actions = adapter.actions(state);
      state = adapter.step(state, actions[0], 1 / 60);
    }
    expect(adapter.outcome(state)).not.toBe('running');
    const summary = adapter.summarize?.(state) ?? {};
    expect(summary.outcome).toBe(state.outcome);
    expect(typeof summary.turn).toBe('number');
    expect(typeof adapter.stateKey?.(state)).toBe('string');
  });
  it('replays identically from the same seed (trace determinism)', () => {
    const adapter = createBattleSimulationAdapter(makeScenario(), content);
    const run = () => {
      let state = adapter.createInitialState(0);
      const keys: string[] = [];
      let steps = 0;
      while (adapter.outcome(state) === 'running' && steps < 100) {
        steps += 1;
        state = adapter.step(state, adapter.actions(state)[0], 1 / 60);
        keys.push(adapter.stateKey?.(state) ?? '');
      }
      return { keys, state };
    };
    const a = run();
    const b = run();
    expect(b.keys).toEqual(a.keys);
    expect(b.state).toEqual(a.state);
  });
  it('accepts an explicit battle rng through the scenario seed', () => {
    const scenario = makeScenario();
    const adapter = createBattleSimulationAdapter(scenario, content);
    const state = adapter.createInitialState(0);
    expect(state.battleRng).toEqual(createRngState(4711));
  });
});
