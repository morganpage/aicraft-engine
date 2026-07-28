# Level Generation, Verification, and Quality — Canonical Implementation Plan

> **Status:** CANONICAL IMPLEMENTATION PLAN — approved directions consolidated; implementation not yet started.
> **Date:** 2026-07-28
> **Scope:** `src/simtest/`, `src/levelgen/`, `src/leveltest/`, and the minimum editor/runtime seams required to compose them safely.
> **Supersedes for implementation:** API sketches and implementation sequences in the procedural-generation and automated-playtesting proposals and decisions.
> **Preserves as supporting context:** the two research notes, alternative approaches, trade-off analysis, and original sign-off trail.

## 1. Purpose

Build a deterministic platformer-level pipeline that produces levels which are:

1. structurally valid;
2. correctly compiled into the runtime collision model;
3. proven beatable when the engine can produce a winning replay;
4. honest about inconclusive analysis;
5. close to a requested difficulty;
6. paced, varied, fair, and editable;
7. reproducible from a seed;
8. diagnosable when generation or verification fails.

Physics constraints are necessary but not sufficient. They prevent many obviously
impossible placements, but they do not establish that a full level is enjoyable or
even that every combined trajectory is executable by the fixed-step kernel.

The canonical pipeline is therefore:

```text
seed + config
  → macro route
  → pacing/rhythm plan
  → physics-constrained realization
  → decoration and optional branches
  → structural/runtime validation
  → static reachability analysis
  → simulation policy portfolio
  → quality scoring
  → bounded targeted repair
  → deterministic candidate selection
  → level + editor operation + verification/quality report
```

Verification is layered:

```text
src/simtest/                 generic deterministic scenario runner
    ↑
src/leveltest/               standard LevelData + platformer adapter
    ↑
consumer adapters            gravity-flip, top-down, vehicle, puzzle, etc.
```

The engine owns deterministic orchestration. Consumers own their game rules.

## 2. Document cleanup and authority

The existing documents are useful and should not be deleted. They have distinct
roles:

| Document | Role after this plan |
|---|---|
| `docs/research/procedural-level-generation.md` | Prior art and design rationale |
| `docs/research/automated-level-playtesting.md` | Prior art and verification rationale |
| `docs/design/procedural-level-generation-proposal.md` | Historical alternatives and detailed sketches |
| `docs/design/automated-level-playtesting-proposal.md` | Historical alternatives and detailed sketches |
| `docs/design/procedural-level-generation-decision.md` | Approval of the generation direction |
| `docs/design/automated-level-playtesting-decision.md` | Approval of the verification direction |
| This file | Canonical implementation contract, corrected API, phases, and acceptance criteria |

When documents disagree, this plan wins for implementation. Once the modules ship,
`docs/api-surface.md` and source code become the public API authority.

Recommended reading order:

1. This plan.
2. The two decision files.
3. The research notes when design rationale is needed.
4. The proposals only when investigating alternatives or rejected trade-offs.

## 3. Terminology and truthfulness rules

The implementation must keep these concepts separate:

- **Valid:** `validateLevel` reports no error-severity diagnostics.
- **Runtime-ready:** compilation produces the intended collision surfaces, spawn,
  and moving-platform descriptors.
- **Statically reachable:** an abstract reachability graph contains a route.
- **Proven success:** a generic simulation trace reaches the adapter's success
  outcome under authoritative fixed-step rules.
- **Proven beatable:** the platformer adapter maps proven success to a winning
  `Replay` and configured win condition.
- **Proven unreachable:** a sound over-approximation contains no possible route,
  or the level is invalid in a way that makes completion impossible.
- **Inconclusive:** analysis or bounded policies did not prove either result.
- **High quality:** the level passes hard gates and scores well against explicit
  pacing, fairness, variety, exploration, and difficulty metrics.

Required wording:

- A successful generic trace is evidence of scenario success; a winning platformer
  replay is evidence of beatability.
- Bot exhaustion is not evidence of impossibility.
- Static failure is only `proven-unreachable` if the static model is a documented
  over-approximation for every mechanic used by the level.
- Unsupported mechanics, including time-varying surfaces that are not modeled,
  produce `inconclusive`, not `proven-unreachable`.
- Hashes are deterministic fingerprints, not cryptographic proofs.

## 4. Consolidated architecture

The three generation approaches are stages rather than competitors:

### 4.1 Path-first macro layout

Use a Spelunky-style path graph to establish:

- start and exit;
- critical-path ordering;
- optional branches;
- key/lock ordering;
- secret or reward locations;
- recovery routes;
- route length and target completion time.

The path graph is plain serializable data. It must exist before geometry so later
stages can preserve progression intent.

### 4.2 Rhythm and pacing plan

Translate the route into gameplay beats such as:

- `introduce`;
- `run`;
- `jump`;
- `precisionJump`;
- `dash`;
- `rest`;
- `reward`;
- `branch`;
- `climax`;
- `release`.

