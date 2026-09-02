/**
 * The pure battle kernel: 1v1 wild battles with Fight / Catch / Switch /
 * Flee commands.
 *
 * `getBattleRequest` exposes the exact legal commands at every decision
 * point; `advanceBattle` revalidates every command (queued or replayed
 * input can be stale) — illegal commands are no-ops with a
 * `commandRejected` event, never throws.
 *
 * RNG draw budgets are versioned and fixed per legal command (Fight 8,
 * Catch 4, Switch 3, Flee 4), sampled before effects resolve and consumed
 * even when unneeded. Forced switches and rejected commands consume zero.
 * Adding a roll or changing order is a rules-version change.
 */

import { advanceRng, nextRngInt, type SerializableRngState } from '../rng/state';
import type { CompiledRpgContent } from './content';
import type {
  BattleCommand,
  BattleEvent,
  BattleRequest,
  BattleState,
} from './battle-types';
import {
  computeBattleDamage,
  computeCaptureChanceBasisPoints,
  computeFleeChanceBasisPoints,
  DEFAULT_CRITICAL_CHANCE_BP,
  VARIANCE_MAX_PERCENT,
  VARIANCE_MIN_PERCENT,
} from './battle-math';
import { deriveCreatureStats, deriveMaxHp, type CreatureInstance } from './creatures';
import { appendCreature, aliveCount } from './party';
import { consumeItem, type InventoryState } from './inventory';
import { grantXpAward } from './progression';
import { RPG_MAX_PARTY_SIZE, RPG_RULES_VERSION } from './constants';
import type { IntegerRatio, RpgDiagnostic } from './types';

export interface BattleConfig {
  readonly criticalChanceBasisPoints: number;
}

export const DEFAULT_BATTLE_CONFIG: Readonly<BattleConfig> = Object.freeze({
  criticalChanceBasisPoints: DEFAULT_CRITICAL_CHANCE_BP,
});

/** A fixed attack pack: accuracy, critical, variance — drawn together. */
interface AttackRolls {
  readonly accuracy: number;
  readonly critical: number;
  readonly variance: number;
}

interface DrawPack {
  readonly rng: SerializableRngState;
  readonly enemyMoveIndex: number;
  readonly tieBreak: number;
  readonly playerRolls: AttackRolls;
  readonly wildRolls: AttackRolls;
  readonly capture: number;
  readonly flee: number;
}

function drawAttackPack(rng: SerializableRngState): { readonly rng: SerializableRngState; readonly rolls: AttackRolls } {
  const accuracy = nextRngInt(rng, 0, 9999);
  const critical = nextRngInt(accuracy.state, 0, 9999);
  const variance = nextRngInt(critical.state, VARIANCE_MIN_PERCENT, VARIANCE_MAX_PERCENT);
  return { rng: variance.state, rolls: { accuracy: accuracy.value, critical: critical.value, variance: variance.value } };
}

/**
 * Consume the fixed budget for one command type in the documented order.
 * Every pack is consumed in full even when its values are not needed.
 */
/**
 * Counterattacks after Catch/Switch/Flee draws include no enemy-move roll
 * (their budgets are 4/3/4), so the wild creature uses its first known move
 * deterministically.
 */
function drawPack(
  rng: SerializableRngState,
  command: BattleCommand,
  wildMoveCount: number,
): DrawPack {
  let cursor = rng;
  const takeInt = (min: number, max: number) => {
    const draw = nextRngInt(cursor, min, max);
    cursor = draw.state;
    return draw.value;
  };

  let enemyMoveIndex = 0;
  let tieBreak = 0;
  let capture = 0;
  let flee = 0;
  if (command.type === 'fight') {
    enemyMoveIndex = wildMoveCount > 0 ? takeInt(0, wildMoveCount - 1) : 0;
    const tie = advanceRng(cursor);
    cursor = tie.state;
    tieBreak = tie.value;
  } else if (command.type === 'catch') {
    capture = takeInt(0, 9999);
  } else if (command.type === 'flee') {
    flee = takeInt(0, 9999);
  }

  const playerPack = command.type === 'fight' ? drawAttackPack(cursor) : null;
  cursor = playerPack ? playerPack.rng : cursor;
  const wildPack = drawAttackPack(cursor);
  cursor = wildPack.rng;

  return {
    rng: cursor,
    enemyMoveIndex,
    tieBreak,
    capture,
    flee,
    playerRolls: playerPack?.rolls ?? { accuracy: 0, critical: 0, variance: 100 },
    wildRolls: wildPack.rolls,
  };
}

