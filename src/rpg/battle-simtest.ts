/**
 * `src/simtest` adapter for battle scenarios: deterministic scenario
 * creation, legal-command enumeration, pure stepping, and outcome mapping —
 * so the generic simulation runner (traces, policies, fuzzing) can drive
 * battles without any platformer-specific types.
 */

import { canonicalize, fnv1a } from '../level/serialize';
import type { SimulationAdapter, SimulationOutcome } from '../simtest/types';
import type { CompiledRpgContent } from './content';
import type { BattleCommand, BattleState } from './battle-types';
import { advanceBattle, createBattleState, getBattleRequest, DEFAULT_BATTLE_CONFIG } from './battle';
import type { CreatureInstance } from './creatures';
import type { InventoryState } from './inventory';
import type { PartyState } from './party';
import { RPG_RULES_VERSION } from './constants';

export const BATTLE_ADAPTER_ID = 'rpg-battle';

/** Everything a battle needs besides content: the two sides and a seed. */
export interface BattleScenario {
  readonly party: PartyState;
  readonly inventory: InventoryState;
  readonly wild: CreatureInstance;
  /** Authoritative battle-stream seed; the runner's seed does not override it. */
  readonly battleSeed: number;
}

/**
 * Build a battle simulation adapter bound to one scenario and content set.
 * The scenario fingerprint covers parties, wild creature, inventory, battle
 * seed, and the content fingerprint, so traces never replay across
 * different worlds or rules.
 */
export function createBattleSimulationAdapter(
  scenario: BattleScenario,
  content: CompiledRpgContent,
): SimulationAdapter<BattleState, BattleCommand> {
  const scenarioFingerprint = `fnv1a-${fnv1a(canonicalize({
    scenario,
    contentFingerprint: content.fingerprint,
    rulesVersion: RPG_RULES_VERSION,
  })).toString(16)}`;

  return {
    id: BATTLE_ADAPTER_ID,
    version: RPG_RULES_VERSION,
    scenarioFingerprint,

    createInitialState() {
      return createBattleState({
        party: scenario.party,
        inventory: scenario.inventory,
        wild: scenario.wild,
        battleRng: { value: scenario.battleSeed >>> 0 },
        rulesVersion: RPG_RULES_VERSION,
      });
    },

    actions(state) {
      return getBattleRequest(state, content).legalCommands;
    },

    step(state, action) {
      return advanceBattle(state, action, content, DEFAULT_BATTLE_CONFIG).state;
    },

    outcome(state): SimulationOutcome {
      if (state.phase !== 'ended') return 'running';
      return state.outcome === 'defeat' ? 'failure' : 'success';
    },

    stateKey(state) {
      return JSON.stringify([
        state.turn,
        state.phase,
        state.activePlayerIndex,
        state.battleRng.value,
        state.playerParty.map((member) => member.currentHp),
        state.wild.currentHp,
      ]);
    },

    summarize(state) {
      return {
        outcome: state.outcome ?? 'running',
        turn: state.turn,
        activeHp: state.playerParty[state.activePlayerIndex]?.currentHp ?? 0,
        wildHp: state.wild.currentHp,
        partySize: state.playerParty.length,
        rngState: state.battleRng.value,
        rewardsApplied: state.rewardsApplied,
      };
    },
  };
}