Every level receives an intensity curve rather than one constant difficulty.
The default curve is:

```text
introduction → build-up → rest → escalation → climax → release
```

The same macro route may realize several rhythm plans, and the same rhythm plan may
realize several geometries.

### 4.3 Physics-constrained realization

Realize beats using the authoritative `PlatformerConfig`, player dimensions, and
fixed timestep. Placement checks must evaluate the joint trajectory, not independent
maximum horizontal and vertical scalars.

Checks include:

- takeoff region width;
- landing region width;
- player body width and height;
- horizontal and vertical displacement together;
- full-arc collision and ceiling clearance;
- fixed-timestep integration;
- jump hold/cutoff assumptions;
- dash and double-jump budgets;
- passthrough behavior;
- moving-platform support;
- a configurable safety margin.

The simple formulas
`2 * moveSpeed * timeToApex` and `apexHeight` may be exposed as estimates, but they
must not be described as proof of traversability.

### 4.4 Motif realization

Geometry should be constructed from a small curated motif catalog rather than
unrelated platform placements. Initial motifs:

- safe introductory jump;
- stair ascent/descent;
- short gap series;
- wide landing after a hard jump;
- drop with recovery platform;
- hazard corridor;
- moving-platform transfer;
- optional risky collectible;
- key detour;
- pre-exit climax.

Each motif declares:

- compatible beats;
- required mechanics;
- input and output anchors;
- intensity range;
- minimum safety margin;
- optional variants;
- static-analysis support level.

### 4.5 Generic simulation verification

`leveltest` must not assume that every consumer's authoritative action is a
`PlatformerInput`. Games may add gravity flips, room transitions, checkpoint
respawns, switches, vehicles, or other deterministic mechanics outside the
platformer kernel.

Add a lower-level `src/simtest/` module that knows nothing about `LevelData`,
`PlatformerState`, gravity, rooms, enemies, or collectibles. It only knows how to:

- create a deterministic initial state;
- ask a supplied policy for an action;
- advance a supplied adapter by one fixed tick;
- inspect a supplied outcome;
- enforce tick and policy budgets;
- record a serializable action trace;
- replay and fingerprint that trace;
- return structured diagnostics;
- distinguish demonstrated success from inconclusive exhaustion.

`src/leveltest/` becomes the shipped convenience adapter for conventional platformer
levels. It compiles `LevelData`, owns the collectible save, advances moving platforms,
uses `PlatformerInput`, and combines generic scenario runs with static reachability.

Consumer games own their adapters. For example, a gravity-flip game owns:

- its full simulation state, including gravity direction and current room;
- its action type, such as `{ moveX, flip }`;
- room transitions;
- enemy and hazard advancement;
- checkpoint respawn;
- rescue or puzzle completion rules.

| Engine (`simtest`) owns | Consumer adapter owns |
|---|---|
| Fixed-tick orchestration and budgets | Complete authoritative gameplay state |
| Policy execution | Action type and available actions |
| Trace recording, playback, and fingerprints | World/scenario fingerprint |
| Success versus inconclusive semantics | Stepping, death, respawn, and completion |
| Callback-error diagnostics | Game-specific summaries and quality metrics |

Those concepts must not be hard-coded into `simtest`. A generic world-graph or
gravity-flip helper should move into the engine only after a second consumer
demonstrates the same reusable contract.

**Reference consumer — Flipside:** `games/flipside.md` is the first validation case
for this boundary. Its consumer adapter should be able to model:

- `{ moveX, flip }` actions with no jump;
- positive and negative gravity controllers;
- six room IDs and reciprocal transitions;
- static spikes and time-varying shuttle hazards;
- gravity-preserving checkpoints and respawn;
- the direct rescue route and optional trinket route;
- a 60-tick rescue completion condition.

The engine acceptance fixture may use a reduced two-room gravity-flip scenario so
`simtest` does not depend on game code. The full Flipside adapter remains in the
Flipside project. Screenshot review, terrain motifs, player orientation, music, and
human fun assessment remain outside simulation verification.

## 5. Prerequisite seam corrections

Implementation must not begin with `generateLevel` until these seams are corrected.

### 5.1 Canonical generated-tile semantics

`compileLevel(level)` intentionally treats tiles as empty when no `tileTypeMap` is
provided. Generated levels therefore need explicit, serializable tile semantics.

```ts
export interface GeneratedTileSemantics {
  /** Values compiled as fully solid. */
  readonly solid: readonly number[];
  /** Values compiled as one-way passthrough. */
  readonly passthrough: readonly number[];
}

export function createTileTypeMap(
  semantics: Readonly<GeneratedTileSemantics>,
): (value: number) => TileType;
```

`GeneratedLevel` carries `tileSemantics`, and the module provides:

```ts
export function compileGeneratedLevel(
  generated: GeneratedLevel,
  options?: Omit<CompileLevelOptions, 'tileTypeMap'>,
): CompiledLevel;
```

