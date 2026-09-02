# Decision: RPG Kernel Facade, State Ownership, and Determinism Contracts

> Status: APPROVED — proceeds to milestone implementation per `RPG_STARTER_PLAN.md`.
> Inputs: `docs/design/rpg-kernel-proposal.md` (three API alternatives) ·
> `RPG_STARTER_PLAN.md` (locked vertical-slice decisions, engine audit) ·
> pre-implementation review 2026-09-02.
> Shipped with Milestone 0: `src/rng` pure-state API, `src/rpg/` contract
> surface, root barrel export.

## Decision

Adopt **Approach B — the activity-union facade reducer** (`src/rpg/state.ts`
contracts landed in Milestone 0). One discriminated `RpgActivity` union where
each variant carries exactly its own sub-state plus the overworld it returns
to; a pure `RpgController.step(state, input, fixedDt)` owns all cross-activity
transitions; leaf reducers stay standalone and independently testable;
battle uses the standalone request/response protocol
(`getBattleRequest` / `advanceBattle`).

Rationale: the union makes the plan's state-ownership rules compiler-enforced
(impossible combinations unrepresentable), matches the platformer kernel's
proven `content + state + command → reducer → (state, events)` shape so the
engine reads as one system, and keeps replay/golden testing on `src/simtest`
adapters instead of making the command log the product state (Approach C's
cost). Approach A (flat mode enum) was rejected because every impossible state
combination becomes representable and return-to ownership degrades to
convention.

## Locked architectural adjudications

### A1 — Activity union and canonical overworld ownership

For **every** activity, exactly one field owns the authoritative overworld:

| Activity | Owner of the overworld | Meaning |
|---|---|---|
| `overworld` | `activity.overworld` | The live overworld. |
| `dialogue` | `activity.returnTo` | The overworld to resume when dialogue ends; frozen at dialogue start. |
| `battle` | `activity.returnTo` | The overworld to resume when battle ends; frozen at battle start. |
| `transition` | `activity.returnTo` | The fully constructed **destination** overworld; the warp/enter target, not the source. |

There is no other overworld copy in `RpgState`. `OverworldState.location` is
the departure tile while `step` is in flight; arrival commits `location := to`
and emits `stepCompleted` exactly once.

### A2 — MapTransitionState and completion semantics

`MapTransitionState` carries `source`, `destination`, `startedTick`,
`durationTicks` — addresses and timing only, for deterministic progress checks
and presentation fades. The destination overworld is **not** rebuilt on
completion: entering the transition constructs the destination
`OverworldState` immediately and stores it as `returnTo`; when
`tick - startedTick >= durationTicks`, the facade swaps `activity` to
`{ kind: 'overworld', overworld: returnTo }` and emits
`transitionCompleted`. No intermediate mutation of the destination can occur,
because nothing else reads or writes it during the transition.

### A3 — Dialogue terminal effects and the dialogue → battle handoff

`startBattle`, `warp`, and `endDialogue` are **terminal effects**. Content
compilation (Milestone 2) rejects a node/choice with more than one terminal
effect or a terminal effect followed by any other effect. Runtime rule: when a
node/choice commits, the facade applies preceding non-terminal effects in
authored order, then performs exactly one handoff:

- `startBattle`: end the dialogue (emit `dialogueEnded`), take the dialogue
  variant's `returnTo` as the battle variant's `returnTo`, snapshot the
  **post-effect** effective party/inventory into `BattleState`, seed
  `battleRng` by address derivation, enter battle. v1 never resumes the
  consumed dialogue after battle.
- `warp`: end the dialogue, then run the normal warp path (construct
  destination overworld, enter `transition`).
- `endDialogue` / absent `next`: swap to `{ kind: 'overworld', overworld: returnTo }`.

The dialogue reducer itself never applies effects to party/inventory/flags —
it emits typed effect requests; the facade applies them once.

### A4 — Battle snapshot authority and effective readers

Entering battle snapshots party and relevant inventory into `BattleState`.
While battle is active, that snapshot is the **sole authority** for battle HP,
active index, item consumption, and rewards; `RpgState.party`/`inventory` are
deliberately stale and are not mutated in parallel. On battle end the facade
commits the returned party/inventory/rewards exactly once and discards the
snapshot.

Readers (Milestone 3): `getEffectiveParty(state)` and
`getEffectiveInventory(state)` return the battle snapshot during battle and
the outer fields otherwise. These are the **only** sanctioned whole-state
readers; renderers and save projection must use them.

### A5 — Canonical whole-game trace/hash projection

