/**
 * Battle kernel contracts: state, commands, requests, and typed events.
 *
 * The shape follows the pkmn/engine lesson adopted by the RPG plan: a pure
 * `advanceBattle(state, command)` reducer plus a `getBattleRequest` reader
 * that exposes the exact legal commands. The UI renders `legalCommands`; the
 * reducer revalidates anyway because queued or replayed input can be stale.
 *
 * Presentation (intro text, HP-bar tweens, reward panels) never lives in
 * `BattleState` — renderers consume the typed event stream.
 */

import type { SerializableRngState } from '../rng/state';
import type { CreatureInstance } from './creatures';
import type { InventoryState } from './inventory';
import type { PartyState } from './party';
import type { RpgItemId, RpgMoveId } from './types';

/** Player-issued battle commands. */
export type BattleCommand =
  | { readonly type: 'fight'; readonly moveId: RpgMoveId }
  | { readonly type: 'catch'; readonly itemId: RpgItemId }
  | { readonly type: 'switch'; readonly partyIndex: number }
  | { readonly type: 'flee' };

/** Authoritative simulation phases; everything else is presentation. */
export type BattlePhase = 'command' | 'forced-switch' | 'ended';

export type BattleOutcome = 'victory' | 'defeat' | 'captured' | 'fled';

/** What the UI may offer right now; the exact legal command set. */
export interface BattleRequest {
  readonly phase: BattlePhase;
  readonly legalCommands: readonly BattleCommand[];
}

/**
 * Complete battle state. Entering battle snapshots party and inventory here;
 * this snapshot is the sole battle authority and is committed back exactly
 * once when battle ends. `battleRng` is a serializable stream, so a battle
 * can pause, persist, and resume mid-fight with identical outcomes.
 */
export interface BattleState {
  readonly schemaVersion: 1;
  readonly rulesVersion: number;
  readonly turn: number;
  readonly phase: BattlePhase;
  readonly playerParty: PartyState;
  readonly battleInventory: InventoryState;
  readonly activePlayerIndex: number;
  readonly wild: CreatureInstance;
  readonly battleRng: SerializableRngState;
  readonly failedFleeAttempts: number;
  readonly outcome?: BattleOutcome;
  /** Rewards are computed once and flagged applied so replays cannot repeat them. */
  readonly rewardsApplied: boolean;
}

/**
 * Typed battle events, in emission order. No localized prose: renderers and
 * localization turn these into text and animation cues. Adding a field or
 * variant is a rules-version decision when it can change transcripts.
 */
export type BattleEvent =
  | { readonly type: 'battleStarted'; readonly wildId: string }
  | { readonly type: 'commandRejected'; readonly reason: string }
  | { readonly type: 'moveUsed'; readonly actorId: string; readonly moveId: RpgMoveId; readonly targetId: string }
  | { readonly type: 'moveMissed'; readonly actorId: string; readonly moveId: RpgMoveId }
  | { readonly type: 'criticalHit'; readonly actorId: string; readonly targetId: string }
  | { readonly type: 'effectiveness'; readonly targetId: string; readonly numerator: number; readonly denominator: number }
  | { readonly type: 'damageDealt'; readonly targetId: string; readonly amount: number; readonly hpAfter: number }
  | { readonly type: 'creatureFainted'; readonly creatureId: string }
  | { readonly type: 'creatureSwitched'; readonly creatureId: string }
  | { readonly type: 'captureAttempted'; readonly chanceBasisPoints: number; readonly roll: number }
  | { readonly type: 'creatureCaptured'; readonly creatureId: string }
  | { readonly type: 'fleeAttempted'; readonly chanceBasisPoints: number; readonly roll: number; readonly success: boolean }
  | { readonly type: 'xpGained'; readonly creatureId: string; readonly amount: number }
  | { readonly type: 'levelGained'; readonly creatureId: string; readonly level: number }
  | { readonly type: 'moveLearned'; readonly creatureId: string; readonly moveId: RpgMoveId }
  | { readonly type: 'moveLearnDeferred'; readonly creatureId: string; readonly moveId: RpgMoveId }
  | { readonly type: 'battleEnded'; readonly outcome: BattleOutcome };