This preserves `compileLevel`'s existing entity-only default while making generated
levels safe by default.

All level-test entry points accept compile options or a compiled level. They must
never silently analyze a tile-authored level as though its tiles were empty.

### 5.2 Editor replacement operation

Existing editor operations cannot reproduce arbitrary generated levels because they
cannot change:

- level dimensions;
- tile-grid dimensions;
- tile size;
- level identity/name;
- all top-level metadata;
- `nextEntityId`.

Add one snapshot-friendly operation:

```ts
type EditorOperation =
  | ExistingEditorOperations
  | {
      readonly type: 'replaceLevel';
      readonly level: LevelData;
      readonly label: string;
    };
```

`applyOp` validates and defensively clones the replacement. Existing snapshot history
then provides one-step undo/redo without nested batch operations.

The generator returns a singular editor operation:

```ts
export interface GeneratedLevel {
  readonly level: LevelData;
  readonly editorOp: Extract<EditorOperation, { readonly type: 'replaceLevel' }>;
  readonly tileSemantics: GeneratedTileSemantics;
  readonly report: GenerationReport;
}
```

Required invariant:

```ts
applyOp(createEditorState(base), generated.editorOp).level
  deep-equals generated.level
```

This invariant holds independently of `base`.

### 5.3 Empty editor scaffold

An object with no entities is not valid under the current validator, which requires
one spawn entity and at least one exit. Rename the proposed helper:

```ts
export function createLevelScaffold(
  options?: LevelScaffoldOptions,
): LevelData;
```

Its documentation must say that it is an editor scaffold and may be structurally
invalid until authored. If a valid starter level is needed, provide a separate:

```ts
export function createMinimalValidLevel(
  options?: MinimalLevelOptions,
): LevelData;
```

The valid helper includes a spawn entity, an exit entity, supporting ground, coherent
top-level spawn coordinates, and the correct `nextEntityId`.

### 5.4 One physics source of truth

Remove separate `jumpConfig` fields from generation/test configuration when a
`PlatformerConfig` is already present. The authoritative jump config is always:

```ts
runtime.compileOptions.config.jump
```

This prevents static analysis and simulation from evaluating different physics.

### 5.5 Generic simulation-adapter seam

The generic seam belongs in the engine because deterministic orchestration, bounded
policy execution, traces, fingerprints, and honest result semantics are reusable.
Game rules remain in consumer code.

The adapter must be pure and deterministic by contract:

```ts
export interface SimulationAdapter<TState, TAction> {
  /** Stable adapter family identifier, e.g. "platformer-level". */
  readonly id: string;
  /** Adapter behavior version. Bump when stepping or outcome semantics change. */
  readonly version: number;
  /** Fingerprint binding traces to the exact world/config being tested. */
  readonly scenarioFingerprint: string;

  createInitialState(seed: number): TState;

  actions(
    state: Readonly<TState>,
  ): readonly TAction[];

  step(
    state: Readonly<TState>,
    action: Readonly<TAction>,
    fixedDt: number,
  ): TState;

  outcome(
    state: Readonly<TState>,
  ): 'running' | 'success' | 'failure';

  /** Optional stable search/deduplication key. */
  stateKey?(
    state: Readonly<TState>,
  ): string;

  /** Optional canonical-JSON summary for reports and quality metrics. */
  summarize?(
    state: Readonly<TState>,
  ): Readonly<Record<string, unknown>>;
}
```

The engine cannot enforce callback purity through TypeScript. It documents the
contract, catches callback failures, and converts them into `inconclusive`
diagnostics. It never turns a thrown callback, invalid action, tick-budget
exhaustion, or policy stop into proof that a scenario is impossible.

`TAction` must be canonical-JSON serializable. `TState` need not be serialized by the
generic trace because the adapter recreates it from the seed and bound scenario.

### 5.6 Win-condition signature

The bot owns a collectible save from tick zero, so every win condition receives it:

```ts
export type WinCondition = (
  state: PlatformerState,
  entities: readonly LevelEntity[],
  save: Readonly<CollectibleSave>,
) => boolean;
```

Two-argument predicates such as `reachedExit` remain assignable because they may
ignore the third argument. Predicates requiring collection state are now type-safe.

### 5.7 Bounded dimensions

Generation must validate `cols * rows` before allocating. Use a named maximum aligned
with runtime compilation:

```ts
export const MAX_GENERATED_CELLS = 1_000_000;
```

Oversized requests degrade to a documented bounded value or return a diagnostic.
Tests must not attempt to allocate a `10000 * 10000` grid.

## 6. Canonical public API

Names may change during implementation review, but the semantics below are required.

### 6.1 Blueprint and generation

