/**
 * Top-level RPG session state and the controller facade.
 *
 * The facade owns every cross-system transition. Leaf reducers (movement,
 * dialogue, battle) never import renderers and never touch storage, audio,
 * DOM, or device adapters. `createRpgController` closes over immutable
 * compiled content and config only — never mutable simulation state — so
 * multiple sessions can share one controller safely.
 *
 * Canonical overworld ownership: while `battle` or `dialogue` is active, the
 * activity variant's `returnTo` holds the overworld to return to; while
 * `transition` is active, `returnTo` is the fully constructed **destination**
 * overworld and `MapTransitionState` carries only source/destination/timing.
 * The outer `RpgState.party`/`inventory` are deliberately stale during battle
 * — the battle snapshot is the sole authority — and readers
 * (`getEffectiveParty`/`getEffectiveInventory`, Milestone 3) plus the
 * canonical trace projection account for it.
 */

import { createRngState, type SerializableRngState } from '../rng/state';
import { deriveSeed } from '../rng/derive-seed';
import type { BattleEvent, BattleState } from './battle-types';
import type { DialogueSession } from './dialogue';
import { grantItem, consumeItem, type InventoryEntry, type InventoryState } from './inventory';
import type { PartyState } from './party';
import type {
  RpgAnchorId,
  RpgDiagnostic,
  RpgDirection,
  RpgDialogueId,
  RpgInput,
  RpgLocation,
  RpgMapId,
  RpgSpeciesId,
  RpgTileRef,
} from './types';

/**
 * The discriminated activity union. Impossible combinations (dialogue during
 * battle, a half-finished warp without a destination) cannot be represented.
 */
export type RpgActivity =
  | { readonly kind: 'overworld'; readonly overworld: OverworldState }
  | { readonly kind: 'dialogue'; readonly dialogue: DialogueActivityState; readonly returnTo: OverworldState }
  | { readonly kind: 'battle'; readonly battle: BattleState; readonly returnTo: OverworldState }
  | { readonly kind: 'transition'; readonly transition: MapTransitionState; readonly returnTo: OverworldState };

/** Overworld session: player location plus any step in progress. */
export interface OverworldState {
  readonly location: RpgLocation;
  /** Active grid step, or `null` when idle. Arrival commits `location`. */
  readonly step: GridStepState | null;
}

/** A tick-counted step between two adjacent tiles. */
export interface GridStepState {
  readonly from: RpgTileRef;
  readonly to: RpgTileRef;
  readonly facing: RpgDirection;
  readonly startedTick: number;
  readonly durationTicks: number;
}

/**
 * Deterministic map-transition progress. `returnTo` (on the activity variant)
 * already holds the constructed destination overworld; this record carries
 * only the timing and addresses needed for transition presentation and
 * completion checks. Completion swaps directly to `returnTo`.
 */
export interface MapTransitionState {
  readonly source: RpgLocation;
  readonly destination: RpgLocation;
  readonly startedTick: number;
  readonly durationTicks: number;
}

/** Dialogue session as held by the facade during a dialogue activity. */
export interface DialogueActivityState {
  readonly dialogueId: RpgDialogueId;
  readonly session: DialogueSession;
}

/** Complete authoritative game state for one session. */
export interface RpgState {
  readonly schemaVersion: 1;
  readonly rulesVersion: number;
  readonly tick: number;
  readonly rootSeed: number;
  readonly contentFingerprint: string;
  readonly activity: RpgActivity;
  readonly party: PartyState;
  readonly inventory: InventoryState;
  readonly flags: Readonly<Record<string, boolean>>;
  readonly worldRng: SerializableRngState;
  /** Monotonic count of eligible grass arrivals; addresses encounter seeds. */
  readonly encounterIndex: number;
  readonly lastHealAnchor: RpgLocation;
}

/**
 * Facade-level typed events for one step. Leaf events (battle, and from
 * Milestone 2 dialogue) join the union directly so transcripts stay flat.
 * Growth is additive and non-breaking.
 */
