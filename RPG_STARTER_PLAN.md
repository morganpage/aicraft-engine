# RPG Starter Implementation Plan — Top-Down Monster-Tamer Vertical Slice

Status: IN PROGRESS — implementation-ready build brief; Milestones 0–1 complete (2026-09-02). Originally written 2026-09-01; revised 2026-09-02 after pre-implementation review.

## Why this exists

The next YouTube video on the Morgan Page channel (`@MorganPageTech`, 2,260 subscribers at planning time) is **“Building a Pokémon-Style 2D RPG in 20 Minutes Using Only AI Tools.”** The 20-minute claim is honest only if an AI agent assembles the game on top of ready, documented engine primitives instead of inventing movement, dialogue, encounters, combat, persistence, and rendering during the timed build.

This project adds those primitives and a starter composition. The preparation session is also a second video: **“I Added Turn-Based Battles to My Engine with AI Agents.”**

**Scope accounting:** the 20-minute clock measures assembly with finished engine APIs, documentation, recipes, and starter patterns. Milestones 0–6 are substantial multi-session engine preparation and are not part of that clock. The preparation effort and the timed consumer build must be presented as separate work; the video must not imply that the deterministic RPG core itself was created in 20 minutes.

Full research and video conditions live in `ai-craft-strategy/knowledge/youtube-video-suggestions.md` in the separate strategy workspace.

## Product outcome

Ship a zero-asset, top-down monster-tamer RPG starter with this complete loop:

> Explore → talk → enter tall grass → encounter → fight → weaken → capture → gain XP → heal → save → reload → continue.

The engine deliverable is not just a collection of low-level utilities. It must include a small, composable RPG facade and a runnable starter that let a developer or AI agent author the game primarily as data.

The starter succeeds only if all three outcomes are demonstrated:

1. **Engine outcome:** reusable, documented, tree-shakeable RPG APIs ship from `src/rpg/`.
2. **Game outcome:** `games/rpg-starter/` runs the complete loop with no required image, font, or audio assets.
3. **Video outcome:** an independent clean-room agent can assemble a distinct vertical slice from the public API and starter recipe in 20 minutes or less.

## Locked vertical-slice decisions

These decisions are binding for v1. Do not reopen them during implementation unless a prototype proves one impossible.

| Concern | Locked v1 decision |
|---|---|
| Movement | Four-direction, tile-snapped movement. No diagonals and no free analogue movement. |
| Movement timing | A step has an integer tick duration. Logical arrival, interactions, warps, and encounter checks occur once when the step completes. |
| Input ambiguity | The input adapter supplies at most one directional intent per tick. The deterministic core never resolves simultaneous raw device directions. |
| World structure | One generated outdoor map plus one small healing interior connected by a warp. APIs support a map catalog. |
| Runtime modes | RPG-owned discriminated state: overworld, dialogue, battle, transition. Do not force RPG modes through the current platformer-specific `src/game-state` union. |
| Battle shape | One active creature versus one wild creature. Player party may contain up to six. |
| Commands | Fight, Catch, Switch, Flee. A pure reader exposes the exact legal commands at every decision point. |
| Types | Four original single-creature types with an explicit effectiveness matrix. Multi-type creatures are deferred. |
| Battle variance | Accuracy, critical hits, damage variance, capture, flee, and enemy choice are deterministic seeded rolls. |
| Status effects | Deferred. Type effectiveness and critical hits provide enough v1 combat texture. |
| Move learning | A creature learns a move automatically when it has fewer than four moves. If already full, emit `moveLearnDeferred`; move-replacement UI is out of scope. |
| Capture at full party | Catch is not a legal command when the party is full. No storage-box system in v1. |
| Defeat | Return to the last healing anchor and restore the party. No money penalty or game-over screen. |
| Saving | Save only from a stable, idle overworld state. Mid-dialogue and mid-battle saves are rejected as safe no-ops with diagnostics. |
| Content | JSON-serializable definitions with explicit IDs, versions, validation, and diagnostics. No arbitrary `eval`, script strings, or callbacks in authored data. |
| Rendering | Canvas2D procedural rendering. Typewriter timing and battle animations are presentation-only and never advance authoritative simulation. |
| Assets | Zero assets required. Aseprite/LDtk consumers remain supported but are optional adapters, not starter requirements. |

## Hard constraints

1. **Determinism everywhere.** No `Math.random`, `Date.now`, unordered global state, or DOM reads in simulation. Same rules version, content fingerprint, seed, initial state, and commands must produce byte-identical state and typed event transcripts.
2. **Serializable randomness.** Every gameplay RNG stream has explicit serializable state. A hidden closure is not sufficient for save/restore or mid-battle replay.
3. **Procedural-first rendering.** Creatures, portraits, tiles, UI, and battle backdrops are generated from Canvas2D/vector primitives plus palette data.
4. **Simulation/presentation separation.** Authoritative rules resolve without waiting for tweens, sound, timers, typewriter text, or animation callbacks.
5. **Zero runtime dependencies.** Strict TypeScript, Canvas2D, and WebAudio only. Keep `package.json` runtime dependencies empty.
6. **Pure progression.** State-changing public functions return new state, never mutate inputs, and never throw. Invalid commands and references produce safe no-ops plus diagnostics.
7. **Repository conventions.** Follow `docs/conventions.md` and `docs/architecture.md`; add extensive public JSDoc, tests, module barrels, root exports, architecture/API documentation, and a changelog entry.
8. **IP safety.** Do not ship Nintendo/Game Freak names, designs, cries, type names, UI copies, formulas, maps, text, or assets. “Pokémon-style” describes only the broad collect/battle loop.

## Reference research and lessons

The implementation may learn architectural patterns from these repositories, but must not copy protected content or incompatible-license code.

