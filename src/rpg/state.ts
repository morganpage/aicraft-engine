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

import type { SerializableRngState } from '../rng/state';
import type { BattleEvent, BattleState } from './battle-types';
import type { DialogueSession } from './dialogue';
import type { InventoryEntry, InventoryState } from './inventory';
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