export type RpgEvent =
  | { readonly type: 'stepCompleted'; readonly mapId: RpgMapId; readonly tileX: number; readonly tileY: number }
  | { readonly type: 'warpTriggered'; readonly from: RpgLocation; readonly toMapId: RpgMapId; readonly toAnchorId: RpgAnchorId }
  | { readonly type: 'healApplied'; readonly anchor: RpgLocation }
  | { readonly type: 'healAnchorUpdated'; readonly anchor: RpgLocation }
  | { readonly type: 'encounterTriggered'; readonly speciesId: RpgSpeciesId; readonly level: number; readonly encounterIndex: number }
  | { readonly type: 'transitionStarted'; readonly source: RpgLocation; readonly destination: RpgLocation }
  | { readonly type: 'transitionCompleted'; readonly location: RpgLocation }
  | { readonly type: 'dialogueStarted'; readonly dialogueId: RpgDialogueId }
  | { readonly type: 'dialogueEnded'; readonly dialogueId: RpgDialogueId }
  | BattleEvent;

/** One fixed-tick step result: fresh state, typed events, diagnostics. */
export interface RpgStepResult {
  readonly state: RpgState;
  readonly events: readonly RpgEvent[];
  readonly diagnostics: readonly RpgDiagnostic[];
}

/**
 * Fixed-tick simulation configuration. `tickDuration` is seconds per tick
 * and matches the engine `DEFAULT_FIXED_DT`; the controller reports a
 * diagnostic when `step` receives a non-finite, negative, or mismatched
 * `fixedDt`. All durations are integer ticks, never accumulated wall time.
 */
export interface RpgConfig {
  readonly tickDuration: number;
  readonly stepDurationTicks: number;
  readonly transitionDurationTicks: number;
}

/** New-game starting conditions; each field is overridable via `Partial`. */
export interface RpgStart {
  readonly spawnMapId: RpgMapId;
  readonly spawnAnchorId: RpgAnchorId;
  readonly startingParty: readonly {
    readonly speciesId: RpgSpeciesId;
    readonly level: number;
  }[];
  readonly startingInventory: readonly InventoryEntry[];
}

/**
 * The RPG facade. `step` runs exactly one fixed simulation tick and is pure:
 * it returns a fresh state and never mutates its input.
 */
export interface RpgController {
  step(state: RpgState, input: RpgInput, fixedDt: number): RpgStepResult;
}

// ---------------------------------------------------------------------------
// Facade implementation
// ---------------------------------------------------------------------------

import type { CompiledRpgContent } from './content';
import { advanceGridMovement, createOverworldAtAnchor } from './movement';
import { resolveInteraction } from './interaction';
import { advanceDialogue, getDialogueRequest, moveDialogueCursor, startDialogue, type DialogueContext, type DialogueEffect } from './dialogue';
import { createBattleState, advanceBattle, DEFAULT_BATTLE_CONFIG } from './battle';
import { deriveEncounterSeeds, rollEncounter } from './encounters';
import { createCreatureInstance, type CreatureInstance, type SpeciesDefinition } from './creatures';
import { healPartyFully } from './party';
import { DEFAULT_RPG_CONFIG, RPG_RULES_VERSION } from './constants';
import type { RpgMapDefinition } from './map';
import type { RpgEncounterTableId } from './types';

/**
 * Build a fresh session state over compiled content. The starting party is
 * instantiated from `start.startingParty` with deterministic instance ids
 * (`starter-0`, `starter-1`, …) and address-derived individual seeds; the
 * last heal anchor starts at the spawn. Never throws — an unknown spawn
 * falls back to the map's first anchor with a diagnostic-free safe default.
 */