```ts
export interface LevelGenConfig {
  readonly id?: string;
  readonly name?: string;
  readonly cols?: number;
  readonly rows?: number;
  readonly tileSize?: number;
  readonly difficulty?: number;
  readonly candidateCount?: number;
  readonly maxRepairPasses?: number;
  readonly entityIdStart?: EntityId;
  readonly tileSemantics?: Readonly<GeneratedTileSemantics>;
  readonly platformerConfig?: Readonly<PlatformerConfig>;
  readonly playerWidth?: number;
  readonly playerHeight?: number;
  readonly fixedDt?: number;
  readonly qualityWeights?: Partial<QualityWeights>;
}

export interface LevelBlueprint {
  readonly version: 1;
  readonly route: RouteGraph;
  readonly pacing: readonly PacingBeat[];
  readonly requiredMechanics: readonly RequiredMechanic[];
  readonly targetDifficulty: number;
}

export interface GenerationReport {
  readonly version: 1;
  readonly seed: number;
  readonly candidateIndex: number;
  readonly repairs: readonly RepairRecord[];
  readonly verification: VerificationResult;
  readonly quality: LevelQualityReport;
  readonly diagnostics: readonly GenerationDiagnostic[];
}

export function generateBlueprint(
  seed: number,
  config?: LevelGenConfig,
): LevelBlueprint;

export function realizeBlueprint(
  seed: number,
  blueprint: Readonly<LevelBlueprint>,
  config?: LevelGenConfig,
): GeneratedLevel;

export function generateLevel(
  seed: number,
  config?: LevelGenConfig,
): GeneratedLevel;
```

`generateLevel` is the ergonomic entry point. The two-stage functions remain public
for consumers that want to author or inspect blueprints.

### 6.2 Generic simulation testing

`src/simtest/` exports the reusable orchestration layer:

```ts
export type SimulationOutcome = 'running' | 'success' | 'failure';

export type SimulationTermination =
  | 'success'
  | 'failure'
  | 'tick-budget'
  | 'policy-stop'
  | 'adapter-error';

export interface SimulationPolicyContext<TAction> {
  readonly tick: number;
  readonly fixedDt: number;
  readonly seed: number;
  readonly actions: readonly TAction[];
}

export type SimulationPolicy<TState, TAction> = (
  state: Readonly<TState>,
  context: Readonly<SimulationPolicyContext<TAction>>,
) => TAction | undefined;

export interface SimulationTrace<TAction> {
  readonly version: 1;
  readonly adapterId: string;
  readonly adapterVersion: number;
  readonly scenarioFingerprint: string;
  readonly seed: number;
  readonly fixedDt: number;
  readonly actions: readonly TAction[];
}

export interface SimulationRunResult<TAction> {
  readonly version: 1;
  readonly termination: SimulationTermination;
  readonly ticks: number;
  readonly trace: SimulationTrace<TAction>;
  readonly summary?: Readonly<Record<string, unknown>>;
  readonly diagnostics: readonly SimulationDiagnostic[];
}

export interface ScenarioVerificationResult<TAction> {
  readonly version: 1;
  readonly status: 'proven-success' | 'inconclusive';
  readonly runs: readonly SimulationRunResult<TAction>[];
  readonly winningTrace?: SimulationTrace<TAction>;
  readonly winningTraceHash?: number;
  readonly diagnostics: readonly SimulationDiagnostic[];
}

export interface ScenarioTestConfig<TState, TAction> {
  readonly seed?: number;
  readonly fixedDt?: number;
  readonly maxTicks?: number;
  readonly policies: readonly SimulationPolicy<TState, TAction>[];
}

export interface SimulationPlaybackResult<TState> {
  readonly valid: boolean;
  readonly state?: TState;
  readonly outcome?: SimulationOutcome;
  readonly diagnostics: readonly SimulationDiagnostic[];
}

export function verifyScenario<TState, TAction>(
  adapter: SimulationAdapter<TState, TAction>,
  config: ScenarioTestConfig<TState, TAction>,
): ScenarioVerificationResult<TAction>;

export function playSimulationTrace<TState, TAction>(
  adapter: SimulationAdapter<TState, TAction>,
  trace: SimulationTrace<TAction>,
): SimulationPlaybackResult<TState>;

export function simulationTraceHash<TAction>(
  trace: SimulationTrace<TAction>,
): number;
```

Rules:

- `verifyScenario` requires at least one consumer- or adapter-supplied policy.
- A policy action must canonically equal one of the adapter's offered actions for
  that tick; any other action stops that run with an inconclusive diagnostic.
- A successful run returns `proven-success` and a winning trace.
- Failed paths, policy stops, invalid callbacks, and tick exhaustion produce
  `inconclusive` unless another policy succeeds.
- `playSimulationTrace` rejects adapter id/version/fingerprint mismatches through a
  diagnostic result rather than replaying against the wrong world.
- `simulationTraceHash` uses the existing `canonicalize` + `fnv1a` fingerprint
  pattern.
- `SimulationTrace` is separate from the existing platformer `Replay`; do not
  genericize or break the shipped `Replay` API.
