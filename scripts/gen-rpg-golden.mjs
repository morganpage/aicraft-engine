// One-shot generator for src/rpg/tests/golden/battle-transcripts.json.
// Run with: npx tsx scripts/gen-rpg-golden.mjs
// Regenerating is a rules-version decision — see battle-golden.test.ts.
import { writeFileSync } from 'node:fs';
import { compileRpgContent } from '../src/rpg/content.ts';
import { createStarterContentBundle } from '../src/rpg/starter.ts';
import { advanceBattle, createBattleState, getBattleRequest, DEFAULT_BATTLE_CONFIG } from '../src/rpg/battle.ts';
import { createCreatureInstance } from '../src/rpg/creatures.ts';
import { grantItem } from '../src/rpg/inventory.ts';
import { createRngState } from '../src/rng/state.ts';

const compiled = compileRpgContent(createStarterContentBundle(2026));
if (!compiled.ok) throw new Error('starter content must compile');
const content = compiled.content;

const SCENARIOS = [
  { name: 'fight-to-victory', seed: 9, script: 'fight' },
  { name: 'catch-script', seed: 12, script: 'catch' },
  { name: 'flee-script', seed: 31, script: 'flee' },
];

function commandFor(script, state) {
  const legal = getBattleRequest(state, content).legalCommands;
  if (script === 'fight') return legal.find((c) => c.type === 'fight') ?? null;
  if (script === 'catch') return legal.find((c) => c.type === 'catch') ?? legal.find((c) => c.type === 'fight') ?? null;
  return legal.find((c) => c.type === 'flee') ?? legal.find((c) => c.type === 'fight') ?? null;
}

const output = {};
for (const scenario of SCENARIOS) {
  const playerSpecies = content.species[content.speciesIds[0]];
  const wildSpecies = content.species[content.speciesIds[1]];
  let state = createBattleState({
    party: [createCreatureInstance({ id: 'player-0', species: playerSpecies, level: 4, individualSeed: 1 })],
    inventory: grantItem(grantItem([], 'capture-orb', 3), 'potion', 1),
    wild: createCreatureInstance({ id: 'wild-1', species: wildSpecies, level: 4, individualSeed: 2 }),
    battleRng: createRngState(scenario.seed),
  });
  const events = [];
  for (let turn = 0; turn < 100 && state.phase !== 'ended'; turn++) {
    const command = commandFor(scenario.script, state);
    if (!command) break;
    const result = advanceBattle(state, command, content, DEFAULT_BATTLE_CONFIG);
    state = result.state;
    events.push(...result.events);
  }
  output[scenario.name] = { outcome: state.outcome, turn: state.turn, events };
}
writeFileSync(new URL('../src/rpg/tests/golden/battle-transcripts.json', import.meta.url), JSON.stringify(output, null, 1) + '\n');
console.log('golden transcripts written');