export function createRpgState(
  content: CompiledRpgContent,
  seed: number,
  start?: Partial<RpgStart>,
): RpgState {
  const spawnMapId = start?.spawnMapId ?? content.mapIds[0] ?? '';
  const map = content.maps[spawnMapId];
  const anchorId = start?.spawnAnchorId ?? map?.spawns[0]?.id ?? '';
  const anchor = map?.spawns.find((s) => s.id === anchorId) ?? map?.spawns[0];
  const location = anchor
    ? { mapId: spawnMapId, tileX: anchor.tile.tileX, tileY: anchor.tile.tileY, facing: anchor.facing }
    : { mapId: spawnMapId, tileX: 1, tileY: 1, facing: 'down' as const };

  let party: PartyState = [];
  (start?.startingParty ?? []).forEach((entry, index) => {
    const species = content.species[entry.speciesId];
    if (!species) return;
    party = [...party, createCreatureInstance({
      id: `starter-${index}`,
      species,
      level: entry.level,
      individualSeed: deriveSeed(seed, 'starter', index),
    })];
  });
  if (party.length === 0) {
    const firstSpecies = content.species[content.speciesIds[0] ?? ''];
    if (firstSpecies) {
      party = [createCreatureInstance({
        id: 'starter-0',
        species: firstSpecies,
        level: 4,
        individualSeed: deriveSeed(seed, 'starter', 0),
      })];
    }
  }

  let inventory: InventoryState = [];
  for (const entry of start?.startingInventory ?? []) {
    inventory = grantItem(inventory, entry.itemId, entry.quantity);
  }

  return {
    schemaVersion: 1,
    rulesVersion: RPG_RULES_VERSION,
    tick: 0,
    rootSeed: seed >>> 0,
    contentFingerprint: content.fingerprint,
    activity: { kind: 'overworld', overworld: { location, step: null } },
    party,
    inventory,
    flags: {},
    worldRng: createRngState(seed),
    encounterIndex: 0,
    lastHealAnchor: location,
  };
}

function applyDialogueEffects(
  state: RpgState,
  effects: readonly DialogueEffect[],
  content: CompiledRpgContent,
): { party: PartyState; inventory: InventoryState; flags: Readonly<Record<string, boolean>> } {
  let party = state.party;
  let inventory = state.inventory;
  const flags = { ...state.flags };
  for (const effect of effects) {
    switch (effect.kind) {
      case 'setFlag':
        flags[effect.flag] = effect.value;
        break;
      case 'giveItem':
        inventory = grantItem(inventory, effect.itemId, effect.quantity);
        break;
      case 'takeItem':
        inventory = consumeItem(inventory, effect.itemId, effect.quantity);
        break;
      case 'healParty':
        party = healPartyFully(party, content.species);
        break;
      default:
        break;
    }
  }
  return { party, inventory, flags };
}

function enterBattleFrom(
  state: RpgState,
  returnTo: OverworldState,
  wild: CreatureInstance,
  battleRng: SerializableRngState,
): RpgActivity {
  return {
    kind: 'battle',
    battle: createBattleState({
      party: state.party,
      inventory: state.inventory,
      wild,
      battleRng,
      rulesVersion: state.rulesVersion,
    }),
    returnTo,
  };
}

function beginWildBattle(
  state: RpgState,
  returnTo: OverworldState,
  species: SpeciesDefinition,
  level: number,
): { activity: RpgActivity; encounterIndex: number; wild: CreatureInstance } {
  const encounterIndex = state.encounterIndex + 1;
  const seeds = deriveEncounterSeeds(state.rootSeed, encounterIndex);
  const wild = createCreatureInstance({
    id: `wild-${encounterIndex}`,
    species,
    level,
    individualSeed: seeds.creatureSeed,
  });
  return {
    activity: enterBattleFrom(state, returnTo, wild, createRngState(seeds.battleSeed)),
    encounterIndex,
    wild,
  };
}

function overworldLocationOf(overworld: OverworldState): RpgLocation {
  return overworld.location;
}

function speciesOf(content: CompiledRpgContent, speciesId: string): SpeciesDefinition | undefined {
  return content.species[speciesId];
}