- The generic module has zero imports from `platformer/`, `level/`, `editor/`,
  `collectibles/`, or any consumer game.

### 6.3 Platformer-level verification

```ts
export type VerificationStatus =
  | 'proven-beatable'
  | 'proven-unreachable'
  | 'inconclusive';

export interface LevelTestConfig {
  readonly compileOptions?: Readonly<CompileLevelOptions>;
  readonly fixedDt?: number;
  readonly maxTicks?: number;
  readonly policies?: readonly BotPolicy[];
  readonly seed?: number;
  readonly winCondition?: WinCondition;
  readonly verifySoftlocks?: boolean;
}

export interface VerificationResult {
  readonly version: 1;
  readonly status: VerificationStatus;
  readonly structural: ValidationResult;
  readonly reachability: ReachabilityResult;
  readonly scenario: ScenarioVerificationResult<PlatformerInput>;
  readonly winningReplay?: Replay;
  readonly winningReplayHash?: number;
  readonly diagnostics: readonly VerificationDiagnostic[];
}

export function verifyLevel(
  level: LevelData,
  config?: LevelTestConfig,
): VerificationResult;

export function verifyCompiledLevel(
  level: LevelData,
  compiled: CompiledLevel,
  config?: Omit<LevelTestConfig, 'compileOptions'>,
): VerificationResult;
```

Static reachability and individual bot simulation functions remain separately
exported for editors and diagnostics. `verifyLevel` is the canonical combined entry
point. Its platformer adapter maps a successful generic action trace to the existing
`Replay` representation so current replay consumers remain compatible.

### 6.4 Quality

```ts
export interface QualityWeights {
  readonly pacing: number;
  readonly variety: number;
  readonly fairness: number;
  readonly exploration: number;
  readonly difficultyFit: number;
  readonly readability: number;
}

export interface LevelQualityReport {
  readonly version: 1;
  readonly score: number;
  readonly pacing: number;
  readonly variety: number;
  readonly fairness: number;
  readonly exploration: number;
  readonly difficultyFit: number;
  readonly readability: number;
  readonly measuredDifficulty: number;
  readonly criticalPathTicks?: number;
  readonly safetyMargins: readonly JumpSafetyMetric[];
  readonly diagnostics: readonly QualityDiagnostic[];
}

export function evaluateLevelQuality(
  level: LevelData,
  verification: VerificationResult,
  config?: QualityConfig,
): LevelQualityReport;
```

All component scores are finite values in `[0, 1]`. The overall score is a normalized
weighted mean. Hard-gate failures cannot be hidden by a high soft score.

## 7. Deterministic candidate search

The largest practical quality gain comes from generating several candidates and
selecting the best.

Default behavior:

1. derive `candidateCount` sub-seeds from the root seed using a named salt;
2. generate each candidate independently;
3. reject candidates failing hard gates;
4. verify supported candidates;
5. evaluate quality;
6. repair bounded, local defects;
7. rank candidates;
8. select using stable tie-breaking.

Suggested v1 default:

```ts
export const DEFAULT_CANDIDATE_COUNT = 8;
export const DEFAULT_MAX_REPAIR_PASSES = 2;
```

Determinism requirements:

- candidate order is ascending index;
- each candidate uses an independently derived seed;
- repair pass seeds are derived from candidate seed plus pass index;
- object and entity traversal use stable ordering;
- ties resolve by candidate index;
- no wall-clock, ambient randomness, or iteration-order dependence.

Candidate search is bounded. A configuration cannot request unbounded retries.

## 8. Hard gates

A candidate is eligible for final selection only when:

1. `validateLevel` succeeds;
2. runtime compilation contains the intended tile/entity solids;
3. the spawn is not intersecting blocking geometry;
4. at least one non-trap exit exists;
5. the critical path is represented by the geometry;
6. every required mechanic is enabled in the authoritative config;
7. no required jump has a safety margin below the configured minimum;
8. verification is `proven-beatable` for shareable/shipped output.

Editor preview mode may return an `inconclusive` candidate with diagnostics. Production
generation defaults to requiring `proven-beatable`.

## 9. Quality model

### 9.1 Pacing

Measure:

- agreement with the target intensity curve;
- length of uninterrupted high-intensity runs;
- recovery space after difficult actions;
- challenge escalation toward the climax;
- release before the exit;
- frequency of meaningful decisions.

### 9.2 Variety

Measure:

- motif distribution;
- repeated geometry fingerprints;
- repeated action sequences;
- height-profile variation;
- hazard-type distribution;
- route-shape similarity;
- similarity to recently generated levels when an archive is provided.

The generator must not maximize variety by producing incoherent noise. Variety is
scored within the blueprint's theme and pacing constraints.

### 9.3 Fairness

Measure:

- jump timing tolerance;
- landing width;
- hazard reaction time;
- visibility before commitment;
- recovery after non-fatal mistakes;
- absence of hazards on blind landings;
- safe spawn and exit regions;
- required versus optional precision.

