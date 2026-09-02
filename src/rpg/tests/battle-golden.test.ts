import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { compileRpgContent } from '../content';
import { createStarterContentBundle } from '../starter';
import { advanceBattle, createBattleState, getBattleRequest, DEFAULT_BATTLE_CONFIG } from '../battle';
import { createCreatureInstance } from '../creatures';
import { grantItem } from '../inventory';
import { createRngState } from '../../rng/state';
import type { BattleCommand, BattleEvent, BattleState } from '../battle-types';

/**
 * Golden battle transcripts. These pin exact typed event sequences; any diff
 * means simulated outcomes changed and therefore requires an explicit
 * RPG_RULES_VERSION decision — not a casual snapshot rewrite.
 */

const COMPILED = compileRpgContent(createStarterContentBundle(2026));
if (!COMPILED.ok) throw new Error('starter content must compile');
const content = COMPILED.content;

interface GoldenScenario {
  readonly name: string;
  readonly seed: number;
  readonly playerSpeciesId: string;
  readonly wildSpeciesId: string;
  readonly script: 'fight' | 'catch' | 'flee';
}

const SCENARIOS: readonly GoldenScenario[] = [
  { name: 'fight-to-victory', seed: 9, playerSpeciesId: '', wildSpeciesId: '', script: 'fight' },
  { name: 'catch-script', seed: 12, playerSpeciesId: '', wildSpeciesId: '', script: 'catch' },
  { name: 'flee-script', seed: 31, playerSpeciesId: '', wildSpeciesId: '', script: 'flee' },
];

function commandFor(script: GoldenScenario['script'], state: BattleState): BattleCommand | null {
  const legal = getBattleRequest(state, content).legalCommands;
  if (script === 'fight') return legal.find((c) => c.type === 'fight') ?? null;
  if (script === 'catch') return legal.find((c) => c.type === 'catch') ?? legal.find((c) => c.type === 'fight') ?? null;
  return legal.find((c) => c.type === 'flee') ?? legal.find((c) => c.type === 'fight') ?? null;
}

function runScenario(scenario: GoldenScenario): { outcome: string; turn: number; events: readonly BattleEvent[] } {
  const playerSpecies = content.species[scenario.playerSpeciesId || content.speciesIds[0]];
  const wildSpecies = content.species[scenario.wildSpeciesId || content.speciesIds[1]];
  let state = createBattleState({
    party: [createCreatureInstance({ id: 'player-0', species: playerSpecies, level: 4, individualSeed: 1 })],
    inventory: grantItem(grantItem([], 'capture-orb', 3), 'potion', 1),
    wild: createCreatureInstance({ id: 'wild-1', species: wildSpecies, level: 4, individualSeed: 2 }),
    battleRng: createRngState(scenario.seed),
  });
  const events: BattleEvent[] = [];
  for (let turn = 0; turn < 100 && state.phase !== 'ended'; turn++) {
    const command = commandFor(scenario.script, state);
    if (!command) break;
    const result = advanceBattle(state, command, content, DEFAULT_BATTLE_CONFIG);
    state = result.state;
    events.push(...result.events);
  }
  return { outcome: state.outcome ?? 'running', turn: state.turn, events };
}

describe('golden battle transcripts', () => {
  it('matches the pinned transcripts exactly', () => {
    const goldenPath = new URL('./golden/battle-transcripts.json', import.meta.url);
    const golden = JSON.parse(readFileSync(goldenPath, 'utf8')) as Record<string, unknown>;
    for (const scenario of SCENARIOS) {
      const actual = runScenario(scenario);
      const pinned = golden[scenario.name];
      expect(pinned, `golden entry '${scenario.name}' must exist`).toBeDefined();
      expect(actual.outcome).toBe((pinned as { outcome: string }).outcome);
      expect(actual.turn).toBe((pinned as { turn: number }).turn);
      expect(actual.events).toEqual((pinned as { events: BattleEvent[] }).events);
    }
  });

  it('is stable across repeated runs', () => {
    for (const scenario of SCENARIOS) {
      expect(runScenario(scenario)).toEqual(runScenario(scenario));
    }
  });
});