/** Snapshot party/inventory into a fresh battle state at turn 0. */
export function createBattleState(params: {
  readonly party: readonly CreatureInstance[];
  readonly inventory: InventoryState;
  readonly wild: CreatureInstance;
  readonly battleRng: SerializableRngState;
  readonly rulesVersion?: number;
}): BattleState {
  const active = Math.max(0, params.party.findIndex((member) => member.currentHp > 0));
  return {
    schemaVersion: 1,
    rulesVersion: params.rulesVersion ?? RPG_RULES_VERSION,
    turn: 0,
    phase: 'command',
    playerParty: params.party,
    battleInventory: params.inventory,
    activePlayerIndex: active,
    wild: params.wild,
    battleRng: params.battleRng,
    failedFleeAttempts: 0,
    rewardsApplied: false,
  };
}

function commandsEqual(a: BattleCommand, b: BattleCommand): boolean {
  return JSON.stringify(commandKey(a)) === JSON.stringify(commandKey(b));
}

function commandKey(command: BattleCommand): unknown {
  switch (command.type) {
    case 'fight':
      return { type: 'fight', moveId: command.moveId };
    case 'catch':
      return { type: 'catch', itemId: command.itemId };
    case 'switch':
      return { type: 'switch', partyIndex: command.partyIndex };
    case 'flee':
      return { type: 'flee' };
  }
}

/** The exact legal commands for the current phase; the UI renders only these. */
export function getBattleRequest(
  state: BattleState,
  content: CompiledRpgContent,
): BattleRequest {
  const legal: BattleCommand[] = [];
  if (state.phase === 'ended') return { phase: state.phase, legalCommands: legal };

  if (state.phase === 'forced-switch') {
    state.playerParty.forEach((member, index) => {
      if (member.currentHp > 0 && index !== state.activePlayerIndex) {
        legal.push({ type: 'switch', partyIndex: index });
      }
    });
    return { phase: state.phase, legalCommands: legal };
  }

  const active = state.playerParty[state.activePlayerIndex];
  if (active) {
    for (const moveId of active.moveIds) {
      if (content.moves[moveId]) legal.push({ type: 'fight', moveId });
    }
  }
  if (state.playerParty.length < RPG_MAX_PARTY_SIZE) {
    for (const entry of state.battleInventory) {
      const item = content.items[entry.itemId];
      if (item?.kind === 'capture' && entry.quantity > 0) {
        legal.push({ type: 'catch', itemId: entry.itemId });
      }
    }
  }
  state.playerParty.forEach((member, index) => {
    if (member.currentHp > 0 && index !== state.activePlayerIndex) {
      legal.push({ type: 'switch', partyIndex: index });
    }
  });
  legal.push({ type: 'flee' });
  return { phase: state.phase, legalCommands: legal };
}

interface AttackContext {
  readonly content: CompiledRpgContent;
  readonly config: Readonly<BattleConfig>;
}

interface AttackOutcome {
  readonly party: readonly CreatureInstance[];
  readonly wild: CreatureInstance;
  readonly events: readonly BattleEvent[];
  readonly playerFainted: boolean;
  readonly wildFainted: boolean;
}