### 9.4 Exploration

Measure:

- number and usefulness of optional branches;
- rewards per optional risk;
- route reconvergence;
- collectible placement;
- secret-area discoverability;
- amount of forced backtracking.

### 9.5 Difficulty fit

Measure actual rather than intended difficulty:

- bot completion rates by policy;
- required action count;
- precision margins;
- dash/double-jump dependency;
- hazard density along the critical path;
- longest challenge chain;
- expected recovery cost.

Difficulty is a target band, not a value that simply increases every gap and hazard.

### 9.6 Readability

Measure:

- clear critical-path direction;
- visual separation between ground, hazard, reward, and exit;
- camera/lookahead compatibility;
- absence of geometry outside useful play space;
- consistent motif language.

Renderer-specific aesthetic scoring is a later extension, but semantic readability
belongs in v1.

## 10. Simulation policy portfolio

A single greedy bot is insufficient. `simtest` executes supplied policies but ships
no gameplay-specific default because it cannot know what an action means.
`leveltest` ships a small deterministic platformer portfolio:

| Policy | Purpose |
|---|---|
| `cautious` | Prefers wide landings and avoids hazards |
| `direct` | Follows the shortest route to the exit |
| `collector` | Visits optional collectibles before exiting |
| `speed` | Minimizes completion time |
| `search` | Bounded exploration for non-obvious routes |

V1 may ship the first three and defer the bounded search policy if necessary.

Consumer adapters ship their own policies. A gravity-flip game, for example, may
provide direct-route, cautious-timing, collector, and exploration policies over:

```ts
type GravityFlipAction = {
  readonly moveX: -1 | 0 | 1;
  readonly flip: boolean;
};
```

Its consumer-owned simulation state may contain `roomId`, `gravitySign`, enemies,
checkpoint state, collection state, and a rescue/puzzle timer. Keeping all of that
inside `TState` lets the generic runner verify multi-room scenarios without adding a
Flipside-specific room or checkpoint model to the engine.

Interpretation:

- any successful generic trace → `proven-success`;
- the platformer adapter maps a successful trace/replay to `proven-beatable`;
- every bounded policy failing → `inconclusive`;
- only a sound static proof may return `proven-unreachable`;
- large disagreement among policies is a useful difficulty/readability signal.

For the standard platformer adapter, deterministic low-skill input perturbations may
be applied:

- delayed jump;
- shortened jump hold;
- slower direction changes;
- missed optional dash;
- reaction-delay ticks.

These runs inform quality; they do not replace the authoritative success replay.

## 11. Static reachability requirements

The reachability graph must declare its abstraction mode:

```ts
export type ReachabilityConfidence =
  | 'sound-over-approximation'
  | 'heuristic'
  | 'unsupported';
```

Rules:

- A sound over-approximation may prove unreachable when no path exists.
- A heuristic graph may suggest reachable/unreachable but cannot prove failure.
- A level using unsupported mechanics returns `unsupported`/`inconclusive`.
- Moving platforms are unsupported until time-varying reachability is implemented,
  unless simulation is run without using static analysis as a rejecting gate.
- Player dimensions and tile semantics must match compilation.
- Reachability must accept a `CompiledLevel` to avoid recompiling with different
  options.

The graph is still valuable for editor feedback, diagnostics, coverage, and repair
even when it is not a proof system.

## 12. Targeted repair

Repair operates on diagnostics, not blind regeneration. Initial repairs:

| Diagnostic | Repair |
|---|---|
| Unsafe gap | Shorten gap or widen landing |
| Ceiling collision | Raise ceiling or lower arc |
| Missing recovery | Add recovery platform |
| Blind hazard landing | Move hazard or add warning space |
| Excess challenge chain | Insert rest motif |
| Repeated motif | Substitute compatible motif |
| Floating reward | Snap reward to supported route |
| Unreachable branch | Move branch anchor or remove branch |
| Difficulty above target | Increase margins/reduce hazards |
| Difficulty below target | Introduce optional precision or richer rhythm |

Repair constraints:

- no more than `maxRepairPasses`;
- modify the smallest affected region;
- preserve the critical path and blueprint intent;
- rerun validation, verification, and scoring after each pass;
- record every repair in `GenerationReport`;
- retain the pre-repair candidate only if it scores better and passes hard gates.

## 13. AI/LLM boundary

An LLM may optionally propose a serializable `LevelBlueprint`:

```json
{
  "version": 1,
  "theme": "ascending escape",
  "pacing": ["introduce", "build", "rest", "chase", "climax", "release"],
  "requiredMechanics": ["jump", "dash"],
  "optionalBranches": 2,
  "targetDifficulty": 0.55
}
```

An LLM must not be trusted to produce final tile coordinates without deterministic
realization and verification. The engine validates all blueprint fields, clamps
unsupported requests, and owns geometry, IDs, physics, compilation, and replays.

