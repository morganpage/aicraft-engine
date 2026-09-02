# API Proposal: RPG Kernel (`src/rpg/`)

> Module: `src/rpg/`. Builds on: `RPG_STARTER_PLAN.md` (the implementation-ready
> build brief and its locked vertical-slice decisions), the engine audit in that
> plan, and reference research on `pkmn/engine`, Pokémon Showdown, Tuxemon, and
> two Phaser monster-tamer repositories.
> Status: DRAFT — companion decision record: `rpg-kernel-decision.md`.

---

## Problem Statement

The engine ships a deterministic platformer kernel, but nothing for top-down,
tile-snapped, turn-based gameplay. The RPG starter video requires a complete
explore → talk → encounter → fight → catch → level → heal → save → reload loop
built **as data on ready primitives** in a 20-minute clean-room assembly — which
means the engine must own movement, dialogue, encounters, battle, progression,
and persistence as documented, pure, tree-shakeable APIs instead of each
consumer reinventing them under time pressure.

The hard part is not any one system; it is the **composition**. Four activities
(overworld, dialogue, battle, transition) share party, inventory, flags, and RNG
streams, and the composition rules are where determinism dies in typical
implementations: HP mutated from inside animation callbacks, RNG cursors hidden
in closures that cannot survive a save, battle state cast into another genre's
replay types. This proposal is about the facade shape that keeps every one of
those failure modes structurally impossible.

The plan locks the product decisions (four-direction tile-snapped movement,
1v1 wild battles, Fight/Catch/Switch/Flee, four original types, zero assets).
This document proposes the **public API shape** only.

---

## Approach A: Mode-Enum State Machine (extend `src/game-state` pattern)

**Source pattern:** `src/game-state/` — a `mode` string plus per-mode optional
sub-state fields, with a legal-transition adjacency table. Familiar from the
platformer; the smallest conceptual leap.

**Core idea:** one flat `RpgState` with `mode: 'overworld' | 'dialogue' | 'battle' | 'transition'`
and nullable subsystem states (`overworld?: OverworldState`, `battle?: BattleState`,
…). The reducer switches on `mode`; `reduceGameState`-style adjacency guards
transitions.

### Signature sketch

```ts
interface RpgStateFlat {
  readonly mode: RpgMode;
  readonly overworld?: OverworldState;     // undefined unless mode === 'overworld'
  readonly dialogue?: DialogueActivityState;
  readonly battle?: BattleState;
  readonly transition?: MapTransitionState;
  readonly party: PartyState;
  readonly inventory: InventoryState;
  // …tick, flags, rng, heal anchor
}
```

**Trade-offs.** Smallest diff from existing engine idioms; one state object to
serialize. But the type system permits every impossible combination —
`mode: 'overworld'` with a non-null `battle`, dialogue and battle
simultaneously present — so every reducer needs defensive narrowing and every
test suite needs invariant tests for states that should never exist. The plan's
audit already rejects forcing RPG modes through `src/game-state`'s closed
platformer union; this approach recreates that shape under a new name. Return-to
ownership after battle/dialogue becomes a convention (`overworld` is "kept
around"), not a typed guarantee.

---

## Approach B: Activity-Union Facade Reducer (recommended)

**Source pattern:** the platformer kernel's `content + state + command → pure
reducer → (next state, typed events)` core, plus Showdown's explicit
choice-request protocol and `pkmn/engine`'s serializable-PRNG/input-log
discipline.

**Core idea:** `RpgState.activity` is a **discriminated union** — each variant
carries exactly the sub-state it needs plus the `returnTo` overworld where
re-entry applies. A facade (`RpgController.step`) runs one fixed tick and owns
all cross-activity transitions; leaf reducers (`advanceGridMovement`,
`advanceDialogue`, `advanceBattle`) stay independently testable and never
import renderers or host APIs.

### Signature sketch

```ts
type RpgActivity =
  | { readonly kind: 'overworld'; readonly overworld: OverworldState }
  | { readonly kind: 'dialogue'; readonly dialogue: DialogueActivityState; readonly returnTo: OverworldState }
  | { readonly kind: 'battle';   readonly battle: BattleState;           readonly returnTo: OverworldState }
  | { readonly kind: 'transition'; readonly transition: MapTransitionState; readonly returnTo: OverworldState };

interface RpgController {
  step(state: RpgState, input: RpgInput, fixedDt: number): RpgStepResult;
}

interface RpgStepResult {
  readonly state: RpgState;
  readonly events: readonly RpgEvent[];          // typed, flat transcript
  readonly diagnostics: readonly RpgDiagnostic[]; // safe no-ops, never throws
}

// Battle follows the request/response protocol (pure readers expose legality):
function getBattleRequest(state: BattleState, content: CompiledRpgContent): BattleRequest;
function advanceBattle(state: BattleState, command: BattleCommand, content: CompiledRpgContent): {
  readonly state: BattleState;
  readonly events: readonly BattleEvent[];
  readonly diagnostics: readonly RpgDiagnostic[];
};
```

**Trade-offs.** Impossible combinations are unrepresentable; return-to
ownership is per-variant and typed; battle keeps the standalone
command/request protocol the plan's replay and golden-transcript testing
requires. Cost: the union grows a variant per new activity (fine — additive),
and the facade is the one place that must get transition priority right
(warp → heal → encounter, terminal for the tick), which is exactly the
documented, testable seam.

---

## Approach C: Event-Sourced Aggregate (command log as state)

**Source pattern:** event-sourcing plus `pkmn/engine` input logs — state is a
fold over an append-only `RpgCommand[]`; a snapshot is a cache, replay is
re-folding.

**Core idea:** `createRpgState` produces an initial event; every input appends
a semantic command; `replayRpg(commands)` deterministically rebuilds any state.
Save files store the command log; mid-battle restore is trivial by
construction.

### Signature sketch

```ts
interface RpgSession {
  readonly commands: readonly RpgCommand[];
  readonly snapshot?: RpgState;   // optional fold cache
}
function applyCommand(session: RpgSession, command: RpgCommand): RpgSession;
function foldRpg(commands: readonly RpgCommand[], seed: number): RpgState;
```

**Trade-offs.** Replaying and diffing are first-class — the strongest shape for
a competitive-sim project. But it is the wrong cost curve for a starter: saves
grow without bound (or need snapshot compaction anyway), every gameplay read
needs the cache, fixed-budget RNG draws must still be designed identically, and
the 20-minute clean-room builder faces a command-log API where they need a
game. The plan already captures C's real benefit — input-log replay — through
`src/simtest` adapters and test-only traces without making the log the product
state.

---

## Recommendation

**Approach B.** The activity union makes the plan's state-ownership rules
(battle snapshot authority, dialogue `returnTo`, transition destination
ownership) compiler-enforced instead of convention-enforced, while keeping the
facade shape close enough to the platformer kernel that the starter recipe and
docs read as one engine. A supplies the same functions with weaker guarantees;
C supplies stronger replay ergonomics the starter does not need at a cost the
20-minute build cannot pay.

Open questions settled in the companion decision record:

1. Transition `returnTo` semantics and completion.
2. The dialogue → `startBattle` → battle `returnTo` handoff, and terminal-effect ordering.
3. Effective party/inventory readers and the canonical whole-game trace/hash projection while battle owns a snapshot.
4. RNG stream ownership and the new `src/rng` pure-state API.
5. Content model, fingerprinting, and never-throw validation strategy.