function resolveAttack(
  ctx: AttackContext,
  attackerSide: 'player' | 'wild',
  attacker: CreatureInstance,
  defender: CreatureInstance,
  moveId: string,
  rolls: AttackRolls,
  party: readonly CreatureInstance[],
  activeIndex: number,
  wild: CreatureInstance,
): AttackOutcome {
  const events: BattleEvent[] = [];
  const move = ctx.content.moves[moveId];
  const attackerSpecies = ctx.content.species[attacker.speciesId];
  const defenderSpecies = ctx.content.species[defender.speciesId];
  if (!move || !attackerSpecies || !defenderSpecies) {
    return { party, wild, events, playerFainted: false, wildFainted: false };
  }

  const attackerStats = deriveCreatureStats(attackerSpecies.baseStats, attacker.level);
  const defenderStats = deriveCreatureStats(defenderSpecies.baseStats, defender.level);

  if (!(rolls.accuracy < move.accuracyBasisPoints)) {
    events.push({ type: 'moveMissed', actorId: attacker.id, moveId: move.id });
    return { party, wild, events, playerFainted: false, wildFainted: false };
  }

  const effectiveness: IntegerRatio = ctx.content.typeEffectiveness[move.typeId]?.[defenderSpecies.typeId]
    ?? { numerator: 1, denominator: 1 };
  const critical = rolls.critical < ctx.config.criticalChanceBasisPoints;
  const damage = computeBattleDamage({
    movePower: move.power,
    attackerLevel: attacker.level,
    attack: attackerStats.attack,
    defense: defenderStats.defense,
    typeEffectiveness: effectiveness,
    critical,
    variancePercent: rolls.variance,
  });

  const defenderId = defender.id;
  events.push({ type: 'moveUsed', actorId: attacker.id, moveId: move.id, targetId: defenderId });
  if (critical) {
    events.push({ type: 'criticalHit', actorId: attacker.id, targetId: defenderId });
  }
  events.push({
    type: 'effectiveness',
    targetId: defenderId,
    numerator: effectiveness.numerator,
    denominator: effectiveness.denominator,
  });

  const hpAfter = Math.max(0, defender.currentHp - damage);
  events.push({ type: 'damageDealt', targetId: defenderId, amount: damage, hpAfter });

  let nextParty = party;
  let nextWild = wild;
  let playerFainted = false;
  let wildFainted = false;
  if (attackerSide === 'player') {
    const updated: CreatureInstance = { ...defender, currentHp: hpAfter };
    nextWild = updated;
    if (hpAfter === 0) {
      wildFainted = true;
      events.push({ type: 'creatureFainted', creatureId: defenderId });
    }
  } else {
    const updated: CreatureInstance = { ...defender, currentHp: hpAfter };
    nextParty = party.map((member, index) => (index === activeIndex ? updated : member));
    if (hpAfter === 0) {
      playerFainted = true;
      events.push({ type: 'creatureFainted', creatureId: defenderId });
    }
  }
  return { party: nextParty, wild: nextWild, events, playerFainted, wildFainted };
}

interface BattleTurnResult {
  readonly state: BattleState;
  readonly events: readonly BattleEvent[];
  readonly diagnostics: readonly RpgDiagnostic[];
}

function applyVictoryRewards(
  state: BattleState,
  content: CompiledRpgContent,
  wild: CreatureInstance,
  events: BattleEvent[],
): BattleState {
  const active = state.playerParty[state.activePlayerIndex];
  const activeSpecies = active ? content.species[active.speciesId] : undefined;
  const wildSpecies = content.species[wild.speciesId];
  if (!active || !activeSpecies || !wildSpecies) return state;

  const award = Math.max(1, Math.floor((wildSpecies.expYield * wild.level) / active.level));
  const progression = grantXpAward(active, activeSpecies, award);
  events.push({ type: 'xpGained', creatureId: active.id, amount: award });
  for (const event of progression.events) {
    if (event.type !== 'xpGained') events.push(event);
  }
  return {
    ...state,
    playerParty: state.playerParty.map((member, index) =>
      index === state.activePlayerIndex ? progression.creature : member,
    ),
    rewardsApplied: true,
  };
}

function endBattle(
  state: BattleState,
  outcome: 'victory' | 'defeat' | 'captured' | 'fled',
  events: BattleEvent[],
): BattleState {
  events.push({ type: 'battleEnded', outcome });
  return { ...state, phase: 'ended', outcome };
}