The core module remains useful with no model or network dependency.

## 14. Implementation phases

### Phase 0 — Contract correction

- Add this plan and mark it canonical.
- Mark prior proposals as historical design input.
- Add decision amendments pointing here.
- Correct `docs/api-surface.md` status language.
- Remove claims that independent scalar constraints prove solvability.
- Replace binary failure terminology with tri-state verification.
- Establish `simtest` as the generic foundation and `leveltest` as its platformer
  adapter.

Exit criterion: no implementation-facing document contradicts this plan without an
explicit historical/non-canonical label.

### Phase 1 — Runtime/editor foundations

- Add `GeneratedTileSemantics`.
- Add `createTileTypeMap`.
- Add `compileGeneratedLevel`.
- Add `replaceLevel` editor operation.
- Add `createLevelScaffold` and `createMinimalValidLevel`.
- Add cross-pillar tests for tile collision and editor replacement.

Exit criterion: a generated fixture compiles with real tile solids and can replace,
undo, and redo an arbitrary editor level byte-for-byte.

### Phase 2 — Generic simulation-test foundation

- Create `src/simtest/types.ts`, `runner.ts`, `trace.ts`, and `index.ts`.
- Implement generic adapter and policy contracts.
- Implement fixed-tick policy execution with bounded ticks.
- Implement `SimulationTrace`, playback, and fingerprints.
- Catch adapter/policy failures as diagnostics.
- Ensure policy exhaustion never becomes proof of impossibility.
- Add a minimal non-platformer fixture with a custom action outside
  `PlatformerInput`.

Exit criterion: the same adapter, scenario, seed, and policy produce a byte-identical
trace and final state; a changed adapter version or scenario fingerprint invalidates
playback; the module has zero platformer or level imports.

### Phase 3 — Trajectory and reachability

- Implement kernel-aligned trajectory sampling.
- Add conservative safety margins.
- Build surface extraction from an already compiled level.
- Add reachability confidence.
- Return unsupported/inconclusive for unmodeled mechanics.
- Add editor-friendly diagnostics.

Exit criterion: trajectory results agree with fixed-step simulation across a
property-test matrix, within documented conservative bounds.

### Phase 4 — Blueprint and baseline realization

- Implement route graph generation.
- Implement default pacing curve.
- Add initial motif catalog.
- Realize blueprints using authoritative physics.
- Generate complete valid `LevelData`.

Exit criterion: every generated level passes structural/runtime hard gates across a
large deterministic seed corpus.

### Phase 5 — Platformer-level verification

- Implement required-save `WinCondition`.
- Implement the standard `LevelData`/platformer `SimulationAdapter`.
- Implement static analysis over compiled geometry.
- Implement initial bot policies.
- Record generic winning traces and map successful platformer traces to the existing
  `Replay` type.
- Implement tri-state `VerificationResult`.

Exit criterion: hand-authored solvable fixtures produce winning replays; known
unsupported or bot-hard fixtures return `inconclusive` rather than false failure;
existing replay consumers remain source-compatible.

### Phase 6 — Quality and candidate selection

- Implement component quality metrics.
- Generate eight deterministic candidates by default.
- Rank with stable tie-breaking.
- Implement two bounded repair passes.
- Add generation reports and diagnostics.

Exit criterion: selected candidates outperform candidate zero on the agreed fixture
corpus without reducing determinism or beatability.

### Phase 7 — Diversity and calibration

- Add optional novelty archive/fingerprint comparison.
- Calibrate score bands against hand-rated fixtures.
- Add optional deterministic low-skill perturbation runs.
- Document an aggregate telemetry adapter boundary for consumer games.

Exit criterion: difficulty bands and quality ordering correlate with fixture ratings
closely enough to support production presets.

## 15. Test strategy

### Unit tests

- seed derivation and stable ordering;
- generic adapter execution and outcome handling;
- generic policy stop/tick-budget behavior;
- simulation trace playback and fingerprint mismatch diagnostics;
- thrown adapter/policy callbacks become inconclusive diagnostics;
- tile semantics and compile wrapper;
- `replaceLevel` cloning, undo, and redo;
- valid versus scaffold factories;
- trajectory samples;
- rhythm and intensity calculations;
- motif preconditions;
- score normalization;
- repair selection;
- win-condition assignability and behavior.

### Property tests

- same seed/config → byte-identical output;
- different candidate sub-seeds remain deterministic;
- all numeric report fields are finite;
- every score lies in `[0, 1]`;
- no generated grid exceeds `MAX_GENERATED_CELLS`;
- realized motifs preserve anchor invariants;
- safety estimates never exceed observed kernel capability in the conservative mode;
- editor replacement reproduces the generated level from any base;
- compile wrapper produces at least the expected solid coverage;
- same adapter/scenario/seed/policy → byte-identical generic trace;
- changing adapter version or scenario fingerprint invalidates trace playback;
- generic policy failure/exhaustion never maps to a proof of impossibility;
- `simtest` action traces round-trip through canonical JSON;
- bot failure never maps directly to `proven-unreachable`;
- unsupported mechanics never produce a false proof.