Whole-game determinism tests hash a **canonical projection** of `RpgState`, not
the raw object: during battle the projection substitutes the effective
party/inventory (per A4) for the stale outer fields and includes the battle
snapshot; otherwise it is the state as-is. `schemaVersion`, `rulesVersion`,
`rootSeed`, and `contentFingerprint` are always part of the projection, so a
hash can never validate across differing rules or content. Transcripts are
the flat `RpgEvent[]` stream (battle/dialogue leaf events included directly),
compared in full alongside the hash — the hash is a checksum, never a
substitute for deep equality.

### A6 — RNG ownership

| Stream | Owner | Notes |
|---|---|---|
| World encounters | `RpgState.worldRng` (`SerializableRngState`) | Fixed 3-roll pack per eligible grass arrival, consumed even on failed triggers. |
| Battle | `BattleState.battleRng` | Fixed per-command budgets (Fight 8, Catch 4, Switch 3, Flee 4 draws), consumed even when unneeded; rejected/forced commands consume zero. |
| Creature definition | Address-derived: `deriveSeed(rootSeed, 'species', index)` | Stable per species; never advanced. |
| Creature individual | Address-derived: `deriveSeed(rootSeed, 'individual', instanceId)` | Per-individual visual/stat variation. |
| Encounter instance/battle seed | Address-derived: `deriveSeed(rootSeed, 'encounter', encounterIndex)` | `encounterIndex` is stored in `RpgState` and the save envelope. |
| Presentation | `deriveVisualSeed` or renderer-owned | Never feeds simulation. |

The new `src/rng` pure-state API (`createRngState`/`advanceRng`/`nextRngInt`)
is byte-identical to `mulberry32` (one shared internal step; known-answer
tests pin the vectors) and `deriveSeed` domain-separates simulation addresses
from visual addresses. Adding a visual roll can never change an encounter or
battle result; adding a battle roll is a rules-version change.

### A7 — Command/event protocol

The UI renders exposed legality; the reducer revalidates:
`getBattleRequest(state, content).legalCommands` is the exact legal set at
every decision point; `advanceBattle` revalidates every command because
queued or replayed input can be stale — an illegal command is a no-op plus a
`commandRejected` event and a diagnostic, never a throw. All events are typed
discriminated unions (`BattleEvent`, facade `RpgEvent`); simulation never
emits prose, and renderers never parse displayed strings. Leaf event unions
join the facade `RpgEvent` union directly so transcripts stay flat; growth is
additive.

### A8 — Content model, compile result, validation strategy

Content is one JSON-serializable `RpgContentBundle` (types, moves, species,
items, encounters, dialogues, maps) with explicit IDs everywhere and no
script strings or callbacks. `compileRpgContent` (Milestone 2) never throws:
it validates unique IDs, every cross-reference, finite integer ranges,
non-empty weighted tables, completeness and allowed multipliers of the type
matrix, map entity references, dialogue reachability, and terminal-effect
ordering, then returns either `{ ok: true, content, diagnostics }` with an
immutable `CompiledRpgContent` (lookup records + ordered id arrays + canonical
FNV fingerprint) or `{ ok: false, diagnostics }` with path-based diagnostics
like `species[2].learnset[1].moveId`. Games run only on compiled content;
saves and traces bind to the fingerprint and refuse cross-content restore by
default.

### A9 — Versions and IDs

`RPG_STATE_SCHEMA_VERSION`, `RPG_CONTENT_SCHEMA_VERSION`,
`RPG_SAVE_SCHEMA_VERSION` (serialized shapes; migration territory) and
`RPG_RULES_VERSION` (simulated outcomes: formulas, roll order, draw budgets,
defaults; golden transcripts bind to it) are public constants in
`src/rpg/constants.ts`. Changing a shipped value is a deliberate release
decision, not a casual edit. Public names are `Rpg`/`Battle`/`RPG_`-prefixed
or uniquely named so the root wildcard export can never silently drop an
ambiguous name.

## Milestone 0 deliverables (shipped with this decision)

- `src/rng/state.ts` + `src/rng/derive-seed.ts`: serializable pure-state
  streams and generic simulation seed derivation; `mulberry32` refactored to
  wrap the same internal step. Known-answer, serialization-resume,
  stream-isolation, order-sensitivity, and cross-API-match tests in
  `src/tests/rng-state.test.ts` and `src/tests/derive-seed.test.ts`.
- `src/rpg/` contract surface: `types.ts` (IDs, diagnostics, location, input),
  `constants.ts` (versions, draw budgets, limits, `DEFAULT_RPG_CONFIG`),
  `map.ts`, `creatures.ts`, `party.ts`, `inventory.ts`, `encounters.ts`,
  `dialogue.ts`, `battle-types.ts`, `content.ts`, `state.ts`, and the
  `index.ts` barrel wired into the root export.
- Exit gate verified: RNG tests pass; contracts typecheck; no platformer-state
  cast and no renderer dependency anywhere in `src/rpg/`.