function afterWildAttackFaints(
  state: BattleState,
  events: BattleEvent[],
): BattleState {
  const active = state.playerParty[state.activePlayerIndex];
  if (active && active.currentHp > 0) return state;
  if (aliveCount(state.playerParty) > 0) {
    return { ...state, phase: 'forced-switch' };
  }
  return endBattle(state, 'defeat', events);
}

/**
 * Advance the battle by one command. Pure: returns a fresh state, never
 * mutates the input, never throws. Illegal or stale commands are
 * `commandRejected` no-ops.
 */
export function advanceBattle(
  state: BattleState,
  command: BattleCommand,
  content: CompiledRpgContent,
  config: Readonly<BattleConfig> = DEFAULT_BATTLE_CONFIG,
): BattleTurnResult {
  const request = getBattleRequest(state, content);
  if (!request.legalCommands.some((legal) => commandsEqual(legal, command))) {
    return {
      state,
      events: [{ type: 'commandRejected', reason: `illegal-${command.type}-in-phase-${state.phase}` }],
      diagnostics: [{
        code: 'rpg.battle.commandRejected',
        severity: 'warning',
        path: `battle.turn[${state.turn}]`,
        message: `Command '${JSON.stringify(commandKey(command))}' is not legal in phase '${state.phase}'.`,
      }],
    };
  }

  const ctx: AttackContext = { content, config };
  const events: BattleEvent[] = [];

  // Forced switches consume zero draws and no turn — handled before any
  // draw budget is touched.
  if (state.phase === 'forced-switch' && command.type === 'switch') {
    const next: BattleState = {
      ...state,
      activePlayerIndex: command.partyIndex,
      phase: 'command',
    };
    events.push({ type: 'creatureSwitched', creatureId: next.playerParty[command.partyIndex].id });
    return { state: next, events, diagnostics: [] };
  }

  const pack = drawPack(state.battleRng, command, state.wild.moveIds.length);
  let next: BattleState = { ...state, battleRng: pack.rng };
  let turnConsumed = true;

  if (command.type === 'fight') {
    const player = next.playerParty[next.activePlayerIndex];
    const playerSpecies = content.species[player.speciesId];
    const wildSpecies = content.species[next.wild.speciesId];
    const playerMove = content.moves[command.moveId];
    const wildMoveId = next.wild.moveIds[pack.enemyMoveIndex] ?? next.wild.moveIds[0];
    const wildMove = content.moves[wildMoveId];

    let playerFirst = true;
    if (playerMove && wildMove && playerSpecies && wildSpecies) {
      if (playerMove.priority !== wildMove.priority) {
        playerFirst = playerMove.priority > wildMove.priority;
      } else {
        const playerSpeed = deriveCreatureStats(playerSpecies.baseStats, player.level).speed;
        const wildSpeed = deriveCreatureStats(wildSpecies.baseStats, next.wild.level).speed;
        if (playerSpeed !== wildSpeed) {
          playerFirst = playerSpeed > wildSpeed;
        } else {
          playerFirst = pack.tieBreak < 0.5;
        }
      }
    }

    let party = next.playerParty;
    let wild = next.wild;
    let wildFainted = false;

    const runPlayerAction = () => {
      const outcome = resolveAttack(ctx, 'player', party[next.activePlayerIndex], wild, command.moveId, pack.playerRolls, party, next.activePlayerIndex, wild);
      party = outcome.party;
      wild = outcome.wild;
      events.push(...outcome.events);
      wildFainted = outcome.wildFainted;
    };
    const runWildAction = () => {
      if (wildFainted) return;
      const outcome = resolveAttack(ctx, 'wild', wild, party[next.activePlayerIndex], wildMoveId, pack.wildRolls, party, next.activePlayerIndex, wild);
      party = outcome.party;
      wild = outcome.wild;
      events.push(...outcome.events);
    };

    if (playerFirst) {
      runPlayerAction();
      runWildAction();
    } else {
      const outcome = resolveAttack(ctx, 'wild', wild, party[next.activePlayerIndex], wildMoveId, pack.wildRolls, party, next.activePlayerIndex, wild);
      party = outcome.party;
      wild = outcome.wild;
      events.push(...outcome.events);
      if (party[next.activePlayerIndex].currentHp > 0) {
        runPlayerAction();
      }
    }

    next = { ...next, playerParty: party, wild };

    if (wildFainted) {
      next = applyVictoryRewards(next, content, next.wild, events);
      next = endBattle(next, 'victory', events);
    } else {
      next = afterWildAttackFaints(next, events);
    }
  } else if (command.type === 'catch') {
    const item = content.items[command.itemId];
    const wildSpecies = content.species[next.wild.speciesId];
    const bonus = item?.catchBonusBasisPoints ?? 0;
    next = { ...next, battleInventory: consumeItem(next.battleInventory, command.itemId, 1) };
    if (wildSpecies) {
      const maxHp = deriveMaxHp(wildSpecies.baseStats.hp, next.wild.level);
      const chance = computeCaptureChanceBasisPoints({
        speciesCatchBasisPoints: wildSpecies.catchBasisPoints,
        itemBonusBasisPoints: bonus,
        maxHp,
        currentHp: next.wild.currentHp,
      });
      events.push({ type: 'captureAttempted', chanceBasisPoints: chance, roll: pack.capture });
      if (pack.capture < chance) {
        events.push({ type: 'creatureCaptured', creatureId: next.wild.id });
        next = { ...next, playerParty: appendCreature(next.playerParty, next.wild) };
        next = applyVictoryRewards(next, content, next.wild, events);
        next = endBattle(next, 'captured', events);
      } else {
        const outcome = resolveAttack(ctx, 'wild', next.wild, next.playerParty[next.activePlayerIndex], next.wild.moveIds[pack.enemyMoveIndex] ?? next.wild.moveIds[0], pack.wildRolls, next.playerParty, next.activePlayerIndex, next.wild);
        next = { ...next, playerParty: outcome.party, wild: outcome.wild };
        events.push(...outcome.events);
        next = afterWildAttackFaints(next, events);
      }
    }
  } else if (command.type === 'switch') {
    events.push({ type: 'creatureSwitched', creatureId: next.playerParty[command.partyIndex].id });
    next = { ...next, activePlayerIndex: command.partyIndex };
    const outcome = resolveAttack(ctx, 'wild', next.wild, next.playerParty[next.activePlayerIndex], next.wild.moveIds[pack.enemyMoveIndex] ?? next.wild.moveIds[0], pack.wildRolls, next.playerParty, next.activePlayerIndex, next.wild);
    next = { ...next, playerParty: outcome.party, wild: outcome.wild };
    events.push(...outcome.events);
    next = afterWildAttackFaints(next, events);
  } else if (command.type === 'flee') {
    const playerSpecies = content.species[next.playerParty[next.activePlayerIndex].speciesId];
    const wildSpecies = content.species[next.wild.speciesId];
    let chance = 5000;
    if (playerSpecies && wildSpecies) {
      chance = computeFleeChanceBasisPoints({
        playerSpeed: deriveCreatureStats(playerSpecies.baseStats, next.playerParty[next.activePlayerIndex].level).speed,
        wildSpeed: deriveCreatureStats(wildSpecies.baseStats, next.wild.level).speed,
        failedFleeAttempts: next.failedFleeAttempts,
      });
    }
    const success = pack.flee < chance;
    events.push({ type: 'fleeAttempted', chanceBasisPoints: chance, roll: pack.flee, success });
    if (success) {
      next = endBattle(next, 'fled', events);
    } else {
      next = { ...next, failedFleeAttempts: next.failedFleeAttempts + 1 };
      const outcome = resolveAttack(ctx, 'wild', next.wild, next.playerParty[next.activePlayerIndex], next.wild.moveIds[pack.enemyMoveIndex] ?? next.wild.moveIds[0], pack.wildRolls, next.playerParty, next.activePlayerIndex, next.wild);
      next = { ...next, playerParty: outcome.party, wild: outcome.wild };
      events.push(...outcome.events);
      next = afterWildAttackFaints(next, events);
    }
  }

  if (turnConsumed) next = { ...next, turn: next.turn + 1 };
  return { state: next, events, diagnostics: [] };
}