### Golden fixtures

Maintain:

- minimal flat level;
- simple gap;
- ascending route;
- optional collectible branch;
- key-before-exit route;
- moving-platform level;
- minimal consumer-adapter scenario whose action includes a gravity flip and whose
  state crosses two rooms;
- intentionally impossible level;
- bot-hard but human-solvable/inconclusive level;
- unsafe near-limit jump;
- representative generated levels at low, medium, and high difficulty.

Golden replay hashes are regression fingerprints. Update them only with an explicit
physics or policy-version decision.

Generic simulation-trace hashes are separately versioned by adapter id, adapter
version, and scenario fingerprint. Updating a consumer's stepping or outcome rules
must invalidate its old traces intentionally.

### Cross-pillar tests

- `custom SimulationAdapter → verifyScenario → playSimulationTrace`;
- `platformer SimulationAdapter → verifyScenario → Replay`;
- `generateLevel → compileGeneratedLevel → stepPlatformer`;
- `generateLevel → applyOp(replaceLevel) → undo → redo`;
- `generateLevel → verifyLevel → evaluateLevelQuality`;
- collectibles update the save passed to `WinCondition`;
- moving platforms use the same advanced solids and displacement provider as the
  consumer runtime;
- generated tile semantics are identical in compiler, reachability, and simulation.

## 16. Benchmarks and budgets

Measure rather than promise unverified timings.

Required benchmark dimensions:

- generic runner overhead per tick;
- simulation trace recording and hashing;
- grid size and surface count;
- candidate count;
- motif count;
- static graph construction;
- simulation ticks per policy;
- repair passes;
- total generation latency;
- peak allocated cells and memory proxy;
- selected-candidate improvement over candidate zero.

Initial budgets for a typical `60 * 15` level on the project benchmark machine:

| Stage | Target |
|---|---:|
| Generic runner overhead | `< 10%` over direct adapter stepping |
| One blueprint + realization | `< 2 ms` |
| Static analysis | `< 2 ms` |
| One 3600-tick policy run | `< 100 ms` |
| Eight-candidate generation without simulation | `< 30 ms` |
| Full eight-candidate quality selection | `< 1 s` |

These are targets, not API guarantees. Record actual hardware/runtime with results.

## 17. Acceptance criteria

V1 is complete only when:

1. public API and documentation use the corrected contracts;
2. `simtest` has no platformer, level, editor, collectible, or consumer-game imports;
3. a non-platformer action/state fixture can be verified and replayed through
   `SimulationAdapter`;
4. generic policy exhaustion and callback failure remain inconclusive;
5. existing platformer `Replay` APIs remain backward-compatible;
6. generated tile terrain collides without consumer guesswork;
7. generated levels can replace arbitrary editor levels with one undoable operation;
8. generation is byte-deterministic across the committed seed corpus;
9. no binary `unbeatable` result is inferred solely from bot exhaustion;
10. every production-selected level has a winning replay;
11. all required trajectories include a configurable safety margin;
12. candidate selection produces stable ordering;
13. quality reports explain component scores and repairs;
14. low/medium/high presets produce statistically distinct measured difficulty bands;
15. unsupported moving-platform/static cases are labeled inconclusive;
16. benchmarks and golden fixtures are committed.

## 18. Deferred work

- time-expanded moving-platform reachability;
- MCTS/A* or learned policies;
- MAP-Elites or other full quality-diversity search;
- telemetry-backed automatic weight tuning;
- vertical/inverted-gravity generation;
- multiplayer/co-op reachability;
- combat-aware enemy simulation;
- a generic world-graph helper (promote only after a second consumer);
- engine-owned gravity-flip/checkpoint helpers (promote only after demonstrated reuse);
- renderer-level aesthetic scoring;
- online LLM blueprint generation.

The API should leave room for these features without pretending they exist in v1.

## 19. Immediate work order

1. Correct documentation authority and statuses.
2. Implement tile semantics and `compileGeneratedLevel`.
3. Implement `replaceLevel`.
4. Add scaffold/minimal-valid factories.
5. Implement generic `simtest` adapters, policies, traces, playback, and fingerprints.
6. Prove the seam with a non-platformer gravity-flip/multi-room fixture.
7. Implement trajectory sampling and its kernel agreement tests.
8. Implement route/rhythm/motif blueprint generation.
9. Implement the platformer adapter, tri-state verification, and policy portfolio.
10. Implement quality scoring.
11. Add candidate search and targeted repair.
12. Benchmark, calibrate, and ship.

Do not start with the platformer bot or candidate search before the compilation,
editor, and generic simulation seams are correct; otherwise tests will validate
geometry that the runtime does not actually use or bake one game's action model into
the reusable verification core.