/**
 * Create the RPG facade controller over immutable compiled content and
 * configuration. The controller owns no mutable simulation state — many
 * sessions can share one controller safely. `step` is pure.
 */
export function createRpgController(
  content: CompiledRpgContent,
  config?: Partial<RpgConfig>,
): RpgController {
  const resolved: RpgConfig = { ...DEFAULT_RPG_CONFIG, ...config };

  return {
    step(state: RpgState, input: RpgInput, fixedDt: number): RpgStepResult {
      const diagnostics: RpgDiagnostic[] = [];
      const events: RpgEvent[] = [];
      if (
        !Number.isFinite(fixedDt) ||
        fixedDt <= 0 ||
        Math.abs(fixedDt - resolved.tickDuration) > 1e-9
      ) {
        diagnostics.push({
          code: 'rpg.step.fixedDtMismatch',
          severity: 'warning',
          path: 'fixedDt',
          message: `fixedDt ${String(fixedDt)} does not match configured tick duration ${resolved.tickDuration}.`,
        });
      }

      const tick = state.tick + 1;
      let activity: RpgActivity = state.activity;
      let party = state.party;
      let inventory = state.inventory;
      const flags = { ...state.flags };
      let worldRng = state.worldRng;
      let encounterIndex = state.encounterIndex;
      let lastHealAnchor = state.lastHealAnchor;

      if (activity.kind === 'overworld') {
        const map: RpgMapDefinition | undefined = content.maps[activity.overworld.location.mapId];
        if (!map) {
          diagnostics.push({
            code: 'rpg.step.mapMissing',
            severity: 'error',
            path: `maps[${activity.overworld.location.mapId}]`,
            message: `Current map '${activity.overworld.location.mapId}' is not in compiled content.`,
          });
          return { state: { ...state, tick }, events, diagnostics };
        }

        const movement = advanceGridMovement(activity.overworld, state.tick, input, map, resolved);
        let overworld = movement.overworld;
        diagnostics.push(...movement.diagnostics);

        if (movement.arrival) {
          const location = overworldLocationOf(overworld);
          events.push({
            type: 'stepCompleted',
            mapId: map.id,
            tileX: location.tileX,
            tileY: location.tileY,
          });
          const arrival = movement.arrival;
          if (arrival.kind === 'warp') {
            const warp = map.warps.find((w) => w.id === arrival.warpId);
            const targetMap = warp ? content.maps[warp.targetMapId] : undefined;
            const anchor = targetMap?.spawns.find((s) => s.id === warp?.targetAnchorId);
            if (targetMap && anchor && warp) {
              const destinationOverworld = createOverworldAtAnchor(targetMap, anchor.id);
              if (destinationOverworld) {
                events.push({
                  type: 'warpTriggered',
                  from: location,
                  toMapId: warp.targetMapId,
                  toAnchorId: warp.targetAnchorId,
                });
                const destination = destinationOverworld.location;
                activity = {
                  kind: 'transition',
                  transition: {
                    source: location,
                    destination,
                    startedTick: tick,
                    durationTicks: resolved.transitionDurationTicks,
                  },
                  returnTo: destinationOverworld,
                };
                events.push({ type: 'transitionStarted', source: location, destination });
                return { state: { ...state, tick, activity }, events, diagnostics };
              }
            }
            diagnostics.push({
              code: 'rpg.step.warpUnresolvable',
              severity: 'error',
              path: `maps[${map.id}].warps[${arrival.warpId}]`,
              message: `Warp '${arrival.warpId}' does not resolve to a compiled map anchor.`,
            });
          } else if (arrival.kind === 'heal') {
            party = healPartyFully(party, content.species);
            lastHealAnchor = location;
            events.push({ type: 'healApplied', anchor: location });
            events.push({ type: 'healAnchorUpdated', anchor: location });
          } else if (arrival.kind === 'encounterZone') {
            const table = content.encounters[arrival.encounterTableId as RpgEncounterTableId];
            if (table) {
              const roll = rollEncounter(worldRng, table);
              worldRng = roll.worldRng;
              if (roll.encounter) {
                const species = speciesOf(content, roll.encounter.speciesId);
                if (species) {
                  const begun = beginWildBattle(
                    { ...state, party, inventory, flags },
                    overworld,
                    species,
                    roll.encounter.level,
                  );
                  encounterIndex = begun.encounterIndex;
                  events.push({
                    type: 'encounterTriggered',
                    speciesId: roll.encounter.speciesId,
                    level: roll.encounter.level,
                    encounterIndex,
                  });
                  events.push({ type: 'battleStarted', wildId: begun.wild.id });
                  activity = begun.activity;
                  return {
                    state: { ...state, tick, activity, worldRng, encounterIndex },
                    events,
                    diagnostics,
                  };
                }
              }
            }
          }
        } else if (input.confirm) {
          const resolution = resolveInteraction(map, overworld.location);
          if (resolution.kind === 'npc') {
            const dialogue = content.dialogues[resolution.dialogueId];
            if (dialogue) {
              events.push({ type: 'dialogueStarted', dialogueId: dialogue.id });
              activity = {
                kind: 'dialogue',
                dialogue: {
                  dialogueId: dialogue.id,
                  session: startDialogue(dialogue),
                },
                returnTo: overworld,
              };
            }
          }
        }

        activity = activity.kind === 'overworld' ? { kind: 'overworld', overworld } : activity;
      } else if (activity.kind === 'dialogue') {
        const dialogue = content.dialogues[activity.dialogue.dialogueId];
        if (!dialogue) {
          diagnostics.push({
            code: 'rpg.step.dialogueMissing',
            severity: 'error',
            path: `dialogues[${activity.dialogue.dialogueId}]`,
            message: `Active dialogue '${activity.dialogue.dialogueId}' is not in compiled content.`,
          });
          activity = { kind: 'overworld', overworld: activity.returnTo };
        } else {
          const context: DialogueContext = {
            flags,
            inventory,
            partySize: party.length,
            maxPartySize: 6,
          };
          let session = activity.dialogue.session;
          if (input.direction === 'up') session = moveDialogueCursor(dialogue, session, -1, context);
          if (input.direction === 'down') session = moveDialogueCursor(dialogue, session, 1, context);

          if (input.confirm) {
            const request = getDialogueRequest(dialogue, session, context);
            const command = request && request.choices.length > 0
              ? { type: 'choose' as const, choiceId: request.choices[request.cursor].id }
              : { type: 'advance' as const };
            const advanced = advanceDialogue(dialogue, session, command, context);
            diagnostics.push(...advanced.diagnostics);
            const applied = applyDialogueEffects(
              { ...state, party, inventory, flags },
              advanced.effects.filter((effect) => effect.kind !== 'startBattle' && effect.kind !== 'warp' && effect.kind !== 'endDialogue'),
              content,
            );
            party = applied.party;
            inventory = applied.inventory;
            Object.assign(flags, applied.flags);

            const terminal = advanced.effects.find(
              (effect) => effect.kind === 'startBattle' || effect.kind === 'warp' || effect.kind === 'endDialogue',
            );
            const dialogueContinues = !terminal && advanced.session !== null;
            if (!dialogueContinues) {
              events.push({ type: 'dialogueEnded', dialogueId: dialogue.id });
            }
            if (terminal?.kind === 'startBattle') {
              const species = speciesOf(content, terminal.speciesId);
              if (species) {
                const begun = beginWildBattle(
                  { ...state, party, inventory, flags, encounterIndex },
                  activity.returnTo,
                  species,
                  terminal.level,
                );
                encounterIndex = begun.encounterIndex;
                events.push({
                  type: 'encounterTriggered',
                  speciesId: terminal.speciesId,
                  level: terminal.level,
                  encounterIndex,
                });
                events.push({ type: 'battleStarted', wildId: begun.wild.id });
                activity = begun.activity;
              } else {
                activity = { kind: 'overworld', overworld: activity.returnTo };
              }
            } else if (terminal?.kind === 'warp') {
              const targetMap = content.maps[terminal.mapId];
              const anchor = targetMap?.spawns.find((s) => s.id === terminal.anchorId);
              const destinationOverworld = targetMap && anchor
                ? createOverworldAtAnchor(targetMap, anchor.id)
                : null;
              if (destinationOverworld) {
                events.push({
                  type: 'warpTriggered',
                  from: activity.returnTo.location,
                  toMapId: terminal.mapId,
                  toAnchorId: terminal.anchorId,
                });
                activity = {
                  kind: 'transition',
                  transition: {
                    source: activity.returnTo.location,
                    destination: destinationOverworld.location,
                    startedTick: tick,
                    durationTicks: resolved.transitionDurationTicks,
                  },
                  returnTo: destinationOverworld,
                };
                events.push({
                  type: 'transitionStarted',
                  source: activity.transition.source,
                  destination: activity.transition.destination,
                });
              } else {
                activity = { kind: 'overworld', overworld: activity.returnTo };
              }
            } else if (dialogueContinues && advanced.session) {
              activity = {
                kind: 'dialogue',
                dialogue: { dialogueId: dialogue.id, session: advanced.session },
                returnTo: activity.returnTo,
              };
            } else {
              activity = { kind: 'overworld', overworld: activity.returnTo };
            }
          } else {
            activity = {
              kind: 'dialogue',
              dialogue: { dialogueId: dialogue.id, session },
              returnTo: activity.returnTo,
            };
          }
        }
      } else if (activity.kind === 'battle') {
        if (input.battleCommand && activity.battle.phase !== 'ended') {
          const result = advanceBattle(activity.battle, input.battleCommand, content, DEFAULT_BATTLE_CONFIG);
          for (const event of result.events) events.push(event);
          diagnostics.push(...result.diagnostics);
          if (result.state.phase === 'ended') {
            party = result.state.playerParty;
            inventory = result.state.battleInventory;
            if (result.state.outcome === 'defeat') {
              party = healPartyFully(party, content.species);
              const healMap = content.maps[lastHealAnchor.mapId];
              const recovered = healMap
                ? {
                    kind: 'overworld' as const,
                    overworld: {
                      location: lastHealAnchor,
                      step: null,
                    },
                  }
                : { kind: 'overworld' as const, overworld: activity.returnTo };
              events.push({ type: 'healApplied', anchor: lastHealAnchor });
              activity = recovered;
            } else {
              activity = { kind: 'overworld', overworld: activity.returnTo };
            }
          } else {
            activity = { kind: 'battle', battle: result.state, returnTo: activity.returnTo };
          }
        }
      } else if (activity.kind === 'transition') {
        if (tick - activity.transition.startedTick >= activity.transition.durationTicks) {
          events.push({ type: 'transitionCompleted', location: activity.returnTo.location });
          activity = { kind: 'overworld', overworld: activity.returnTo };
        }
      }

      return {
        state: { ...state, tick, activity, party, inventory, flags, worldRng, encounterIndex, lastHealAnchor },
        events,
        diagnostics,
      };
    },
  };
}

/** The authoritative party: the battle snapshot during battle, else the outer copy. */
export function getEffectiveParty(state: RpgState): PartyState {
  return state.activity.kind === 'battle' ? state.activity.battle.playerParty : state.party;
}

/** The authoritative inventory: the battle snapshot during battle, else the outer copy. */
export function getEffectiveInventory(state: RpgState): InventoryState {
  return state.activity.kind === 'battle' ? state.activity.battle.battleInventory : state.inventory;
}

/** Whether the session sits in a stable, idle overworld state (save-eligible). */
export function isSaveEligible(state: RpgState): boolean {
  return state.activity.kind === 'overworld' && state.activity.overworld.step === null;
}