| Reference | Adopt | Avoid |
|---|---|---|
| [`pkmn/engine`](https://github.com/pkmn/engine) | `choices`/`update` API shape, serializable PRNG state, restore support, input-log replay, differential/fuzz testing | Its IP-specific mechanics, binary complexity, and dependency stack |
| [Pokémon Showdown simulator](https://github.com/smogon/pokemon-showdown/blob/master/sim/SIMULATOR.md) | Commands separated from an emitted battle protocol; explicit choice requests; seeded input logs | Its enormous generic effect/event system and multiplayer secrecy requirements |
| [Tuxemon](https://github.com/Tuxemon/Tuxemon) | Explicit combat phases, action queue, validated content, versioned save-upgrade ladder | GPL source copying, global mutable objects, and unseeded random calls |
| [Devshare Academy Monster Tamer](https://github.com/devshareacademy/monster-tamer) | Minimum viable scene/menu/capture/XP flow and simple data tables | Authoritative HP and rules inside Phaser objects and animation callbacks |
| [Hero’s Legend Phaser RPG](https://github.com/osisdie/phaser-rpg-game) | Modern TypeScript folder separation, data catalogs, UI components, browser E2E coverage | `Math.random` in rules, mutable global state, and parsing localized log strings to drive visuals |

The central pattern for this engine is:

```text
content + state + command
           │
           ▼
     pure RPG reducer
       │         │
  next state   typed events
       │         │
 save/replay   renderer/audio/UI
```

## Existing engine audit: reuse accurately

### Reuse as-is

| Need | Existing API |
|---|---|
| Fixed-step loop | `src/game-loop` |
| Device input and edge accumulation | `src/input` |
| Tile coordinate conversion and AABB helpers | `src/collision` |
| Camera follow/clamp/snap | `src/camera` |
| Menu cursor behavior | `src/game-state/menu-nav.ts` only |
| Bitmap text and drawing primitives | `src/primitives` |
| Palette generation and contrast repair | `src/palette` |
| Cosmetic palette/scale variants | `src/cosmetics` |
| Seeded number generation and visual addressing | `src/rng` |
| Save storage adapters | `src/save` |
| Generic deterministic traces and scenario adapters | `src/simtest` |
| Canonical serialization and FNV hash | `canonicalize` / `fnv1a` currently exported through `src/level` |
| Synthesized SFX and procedural music | `src/audio`, `src/music` |
| Optional sprite-sheet rendering | `src/sprites` |
| Optional raw LDtk parsing/drawing | `src/ldtk` |

### Reuse through an RPG adapter

| Need | Boundary |
|---|---|
| Collision | Reuse tile queries and coordinate helpers, but author an RPG grid-step kernel rather than adapting platformer gravity physics. |
| Character drawing | Reuse body-frame and primitive concepts, but add top-down actor and creature body plans. The existing built-in body plan is humanoid/platformer-oriented. |
| Terrain art | Reuse palettes/material concepts where helpful, but provide a dedicated top-down tile renderer. Existing platformer exposure/theme composition is not the RPG renderer. |
| LDtk | Accept an optional translator from named IntGrid/entity layers into `RpgMapDefinition`; the zero-asset starter does not require LDtk. |
| Replay testing | Build a `SimulationAdapter<BattleState, BattleCommand>` on `src/simtest`. The current `src/replay` types remain platformer-specific and are not the battle replay API. |

### Do not assume reusable

- `src/game-state` has a closed platformer mode union; use only its generic menu navigation helper.
- `src/level` and `src/levelgen` ship an opinionated platformer schema and physics-constrained generator; do not add RPG fields to those unions.
- `src/platformer` is a composition reference, not an implementation dependency.
- `src/cosmetics` varies palettes and scale; it does not generate creature anatomy.
- `src/save` stores raw JSON defensively but does not validate, migrate, or hash RPG state.
- `src/replay` records `PlatformerState` and `PlatformerInput`; do not cast RPG state into those types.

## Module and file layout

Keep the feature cohesive under one top-level `src/rpg/` module, mirroring the way `src/platformer/` owns a facade plus focused leaves. Avoid prematurely promoting dialogue, encounters, or creature generation to generic top-level modules before a second shipped game proves the abstraction.

```text
src/rpg/
├── index.ts                    # Public barrel; values and types exported explicitly
├── types.ts                    # Shared IDs, diagnostics, content and session contracts
├── constants.ts                # Version numbers and default configs
├── rng.ts                      # RPG stream derivation over serializable src/rng state
├── content.ts                  # Content bundle compile/index readers
├── validation.ts               # Never-throw path-based content diagnostics
├── map.ts                      # RpgMapDefinition, tile roles, entity definitions
├── mapgen.ts                   # Seeded connected starter-world generation
├── map-verify.ts               # BFS reachability and required-anchor checks
├── movement.ts                 # Four-direction tick-based grid-step reducer
├── interaction.ts              # Facing-tile NPC/heal/warp/trigger resolution
├── dialogue.ts                 # Dialogue session reducer and typed effects
├── creatures.ts                # Species and creature-instance factories/readers
├── creature-generator.ts       # Seeded names, stats, types, learnsets and art manifests
├── progression.ts              # XP thresholds, level-up and automatic learning
├── party.ts                    # Pure party operations, maximum six
├── inventory.ts                # Pure item-count operations
├── encounters.ts               # Step-triggered rolls and weighted selection
├── battle-types.ts             # Battle state, command, request and event unions
├── battle.ts                   # Pure battle reducer and legal-command reader
├── battle-math.ts              # Integer-only damage/catch/flee/XP calculations
├── battle-simtest.ts           # Adapter factory for src/simtest
├── state.ts                    # Top-level RPG activity reducer/facade
├── save.ts                     # Save projection, validation, migration and hash
├── renderer/
│   ├── index.ts
│   ├── map-renderer.ts
│   ├── actor-renderer.ts
│   ├── creature-renderer.ts
│   ├── dialogue-renderer.ts
│   ├── battle-renderer.ts
│   └── hud-renderer.ts
└── tests/
    └── *.test.ts

games/rpg-starter/
├── src/
│   ├── main.ts
│   ├── content.ts              # The primary file changed during the timed build
│   ├── recipes/                # Copied engine recipes where applicable
│   └── style.css
├── tests/
├── package.json
├── tsconfig.json
└── vite.config.ts
```

Add `export * from './rpg';` to `src/index.ts`. If root-barrel names collide, rename RPG exports with an `Rpg`/`Battle` prefix rather than hiding them behind unsafe wildcard ambiguity.

## Public composition API

The primary engine surface should remain pure and structurally similar to the platformer kernel:

```ts
interface RpgController {
  step(state: RpgState, input: RpgInput, fixedDt: number): RpgStepResult;
}

function compileRpgContent(bundle: RpgContentBundle): RpgContentResult;
function createRpgController(
  content: CompiledRpgContent,
  config?: Partial<RpgConfig>,
): RpgController;
function createRpgState(
  content: CompiledRpgContent,
  seed: number,
  start?: Partial<RpgStart>,
): RpgState;

interface RpgStepResult {
  readonly state: RpgState;
  readonly events: readonly RpgEvent[];
  readonly diagnostics: readonly RpgDiagnostic[];
}
```

`createRpgController` may close over immutable compiled content and configuration, but it must not own mutable simulation state. Multiple sessions must be able to share one controller safely.

`step` is called exactly once per configured fixed simulation tick. The controller validates `fixedDt` against its configured tick duration and reports a diagnostic for a non-finite, negative, or mismatched value. Movement, cooldowns, dialogue progress, and RNG schedules use integer ticks rather than accumulated floating-point wall time.

### Top-level state

Use a discriminated activity union so impossible combinations cannot exist:

```ts
type RpgActivity =
  | { readonly kind: 'overworld'; readonly overworld: OverworldState }
  | { readonly kind: 'dialogue'; readonly dialogue: DialogueState; readonly returnTo: OverworldState }
  | { readonly kind: 'battle'; readonly battle: BattleState; readonly returnTo: OverworldState }
  | { readonly kind: 'transition'; readonly transition: MapTransitionState; readonly returnTo: OverworldState };

interface MapTransitionState {
  readonly source: RpgLocation;
  readonly destination: RpgLocation;
  readonly startedTick: number;
  readonly durationTicks: number;
}

interface RpgState {
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
  readonly encounterIndex: number;
  readonly lastHealAnchor: RpgLocation;
}
```

The facade owns cross-system transitions. Leaf reducers never import renderers and never call storage, audio, DOM, or device adapters.

State ownership at activity boundaries must be explicit:

- Entering battle snapshots party and relevant inventory into `BattleState`.
- While battle is active, that snapshot is the sole authority for battle HP, active index, item consumption, and rewards; the outer copies are not mutated in parallel.
- `getEffectiveParty`, `getEffectiveInventory`, and the whole-game trace projection read the battle snapshot during battle and the outer fields otherwise. The outer `RpgState.party` and `inventory` are deliberately stale while battle is active and are omitted as independent values from the canonical trace/hash projection.
- Leaving battle commits the returned party, inventory, and reward result to `RpgState` exactly once, then discards the battle snapshot.
- Dialogue effects are emitted as typed effect requests and applied once by the facade; a dialogue reducer does not reach into party, inventory, or world flags directly.
- A dialogue `startBattle` effect ends the dialogue. The facade first applies preceding non-terminal effects, uses the dialogue variant's `returnTo` as the battle variant's `returnTo`, snapshots the resulting effective party/inventory, and enters battle. v1 never resumes the consumed dialogue after battle.
- A transition's `returnTo` is the fully constructed destination `OverworldState`. `MapTransitionState` carries source/destination and tick timing only for deterministic transition progress and presentation; completion swaps directly to `returnTo`.
- Warp, heal, dialogue, and encounter transitions are terminal for a tick. Once the first applicable transition is chosen by the documented priority, later candidates do not also execute.

## Deterministic RNG foundation

The current `mulberry32(seed)` closure is deterministic but its cursor cannot be serialized. Before any RPG stochastic system lands, add a backwards-compatible pure state API to `src/rng`:

```ts
interface SerializableRngState {
  readonly value: number;
}

function createRngState(seed: number): SerializableRngState;
function advanceRng(state: SerializableRngState): {
  readonly state: SerializableRngState;
  readonly value: number;
};
function nextRngInt(
  state: SerializableRngState,
  min: number,
  max: number,
): { readonly state: SerializableRngState; readonly value: number };
function deriveSeed(rootSeed: number, ...parts: readonly (string | number)[]): number;
```

Requirements:

- Preserve the existing Mulberry32 output vectors exactly.
- Prefer one internal algorithm implementation; let `mulberry32` wrap the pure step if practical.
- `deriveSeed` is generic deterministic addressing. Do not misuse the semantically visual-only `deriveVisualSeed` for battle state.
- Normalize every seed and state word to unsigned 32-bit integers.
- Add known-answer, serialization-resume, stream-isolation, and cross-call-order tests.

RPG stream ownership:

| Stream | Ownership | Purpose |
|---|---|---|
| World encounter stream | `RpgState.worldRng` | Grass trigger, encounter selection, wild level |
| Battle stream | `BattleState.battleRng` | Enemy choice, ties, accuracy, crit, variance, catch, flee |
| Creature definition | Address-derived from root seed + species index | Names, stats, types, learnsets and visual manifest |
| Creature individual | Address-derived from root seed + stable instance ID | Per-individual visual/stat variation if enabled |
| Presentation | Address-derived visual seed or renderer-owned randomness | Particles and decorative motion that never feed simulation |

Adding a visual roll must never change an encounter or battle result. Adding a new battle roll is a rules-version change and requires golden-transcript updates.

## Content model and validation

### Bundle

```ts
interface RpgContentBundle {
  readonly schemaVersion: 1;
  readonly types: readonly RpgTypeDefinition[];
  readonly moves: readonly MoveDefinition[];
  readonly species: readonly SpeciesDefinition[];
  readonly items: readonly ItemDefinition[];
  readonly encounters: readonly EncounterTable[];
  readonly dialogues: readonly DialogueDefinition[];
  readonly maps: readonly RpgMapDefinition[];
}
```

`compileRpgContent` must:

- Never throw.
- Validate unique IDs and every cross-reference.
- Validate finite integer ranges and non-empty weighted tables.
- Validate the type matrix is complete and uses allowed integer multipliers.
- Validate every map spawn, NPC, warp, heal point, and encounter-zone reference.
- Validate dialogue reachability and choice/effect targets.
- Return immutable lookup records plus ordered arrays; do not expose mutable `Map`/`Set` state in serializable contracts.
- Compute a canonical content fingerprint included in saves and traces.
- Return path-based diagnostics such as `species[2].learnset[1].moveId`.

The starter content budget is deliberately small:

- Four types: `ember`, `tide`, `grove`, `spark`.
- A ring relationship: ember > grove > spark > tide > ember; reverse edges resist; all other pairs are neutral.
- Six generated species definitions.
- Eight moves: one basic and one stronger move for each type.
- Two items: one potion and one capture item.
- One outdoor encounter table.
- One NPC dialogue tree with a choice and flag effect.
- One generated outdoor map and one healing interior.

All type effectiveness values are integer ratios such as `{ numerator: 2, denominator: 1 }`; battle math must not depend on floating multiplication order.

## Top-down map, movement, and interaction

### Map schema

`RpgMapDefinition` is independent of the platformer `LevelData` union. It contains:

- Schema version, stable ID, name, dimensions, and tile size.
- Flat row-major terrain and collision grids.
- Encounter-zone ID per tile or `null`.
- Stable spawn anchors.
- NPC definitions with facing and dialogue IDs.
- Warp definitions with source tile, target map, target anchor, and target facing.
- Healing points.
- Optional procedural render theme/palette IDs.

Authoritative player location is tile-based: `{ mapId, tileX, tileY, facing }`. Pixel positions during a step are derived presentation values.

### Movement reducer

`advanceGridMovement(state, intent, map, config)` must:

1. Ignore new movement while a step is active.
2. Update facing even when the destination is blocked.
3. Validate the destination against bounds, collision tiles, and blocking NPCs.
4. Start a tick-counted step when clear.
5. Emit exactly one `stepCompleted` event on arrival.
6. Resolve, in order: warp → heal point → encounter zone.
7. Never emit an encounter on a blocked attempt, warp arrival, or idle tick.

Default `stepDurationTicks` is configuration data, not a magic number. Holding a direction may chain steps only after the previous arrival event.

### Map generation

`generateRpgWorld(seed, config)` should use a constrained, easily verified generator rather than a complex roguelike algorithm:

1. Stamp a bounded outdoor map with perimeter collision.
2. Place the start, NPC clearing, grass patch, and clinic warp anchors.
3. Connect required anchors with guaranteed walkable paths.
4. Add obstacle clusters only on non-required cells.
5. Add encounter-zone grass in reachable, non-path areas.
6. Generate the clinic as a small fixed-layout map with a healing point and return warp.
7. Run `verifyRpgWorld` BFS; perform deterministic repair or return diagnostics if required anchors are unreachable.

Generation must guarantee that spawn, NPC, grass, clinic, and return path are reachable. Candidate search and difficulty scoring from `src/levelgen` are not required.

## Dialogue

### Data contract

Dialogue is a graph of stable node IDs. Nodes contain speaker ID/name, text, optional choices, optional conditions, and typed effects.

Allowed v1 conditions:

- `flagEquals`
- `hasItem`
- `partyHasSpace`

Allowed v1 effects:

- `setFlag`
- `giveItem`
- `takeItem`
- `healParty`
- `startBattle`
- `warp`
- `endDialogue`

No arbitrary script names or callback functions are serialized. Extensibility comes from adding discriminated-union variants with validators and reducer handling.

`startBattle`, `warp`, and `endDialogue` are terminal effects. Content compilation rejects a node/choice with more than one terminal effect or with a terminal effect before another effect. This gives the facade one unambiguous handoff after applying any preceding non-terminal effects in authored order.

### Runtime contract

`getDialogueRequest` returns the current text and legal choices. `advanceDialogue` accepts only `advance` or a concrete choice ID and returns the next session plus typed `DialogueEvent[]`.

The typewriter reveal, portrait bob, and open/close animation live in presentation state. A confirm used to reveal the full line is consumed by the presentation controller; only a semantic `advance`/`choose` command reaches the deterministic dialogue reducer.

The dialogue renderer must use the existing bitmap font, wrap measured text, maintain WCAG-compliant text/panel contrast, and reveal immediately under reduced-motion preference.

## Creatures and procedural generation

### Definition versus instance

```ts
interface CreatureStats {
  readonly hp: number;
  readonly attack: number;
  readonly defense: number;
  readonly speed: number;
}

interface SpeciesDefinition {
  readonly id: string;
  readonly name: string;
  readonly typeId: string;
  readonly baseStats: CreatureStats;
  readonly catchBasisPoints: number;
  readonly expYield: number;
  readonly learnset: readonly { readonly level: number; readonly moveId: string }[];
  readonly visual: CreatureVisualManifest;
}

interface CreatureInstance {
  readonly id: string;
  readonly speciesId: string;
  readonly individualSeed: number;
  readonly level: number;
  readonly xp: number;
  readonly currentHp: number;
  readonly moveIds: readonly string[];
}
```

Never store `currentHp`, level, or learned moves in species content. Never duplicate species stats into save data unless they are an explicit per-individual modifier.

### Generator

`generateSpecies(seed, catalog)` must produce valid, JSON-serializable content from fixed grammars:

- Name from original syllable banks, normalized to a safe ID.
- One of at least five non-franchise-specific body grammars, such as blob, quadruped, avian, sprout, or shell.
- Proportions and features encoded as primitive parameters, not draw callbacks.
- Palette generated through `src/palette` and optionally varied through compatible `src/cosmetics` concepts.
- One of four types.
- A bounded stat budget distributed by an archetype.
- A valid learnset drawn only from the supplied move catalog.
- Stable `generatorVersion: 1` in the visual/content manifest.

Apply a case-insensitive reserved-name blacklist and deterministic reroll/fallback path. This reduces accidental trademark collisions but is not a mathematical originality guarantee; generated starter content still receives human review before publication.

Creature drawing is a new RPG renderer. The existing humanoid body plan is not stretched into a monster generator.

### Starter balance envelope

Pin these values before Milestone 2 so generation and progression tests have executable bounds rather than subjective balance assertions:

| Value | Starter rule |
|---|---|
| Stat keys | `hp`, `attack`, `defense`, `speed` only |
| Species base-stat budget | Exactly 48 total; each base stat is an integer from 8 through 16 |
| Derived maximum HP | `baseStats.hp + 3 × level` |
| Derived attack/defense/speed | The corresponding `baseStats` value plus `level` |
| `expYield` | Integer from 24 through 40 |
| XP awarded | `max(1, floor(wild.expYield × wild.level / recipient.level))` |
| Level threshold | Level `L` begins at `10 × (L - 1)²` cumulative XP; advancing from `L` requires reaching `10 × L²` |
| Starter creature | Level 4 with 150 cumulative XP, guaranteeing that the first victory or capture reaches level 5 against the starter encounter range |
| Wild level range | 3 through 5 |
| Basic move | Power 6, accuracy 10,000 basis points, learned at level 1 |
| Strong move | Power 10, accuracy 9,000 basis points, learned no later than level 4 |

These are starter-content constants, not universal engine limits except for integer/range validation explicitly encoded in the relevant definition. Changing a shipped value requires balance-golden updates; changing a formula requires a rules-version decision.

## Party, inventory, and progression

### Party

- Maximum six creature instances.
- Stable unique instance IDs derived from deterministic creation addresses, never array indices or random UUIDs.
- At least one non-fainted creature is required to enter battle.
- Switch operations reject the active creature, fainted creatures, and out-of-range indices as no-ops.
- Captures append a new instance only when party space exists.

### Inventory

- Plain sorted entries: `{ itemId, quantity }[]`.
- Potion restores a configured fixed HP amount up to maximum HP.
- Capture item supplies a basis-point catch bonus.
- Counts are non-negative integers; zero-count entries are removed.
- Pure `grantItem`, `consumeItem`, and `getItemCount` operations.

### XP and levels

- Cumulative XP threshold: `10 × level²`, integer-only and configurable through a documented curve function.
- Level cap for starter content: 20.
- XP is granted to the active creature after a defeated or captured wild creature.
- Multiple level-ups in one award are supported.
- Derived maximum HP increases preserve missing HP rather than fully healing.
- Learnset entries are processed in ascending level order.
- Fewer than four known moves: learn automatically and emit `moveLearned`.
- Four known moves: emit `moveLearnDeferred`; do not silently replace a move.

## Encounters

Encounter checks are driven by semantic `stepCompleted` events, not frame time or pixel distance.

```ts
interface EncounterTable {
  readonly id: string;
  readonly triggerBasisPoints: number;
  readonly entries: readonly {
    readonly speciesId: string;
    readonly weight: number;
    readonly minLevel: number;
    readonly maxLevel: number;
  }[];
}
```

For every eligible grass arrival, consume a fixed three-roll pack in this order, even when the trigger fails:

1. Trigger roll.
2. Weighted species roll.
3. Wild level roll.

This fixed draw budget makes encounter streams resistant to later branching changes. A successful encounter derives the creature instance seed and battle seed from the world root seed plus the stable encounter index; rendering never consumes this stream.

Visible roaming creatures are out of scope.

## Battle kernel

### Command/request API

```ts
type BattleCommand =
  | { readonly type: 'fight'; readonly moveId: string }
  | { readonly type: 'catch'; readonly itemId: string }
  | { readonly type: 'switch'; readonly partyIndex: number }
  | { readonly type: 'flee' };

interface BattleRequest {
  readonly phase: 'command' | 'forced-switch' | 'ended';
  readonly legalCommands: readonly BattleCommand[];
}

interface BattleState {
  readonly schemaVersion: 1;
  readonly rulesVersion: number;
  readonly turn: number;
  readonly phase: 'command' | 'forced-switch' | 'ended';
  readonly playerParty: PartyState;
  readonly battleInventory: InventoryState;
  readonly activePlayerIndex: number;
  readonly wild: CreatureInstance;
  readonly battleRng: SerializableRngState;
  readonly failedFleeAttempts: number;
  readonly outcome?: 'victory' | 'defeat' | 'captured' | 'fled';
  readonly rewardsApplied: boolean;
}

function getBattleRequest(
  state: BattleState,
  content: CompiledRpgContent,
): BattleRequest;

function advanceBattle(
  state: BattleState,
  command: BattleCommand,
  content: CompiledRpgContent,
  config?: Readonly<BattleConfig>,
): {
  readonly state: BattleState;
  readonly events: readonly BattleEvent[];
  readonly diagnostics: readonly RpgDiagnostic[];
};
```

The UI renders `legalCommands`; it does not independently reconstruct legality. The reducer nevertheless revalidates every command because queued or replayed input can be stale.

### Authoritative phases

Keep simulation phases small:

- `command`: waiting for Fight/Catch/Switch/Flee.
- `forced-switch`: active party member fainted and another is available.
- `ended`: captured, fled, victory, or defeat.

Intro text, action animation, HP-bar tweening, reward panels, and outro are renderer presentation phases driven by emitted events. They do not live in `BattleState`.

### Turn rules

- **Fight:** choose the enemy move deterministically, construct two actions, sort by move priority, speed, then seeded tie roll, and resolve in order. Skip an action if its actor fainted earlier in the turn.
- **Catch:** legal only in a wild battle, with party space and a capture item. Consume the item. Success ends battle; failure allows one enemy move.
- **Switch:** replace the active creature first, then allow one enemy move. Forced switches do not grant the enemy an extra move.
- **Flee:** resolve before attacks. Success ends battle; failure increments the flee-attempt counter and allows one enemy move.
- **Faint:** if the active party creature faints, request a forced switch when possible; otherwise end in defeat.
- **Victory/capture:** compute rewards exactly once and mark them applied in state so replayed presentation cannot duplicate them.

Random draws within a legal command use a versioned fixed budget and are sampled before effects resolve:

1. **Fight — eight draws:** enemy move choice, order tie-break, player accuracy/critical/variance, then wild accuracy/critical/variance. The tie-break and both attack packs are consumed even when not needed or when an actor faints before acting.
2. **Catch — four draws:** capture, then a potential wild accuracy/critical/variance pack. The wild pack is consumed even when capture succeeds.
3. **Switch — three draws:** the potential wild accuracy/critical/variance pack.
4. **Flee — four draws:** flee, then a potential wild accuracy/critical/variance pack. The wild pack is consumed even when fleeing succeeds.

Forced switches and rejected commands consume zero draws. No renderer, text effect, diagnostic, or presentation skip consumes battle RNG. If a future rules change needs another budget or order, bump `rulesVersion` and update golden vectors.

### Typed battle events

At minimum:

```ts
type BattleEvent =
  | { readonly type: 'battleStarted'; readonly wildId: string }
  | { readonly type: 'commandRejected'; readonly reason: string }
  | { readonly type: 'moveUsed'; readonly actorId: string; readonly moveId: string; readonly targetId: string }
  | { readonly type: 'moveMissed'; readonly actorId: string; readonly moveId: string }
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
  | { readonly type: 'moveLearned'; readonly creatureId: string; readonly moveId: string }
  | { readonly type: 'moveLearnDeferred'; readonly creatureId: string; readonly moveId: string }
  | { readonly type: 'battleEnded'; readonly outcome: 'victory' | 'defeat' | 'captured' | 'fled' };
```

Do not emit localized prose from simulation. The renderer/localization layer converts typed events into text and animation cues.

### Integer battle math

All inputs are normalized finite integers. Use explicit floor points and never depend on floating evaluation order.

Damage:

```text
scaledAttack = attack + 2 × level
rawDamage = max(1, floor(movePower × scaledAttack / max(1, 2 × defense)))
damage = max(1, floor(rawDamage × typeNum × critNum × variancePercent /
                      (typeDen × critDen × 100)))
```

- Accuracy is basis points from 0–10,000.
- Critical chance defaults to 1,000 basis points and critical multiplier to `3/2`.
- Damage variance is an integer percentage from 90 through 100 inclusive.
- A Fight action consumes exactly three rolls in order: accuracy, critical, variance. Consume all three even on a miss.

Capture:

```text
missingHpBonus = floor((maxHp - currentHp) × 6000 / maxHp)
chance = clamp(speciesCatch + itemBonus + missingHpBonus, 500, 9500)
success = roll0To9999 < chance
```

Flee:

```text
chance = clamp(5000 + (playerSpeed - wildSpeed) × 250 + failedAttempts × 1000,
               1000,
               9500)
success = roll0To9999 < chance
```

Treat changing a formula, roll order, or default as a battle-rules version change.

## Save, restore, hashing, and replay

### Save envelope

```ts
interface RpgSaveData {
  readonly schemaVersion: number;
  readonly rulesVersion: number;
  readonly contentFingerprint: string;
  readonly rootSeed: number;
  readonly tick: number;
  readonly location: RpgLocation;
  readonly lastHealAnchor: RpgLocation;
  readonly party: PartyState;
  readonly inventory: InventoryState;
  readonly flags: Readonly<Record<string, boolean>>;
  readonly worldRng: SerializableRngState;
  readonly encounterIndex: number;
}
```

Battle and dialogue presentation state are intentionally absent because saving is restricted to idle overworld state.

Implement:

- `createRpgSave(state): RpgSaveResult`
- `migrateRpgSave(raw): RpgSaveMigrationResult`
- `validateRpgSave(raw, content): RpgSaveValidationResult`
- `restoreRpgState(save, content): RpgRestoreResult`
- `rpgSaveHash(save): number`

`rpgSaveHash` delegates to the existing canonicalization/FNV pipeline. Normalize semantically unordered arrays before saving; object key order is handled by canonicalization, but array order remains meaningful.

Content-fingerprint mismatch must return a diagnostic and refuse restoration by default. A future explicit migration may opt into remapping IDs.

### Battle replay

Do not cast battle data into the platformer replay types. Add `createBattleSimulationAdapter(scenario, content)` for `src/simtest`:

- Adapter ID: `rpg-battle`.
- Adapter version: the battle rules version.
- Scenario fingerprint: canonical hash of the parties, wild creature, relevant content, and battle config.
- `actions(state)` delegates to `getBattleRequest(state).legalCommands`.
- `step` delegates to `advanceBattle`.
- `outcome` maps battle outcome to success/failure/running.
- `summarize` includes outcome, turn, HP, party size, RNG state, and transcript hash.

For whole-game determinism tests, record semantic `RpgInput` snapshots or higher-level commands in a test-only trace and compare final save plus typed transcript. Generalizing `src/replay` is optional future work, not a prerequisite for the starter.

## Rendering and audio

Every renderer receives `CanvasRenderingContext2D`, authoritative read-only state, immutable visual configuration, and presentation time/tick. Renderers return no gameplay state.

### Overworld renderer

- Draw top-down ground, paths, obstacles, grass, doors, and healing points from palette-driven primitives.
- Draw a four-direction procedural actor with idle and displacement-driven walk poses.
- Draw NPCs and portraits from stable seeds.
- Use the existing camera and device-pixel snapping helpers.

### Creature renderer

- Dispatch on serializable body-plan grammar.
- Draw silhouettes that remain readable at battle and portrait sizes.
- Use outline/base/accent/feature/background palette roles.
- Derive decorative animation from visual seed + presentation tick only.
- Add a deterministic headless contact sheet covering all starter species, body plans, directions, and palette contrast.

### Battle renderer

- Draw the current state immediately, then consume `BattleEvent[]` through a presentation queue.
- Skipping or accelerating animations must produce the same simulation state.
- Never parse displayed strings to determine targets, damage, or outcomes.
- Use `createMenuNav` for command/submenu selection.

### Audio

- Use synthesized cues for menu move/confirm/cancel, encounter sting, attack, hit, critical, capture success/failure, level-up, heal, and save.
- Unlock audio through the existing recipe/adapter pattern.
- Audio failures are silent and never block state progression.

## Starter composition and honest 20-minute test

`games/rpg-starter/` is a real consumer of the root barrel. It may not import private files from `src/rpg/`.

The starter should make `src/content.ts` the obvious editing surface. A builder can replace names, dialogue, seeds, palettes, and map-generation config without touching the battle or runtime implementation.

Provide one compiled/tested copy-in recipe if repeated boot wiring is otherwise necessary. It should compose existing fixed-loop, input, audio-unlock, save-storage, resize, and RPG-controller APIs; it must import only from the package root and be added to `recipes/README.md`.

### Clean-room timing protocol

The 20-minute claim passes only under a recorded test with these rules:

1. Start from a fresh TypeScript/Vite/Canvas consumer shell with dependencies already installed, matching the video setup.
2. Give an independent AI agent the published engine API docs, starter recipe, and a one-paragraph creative brief.
3. Do not allow edits inside engine `src/` during the timed run.
4. Stop the clock when the production build runs and the browser demonstrates: movement, NPC dialogue, grass encounter, Fight, Catch, XP/level, heal, save, reload.
5. Record elapsed wall time, prompt, commands, final diff, and any manual intervention.
6. A failed or over-20-minute run produces a postmortem and at least one concrete API, documentation, or recipe simplification before another attempt.
7. Allow at most three timed attempts in one release cycle. If all three fail, stop retrying and record one explicit decision: revise this plan and schedule a new cycle, reframe the video without the 20-minute claim, or defer the video. Technical engine/starter release may proceed when its own gates pass, but a failed timing gate never permits the original claim.

The original `games/rpg-starter/` proves correctness; the clean-room build proves usability and the video claim.

## Implementation milestones

Each milestone is independently reviewable. Do not begin renderer polish before the corresponding deterministic core gate passes.

### Milestone 0 — contracts and cross-cutting foundations

- [x] Write `docs/design/rpg-kernel-proposal.md` with at least two API alternatives.
- [x] Record the chosen facade, activity union, command/event protocol, RNG ownership, and content model in `docs/design/rpg-kernel-decision.md`.
- [x] Specify `MapTransitionState`, transition `returnTo`, completion semantics, and canonical overworld ownership for every activity.
- [x] Specify ordered dialogue terminal effects, including the dialogue → `startBattle` → battle `returnTo` handoff.
- [x] Specify effective party/inventory readers and the canonical whole-game trace/hash projection while battle owns a snapshot.
- [x] Add serializable RNG state and generic seed derivation to `src/rng` without changing existing output vectors.
- [x] Define RPG versions, IDs, diagnostics, content bundle, compile result, and validation strategy.
- [x] Add initial `src/rpg/index.ts` and root exports.

Exit gate: RNG serialization/resume tests pass; public contracts typecheck; architecture review finds no platformer-state cast or renderer dependency.

### Milestone 1 — overworld kernel and maps

- [x] Implement the RPG map schema and validation.
- [x] Implement four-direction tick-based movement and blocking NPC collision.
- [x] Implement facing-tile interaction, healing points, and warps.
- [x] Implement constrained two-map world generation and BFS verification.
- [x] Add movement, collision, warp, event-order, generation, repair, and determinism tests.

Exit gate: a headless scripted input trace reaches the NPC, grass, clinic, and return warp on every tested seed; same trace yields identical world state and hash.

### Milestone 2 — content, creatures, party, inventory, dialogue

- [ ] Implement content compilation and cross-reference diagnostics.
- [ ] Implement species/instance separation and seeded species/visual generation.
- [ ] Implement party and inventory pure operations.
- [ ] Implement XP/level progression and move-learning events.
- [ ] Implement dialogue graph validation, conditions, effects, requests, and reducer.
- [ ] Encode the starter balance envelope: exact stat budget/bounds, derived stats, `expYield`, XP awards/thresholds, encounter levels, and move values.
- [ ] Add name safety, stat-budget, XP-boundary, learnset, dialogue-cycle, terminal-effect-order, and invalid-reference tests.

Exit gate: six generated species and all starter content compile with zero error diagnostics; invalid fixtures report stable paths without throwing.

### Milestone 3 — encounters and battle simulation

- [ ] Implement fixed-budget grass encounter rolls.
- [ ] Implement battle state, legal requests, commands, action ordering, enemy selection, integer math, capture, flee, switch, faint, rewards, and end states.
- [ ] Emit typed events only; no renderer or prose dependencies.
- [ ] Add the `src/simtest` battle adapter.
- [ ] Add golden transcripts, serialize/restore continuation, invalid-command, invariant, fuzz, and stream-isolation tests.

Exit gate: same scenario seed and commands produce identical state, RNG cursor, typed transcript, simulation trace hash, and rewards across repeated runs and a mid-battle restore.

### Milestone 4 — procedural presentation

- [ ] Implement map, actor, NPC, portrait, dialogue, creature, battle, and HUD renderers.
- [ ] Implement event-driven battle presentation queue with skip/fast-forward.
- [ ] Add synthesized SFX/music cues and defensive audio unlock.
- [ ] Respect reduced motion and text contrast requirements.
- [ ] Generate deterministic contact sheets and gameplay screenshots for review.

Exit gate: visual review confirms six distinct readable creatures, clear walkability/grass/doors, legible dialogue, unambiguous battle state, and identical gameplay outcomes with animations enabled, skipped, or reduced.

### Milestone 5 — saves and integrated starter

- [ ] Implement versioned RPG save validation, migration, stable projection, restore, and hash.
- [ ] Build `games/rpg-starter/` using only public exports and approved recipes.
- [ ] Add browser tests for the full loop and save/reload.
- [ ] Add a production build and forbidden-API scan for simulation files.
- [ ] Update README integration guidance.

Exit gate: the scripted full loop completes twice, reload continues from the same tile with identical party/inventory/flags/RNG state, and the save hashes match.

### Milestone 6 — documentation, release, and timed proof

- [ ] Update `docs/architecture.md` with RPG layer boundaries.
- [ ] Update `docs/api-surface.md` with every public export.
- [ ] Add CHANGELOG entry and package README example.
- [ ] Run root tests, build, dist build, release smoke, recipe checks, starter tests, and starter production build.
- [ ] Perform and record up to three clean-room 20-minute attempts, improving the API/docs/recipe between failed attempts.
- [ ] If no attempt passes, record the required video disposition: revised plan/new cycle, honest reframe, or deferral.

Exit gate: all repository and starter technical gates pass. Separately, either a recorded independent build completes the required loop in 20 minutes or less, or the original video claim is explicitly revised/deferred after the third failed attempt. Only the first outcome authorizes the 20-minute claim.

## Test plan

### Unit tests

- Serializable RNG known vectors, resume, cloning/branching, channel isolation, and integer bounds.
- Map validation, grid movement, simultaneous-input normalization boundary, collision, NPC blocking, warp ordering, and reachability repair.
- Activity handoffs, transition completion/`returnTo`, dialogue-to-battle ownership, terminal-effect ordering, effective party/inventory readers, and canonical in-battle trace projection.
- Content duplicate IDs, missing references, invalid weights, invalid type matrices, dialogue dead ends, and invalid effect payloads.
- Species generation stability, exact stat budgets/bounds, derived-stat formulas, `expYield` bounds, safe IDs/names, learnset validity, and visual-manifest JSON round trips.
- Party capacity, capture append, item counts, HP clamps, XP thresholds, multi-level awards, and full-moves behavior.
- Encounter trigger boundaries, weighted edges, fixed three-roll consumption, and encounter instance addressing.
- Battle damage, effectiveness, accuracy, critical, speed ties, capture bounds, flee escalation, forced switches, reward idempotence, and every terminal outcome.
- Save projection eligibility, migrations, content mismatch, corrupt input, stable ordering, hash known vectors, and restore.

### Determinism and property tests

- Same inputs twice → deep-equal state, events, RNG state, trace hash, and save hash.
- Save/restore at an overworld boundary → continuation equals uninterrupted run.
- Serialize/restore battle state → remaining transcript and final state equal uninterrupted battle.
- Presentation disabled/enabled/reduced → authoritative outcome unchanged.
- Every command returned by `getBattleRequest` is accepted in that state.
- Every command not returned is rejected without state mutation beyond a diagnostic event.
- HP remains within `[0, maxHp]`; item quantities remain non-negative; party length remains `[1, 6]`; active party index is valid outside terminal defeat.
- Generated maps always keep required anchors reachable across the configured seed corpus.

### Golden scenarios

Pin at least these exact typed transcripts:

1. Normal fight ending in victory and XP.
2. Faster wild creature acting first.
3. Miss, critical hit, resisted hit, and effective hit.
4. Failed capture followed by an enemy move, then successful capture.
5. Failed flee followed by an enemy move, then successful flee.
6. Player faint followed by forced switch.
7. Final party creature faint ending in defeat and heal-anchor recovery.
8. Mid-battle serialization/restoration.

Golden updates require an explicit rules-version decision, not a casual snapshot rewrite.

### Integration and browser tests

- Boot with no asset files and no localStorage.
- Keyboard plus at least one touch/gamepad input path.
- Walk to and interact with NPC.
- Dialogue choice sets a flag and grants an item.
- Grass step starts deterministic encounter.
- Fight, Catch, Switch, and Flee menus expose only legal options.
- Capture updates party and consumes item.
- XP produces a level-up event.
- Clinic heals and updates anchor.
- Save, reload page/session, and continue from identical state.
- Corrupt save falls back safely with a visible nonfatal diagnostic.

## Required verification commands

The implementing agent must run and report:

```text
npm test
npm run build
npm run build:dist
npm run release:smoke
npm run check:starter-recipes
```

Also run the `games/rpg-starter/` typecheck, unit tests, browser tests, and production build through scripts added to that package. Do not claim completion from unit tests alone.

## Definition of done

- [ ] `src/rpg/` ships the documented public facade and focused leaf APIs.
- [ ] `src/index.ts`, `docs/architecture.md`, `docs/api-surface.md`, README, and CHANGELOG match the shipped surface.
- [ ] Simulation contains no `Math.random`, `Date.now`, DOM reads, renderer imports, storage calls, localized prose parsing, or input mutation.
- [ ] RNG state, rules version, and content fingerprint are present wherever replay/save determinism requires them.
- [ ] Battle exposes legal commands and returns typed events; UI never owns or reconstructs combat rules.
- [ ] Content and saves validate/migrate without throwing and report stable path-based diagnostics.
- [ ] The generated world is reachable and supports the complete demo route.
- [ ] Six original procedural creatures render distinctly with zero required asset files.
- [ ] The runnable starter completes explore → talk → encounter → fight → catch → level → heal → save → reload.
- [ ] Repeated and restored runs produce identical transcripts, states, RNG cursors, trace hashes, and save hashes.
- [ ] All root, recipe, distribution, starter, and browser gates pass.
- [ ] The technical starter release is not blocked by indefinite clean-room retries: no more than three attempts occur per release cycle.
- [ ] The “in 20 minutes” video claim is used only if a recorded clean-room agent build completes the required loop in 20 minutes or less; otherwise the claim is revised or deferred explicitly.

## Explicitly out of scope

- Breeding, eggs, trading, multiplayer, online services, cloud saves, or leaderboards.
- Storage boxes, party reordering UI, move replacement UI, equipment, shops, crafting, quests, currencies, or full dex menus.
- Evolution, abilities/passives, status conditions, weather, terrain effects, double battles, trainer AI profiles, or competitive rules.
- Visible roaming creatures, stealth encounters, day/night, seasons, animated cutscenes, or open-world streaming.
- Full LDtk authoring integration, editor extensions, Aseprite assets, imported creature art, voice, or generated raster assets.
- Nintendo/Game Freak content or an attempt at frame-accurate compatibility with any commercial game.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Scope expands into a full monster RPG | Enforce the locked decisions and explicit out-of-scope list; vertical-slice gates take priority over breadth. |
| Platformer abstractions are forced into top-down gameplay | Reuse only generic leaves; keep `RpgMapDefinition`, movement, state, and renderer inside `src/rpg`. |
| Animation timing corrupts battle state | Resolve commands synchronously into typed events; presentation consumes an immutable event queue. |
| RNG changes after save/reload | Store serializable state and rules version; pin exact known vectors and mid-run continuation tests. |
| AI-authored data contains bad references | Compile and validate the whole bundle with path diagnostics before runtime. |
| Generated creatures resemble protected designs/names | Use original grammars and syllables, blacklist known names, review the six shipped outputs manually, and never ingest protected assets. |
| The demo exists but cannot be rebuilt in 20 minutes | Time-box the release cycle to three attempts; improve between attempts, then re-plan, honestly reframe, or defer the video without blocking a technically complete engine release. |
| Root barrel becomes collision-prone | Prefix public RPG types/functions and use explicit exports where wildcard exports collide. |
| Hashes appear deterministic while semantics drift | Bind traces/saves to rules version and content fingerprint; compare full state/events in addition to hashes. |

## Execution discipline

- Follow test-driven development for movement, encounters, battle math, progression, save migration, and every deterministic reducer.
- Keep design/proposal work proportional: prototype uncertain creature silhouettes and map rendering, but do not prototype already-locked pure data operations.
- Prefer small reviewable commits by milestone; do not mix cross-cutting RNG changes with renderer work.
- Preserve all existing APIs unless a separately documented breaking change is approved.
- Treat external repositories as architectural research only. Reimplement the small required mechanics under this repository’s MIT license and original naming/content.
- Keep technical completion and the marketing claim separate: a passing starter can ship after its engineering gates, but the 20-minute claim cannot ship without a passing clean-room timing test.
