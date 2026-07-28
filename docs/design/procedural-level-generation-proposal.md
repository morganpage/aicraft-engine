# API Proposal: Procedural Level Generation

> Target pillar: Pillar 2 (Level Generation). Module: `src/levelgen/`.
> Builds on research: `docs/research/procedural-level-generation.md`.
> Status: HISTORICAL DESIGN INPUT — direction approved, but these API sketches are
> superseded for implementation by
> `docs/design/level-generation-quality-implementation-plan.md`.
> Preserve this document for alternatives, rationale, and trade-offs; do not
> implement its signatures without applying the canonical plan's corrections.

## Consumer Need

Clone-to-Jest games (Spitekeep/IMP, future siblings) need many short, deterministic, solvable platformer levels without per-level manual authoring. The library already ships `LevelData`, `validateLevel`, `compileLevel`, editor operations (`EditorOperation[]`), and a seeded RNG (`mulberry32`). A level generator plugs into this pipeline: `generate → validate → compile → play`. The same seed must always produce the same level (daily-seed / shareable levels). Difficulty must be a single knob (0..1) that maps to gap widths, hazard density, and rhythm complexity.

---

## Approach A: Path-First Chunk Assembler (Spelunky Pattern)

**Source pattern:** Spelunky's three-phase generation — path-first corridor, template fill, decoration overlay. Adapted from research §Pattern 1.

### Signature sketch

```ts
// In src/levelgen/types.ts
export interface LevelGenConfig {
  /** Level dimensions in tiles. */
  readonly cols: number;
  readonly rows: number;
  /** Pixel size of each tile. */
  readonly tileSize: number;
  /** Difficulty in [0, 1]. Drives gap width, hazard density. */
  readonly difficulty: number;
  /** Minimum horizontal gap between platforms (tiles). */
  readonly minPlatformWidth: number;
  /** Maximum horizontal gap between platforms (tiles). */
  readonly maxPlatformWidth: number;
  /** Fraction of off-path rooms that get decoration. */
  readonly decorationDensity: number;
  /** Enemy density in [0, 1]. 0 = none, 1 = every eligible platform. */
  readonly enemyDensity: number;
  /** Collectible density in [0, 1]. */
  readonly collectibleDensity: number;
  /** Tile value for solid ground. */
  readonly solidTile: number;
}

// In src/levelgen/generate.ts
export function generateLevel(seed: number, config?: Partial<LevelGenConfig>): LevelData;
```

### Usage example

```ts
import { mulberry32 } from 'aicraft-engine/src/rng';
import { generateLevel } from 'aicraft-engine/src/levelgen';
import { validateLevel } from 'aicraft-engine/src/level';
import { compileLevel } from 'aicraft-engine/src/platformer';

// Daily seed — same seed always produces the same level
const seed = 42;
const level = generateLevel(seed, {
  cols: 60,     // 60 tiles wide (~960px at tileSize=16)
  rows: 15,     // 15 tiles tall (~240px)
  tileSize: 16,
  difficulty: 0.4,
  solidTile: 1,
});

const result = validateLevel(level);
if (!result.valid) {
  throw new Error(`Generated level failed validation: ${JSON.stringify(result.errors)}`);
}

const compiled = compileLevel(level);
// Use compiled.staticSolids, compiled.spawn, compiled.movingPlatforms with the kernel
```

### Trade-offs

- **Ergonomics:** Excellent. One function call, one return value. Consumer spreads a partial config and gets a complete `LevelData`. Reads like `outlineRect(ctx, 10, 10, 32, 32, '#ff0000')` — obvious at the call site.
- **Determinism:** Pure. All randomness through `mulberry32`. Same `(seed, config)` → same level forever. No `Math.random`, no `Date.now()`.
- **Runtime cost:** Very low. O(cols × rows) tile writes + O(pathLength × templatePool) template copies. Sub-millisecond for a 60×15 grid.
- **Consumer complexity:** Minimal. Call `generateLevel`, pass result to `compileLevel`. No state to manage, no pipeline to wire.
- **Composition with existing API:** Direct. Returns `LevelData` which feeds straight into `validateLevel` and `compileLevel`. No adapter needed.
- **Editor integration:** Weak. To get undo/redo on a generated level, the consumer must convert `LevelData` to `EditorOperation[]` manually (emit `paintTiles` + `addEntity` ops from the generated tiles/entities). This is doable but adds consumer-side work.
- **Convention fit:** Strong. Follows the library's "pure function, config object, mutable-state-free" pattern. File name `generate.ts` matches `<module>/<thing>.ts` convention.

**What this makes easy:** Quick daily-seed levels, A/B testing with different seeds, sharing seed codes between players.

**What this makes hard:** Iterative editing of generated levels (no undo/redo for free), composing generation stages independently (the pipeline is monolithic inside `generateLevel`).

---

## Approach B: Composable Rhythm-Group Pipeline (Launchpad Pattern)

**Source pattern:** Launchpad's two-tier grammar — rhythm first, geometry second. Each stage is a separate pure function. Adapted from research §Pattern 2.

### Signature sketch

```ts
// In src/levelgen/types.ts
export interface Beat {
  readonly type: 'move' | 'jump' | 'wait';
}

export interface Rhythm {
  readonly beats: readonly Beat[];
  readonly density: number;
}

export interface RhythmConfig {
  /** Number of beats in the rhythm. */
  readonly length: number;
  /** Fraction of beats that are jumps. */
  readonly jumpFrequency: number;
  /** Fraction of beats that are waits. */
  readonly waitFrequency: number;
}

export interface RealizedSegment {
  /** Platform entities placed by this segment. */
  readonly platforms: readonly LevelEntity[];
  /** Hazard / collectible / enemy entities placed by this segment. */
  readonly hazards: readonly LevelEntity[];
  /** Horizontal cursor advance in tiles. */
  readonly advanceTiles: number;
  /** Vertical offset from the base ground line (positive = up). */
  readonly heightOffset: number;
}

export interface LevelGenConfig {
  readonly tileSize: number;
  readonly difficulty: number;
  readonly solidTile: number;
  readonly groundY: number;
}

// In src/levelgen/rhythm.ts
export function pickRhythm(rng: () => number, config: RhythmConfig): Rhythm;

// In src/levelgen/realize.ts
export function realizeRhythm(rng: () => number, rhythm: Rhythm, config: LevelGenConfig): readonly RealizedSegment[];

// In src/levelgen/assemble.ts
export function assembleLevel(
  segments: readonly RealizedSegment[],
  config: LevelGenConfig,
): LevelData;

// Convenience wrapper (Approach B)
export function generateLevel(seed: number, config?: Partial<LevelGenConfig>): LevelData;
```

**RNG flow (Approach B):** Both `pickRhythm` and `realizeRhythm` accept an `rng: () => number` (the consumer's mulberry32 instance) — NOT a raw `seed`. The consumer creates the RNG once with `mulberry32(seed)` and threads it through both stages. This avoids the original draft's inconsistency where `pickRhythm` took a `seed` but `realizeRhythm` took an `rng` (a footgun: a consumer who called `mulberry32(seed)` once for `realizeRhythm` but passed the raw `seed` to `pickRhythm` would get two independent RNG streams — rhythm and geometry would diverge, breaking the "same seed → same level" invariant). The convenience wrapper `generateLevel(seed, config)` derives a single `mulberry32(seed)` internally and threads it through both stages.

### Usage example

```ts
import { mulberry32 } from 'aicraft-engine/src/rng';
import { pickRhythm, realizeRhythm, assembleLevel } from 'aicraft-engine/src/levelgen';
import type { LevelGenConfig, RhythmConfig } from 'aicraft-engine/src/levelgen';

const seed = 42;
const rng = mulberry32(seed);

// Tier 1: Generate the rhythm (what the player does)
const rhythm = pickRhythm(rng, {
  length: 12,
  jumpFrequency: 0.4,
  waitFrequency: 0.2,
});

// Tier 2: Interpret the rhythm as geometry (what the level looks like)
const segments = realizeRhythm(rng, rhythm, {
  tileSize: 16,
  difficulty: 0.4,
  solidTile: 1,
  groundY: 13 * 16, // ground at tile row 13
});

// Assemble into a complete LevelData
const level = assembleLevel(segments, {
  tileSize: 16,
  difficulty: 0.4,
  solidTile: 1,
  groundY: 13 * 16,
});

// Same seed → same RNG → same rhythm → same segments → same level
```

### Trade-offs

- **Ergonomics:** Moderate. Three function calls instead of one. But each call is independently composable — a consumer can replace just the realization step with their own geometry interpreter.
- **Determinism:** Pure. Both `pickRhythm` and `realizeRhythm` receive the consumer's `rng` as a parameter (no internal RNG creation). Same `(seed, config)` → same RNG → same rhythm → same segments → same level. The consumer owns the RNG; the library never calls `mulberry32` internally for Approach B.
- **Runtime cost:** Low. Rhythm generation is O(length). Realization is O(length × grammarBranch). Assembly is O(totalSegments). Still sub-millisecond.
- **Consumer complexity:** Higher. Consumer must wire three stages. But each stage is independently testable and replaceable — a game that wants custom geometry can replace `realizeRhythm` while reusing `pickRhythm` + `assembleLevel`.
- **Composition with existing API:** Good. `assembleLevel` returns `LevelData` for `validateLevel` + `compileLevel`. The intermediate types (`Beat`, `Rhythm`, `RealizedSegment`) are serializable plain data.
- **Editor integration:** Weak. Same as Approach A — the final output is `LevelData`, not `EditorOperation[]`.
- **Convention fit:** Strong. Follows the library's "pure function, config object, composable stages" pattern. Matches the music sequencer's layered architecture (`theory → pattern → advance → sequencer`).

**What this makes easy:** Custom geometry interpreters (replace `realizeRhythm` for a different visual style), debugging individual stages, testing rhythm parameters independently.

**What this makes hard:** Quick one-shot generation (requires wiring three stages), editor undo/redo integration.

---

## Approach C: Physics-Constrained Editor-Ops Generator

**Source pattern:** Physics-constrained constructive assembler (research §Pattern 3) combined with editor-ops output (research §Open Question: "Should the generator emit LevelData or EditorOperation[]?"). Hybrid of Patterns 3 + 6 (ORE anchor-based assembly).

### Signature sketch

```ts
// In src/levelgen/types.ts
export interface LevelGenConfig {
  readonly cols: number;
  readonly rows: number;
  readonly tileSize: number;
  readonly difficulty: number;
  readonly solidTile: number;
  /** Starting entity counter. Defaults to DEFAULT_ENTITY_ID_START. */
  readonly entityIdStart?: number;
  /** Platformer config for physics constraint derivation. */
  readonly platformerConfig?: Readonly<PlatformerConfig>;
}

export interface GeneratedLevel {
  /** The complete LevelData (ready for compileLevel). */
  readonly level: LevelData;
  /** Editor operations that produce this level (for undo/redo). */
  readonly ops: readonly EditorOperation[];
}

// In src/levelgen/generate.ts
export function generateLevel(seed: number, config?: Partial<LevelGenConfig>): GeneratedLevel;

// Physics constraint helpers (exported for advanced consumers)
export function deriveMaxJumpDistance(config: Readonly<PlatformerConfig>): number;
export function deriveMaxStepUp(config: Readonly<PlatformerConfig>): number;
export function derivePhysicsConstraints(config: Readonly<PlatformerConfig>): PhysicsConstraints;
```

### `PhysicsConstraints` interface

```ts
// In src/levelgen/types.ts
export interface PhysicsConstraints {
  /**
   * Maximum horizontal distance (in pixels) the player can traverse in a single
   * flat-ground jump. Derived from `apexHeight`, `timeToApex`, and `moveSpeed`
   * using the apex-parameterized jump-arc math already in `src/animation/jump.ts`.
   * The generator NEVER places a gap wider than this value.
   */
  readonly maxJumpDistance: number;
  /**
   * Maximum vertical step-up (in pixels) the player can reach in a single jump.
   * Equals `apexHeight` by construction (the player is at apex height when
   * their horizontal velocity has carried them to the landing platform).
   * The generator NEVER places a step-up taller than this value.
   */
  readonly maxStepUp: number;
  /**
   * Maximum horizontal gap width (in tiles) the generator may place, derived
   * from `maxJumpDistance / tileSize` and floored to the nearest tile. Cached
   * per `generateLevel` call to avoid recomputation across placements.
   */
  readonly maxGapWidth: number;
  /**
   * Maximum vertical step-up height (in tiles), derived from `maxStepUp /
   * tileSize` and floored. Cached per `generateLevel` call.
   */
  readonly maxStepUpTiles: number;
}
```

### Return types for `deriveMaxJumpDistance` / `deriveMaxStepUp`

Both helpers return `number` (pixels, finite, non-negative). Specifically:

- `deriveMaxJumpDistance(config): number` — returns the maximum traversable horizontal distance in **pixels** for a single flat-ground jump. Closed-form: `2 * moveSpeed * timeToApex` (horizontal velocity × time to apex × 2 for the symmetric trajectory). Non-finite inputs degrade to `0` (never `NaN`, never `Infinity`).
- `deriveMaxStepUp(config): number` — returns the maximum reachable step-up height in **pixels**, equal to `config.jump.apexHeight`. Non-finite `apexHeight` degrades to `0`.

Both helpers are pure, never throw, and never mutate `config`. They accept a `Readonly<PlatformerConfig>` and degrade gracefully on missing or non-finite fields (programmer error: the consumer should pass a valid `PlatformerConfig`; the helper's job is to be defensive, not to validate).

### `emptyLevel` helper

```ts
// In src/levelgen/empty-level.ts
export interface EmptyLevelOptions {
  /** Consumer-assigned stable identifier. Defaults to `'empty'`. */
  readonly id?: string;
  /** Human-facing display name. Defaults to `'Empty Level'`. */
  readonly name?: string;
  /** Level width in pixels. Defaults to `DEFAULT_LEVEL_WIDTH` (960). */
  readonly width?: number;
  /** Level height in pixels. Defaults to `DEFAULT_LEVEL_HEIGHT` (540). */
  readonly height?: number;
  /** Pixel size of each tile. Defaults to `DEFAULT_TILE_SIZE` (16). */
  readonly tileSize?: number;
}

export function emptyLevel(opts?: EmptyLevelOptions): LevelData;
```

**Historical purpose:** Returns an editor scaffold with an empty tile grid (all zeros), no entities, and `nextEntityId: DEFAULT_ENTITY_ID_START`. It is a `LevelData`-shaped starting point for `createEditorState`, but it does **not** pass the current `validateLevel` cardinality rules because it has no spawn or exit entity. The canonical plan renames this concept to `createLevelScaffold` and separately specifies `createMinimalValidLevel`.

**Determinism:** Pure. Same `(opts)` → same `LevelData` forever. Never throws. Non-finite numeric fields degrade to the default value (no `NaN`, no `Infinity`). The returned `LevelData` is a fresh object — no shared references with any other level.

**Usage:**

```ts
import { emptyLevel } from 'aicraft-engine/src/levelgen';
import { createEditorState, applyBatch } from 'aicraft-engine/src/editor';

const editorState = createEditorState(emptyLevel({ id: 'new-level', width: 960, height: 540 }));
const next = applyBatch(editorState, generated.ops, 'Generate level (seed 42)');
```

### Usage example

```ts
import { mulberry32 } from 'aicraft-engine/src/rng';
import { generateLevel, derivePhysicsConstraints } from 'aicraft-engine/src/levelgen';
import { validateLevel } from 'aicraft-engine/src/level';
import { compileLevel } from 'aicraft-engine/src/platformer';
import { createEditorState, applyBatch } from 'aicraft-engine/src/editor';

// Generate level + editor ops
const { level, ops } = generateLevel(42, {
  cols: 60,
  rows: 15,
  tileSize: 16,
  difficulty: 0.4,
  solidTile: 1,
});

// Validate + compile as usual
const result = validateLevel(level);
if (!result.valid) throw new Error(`Invalid level: ${JSON.stringify(result.errors)}`);
const compiled = compileLevel(level);

// Or: load into editor for undo/redo
let editorState = createEditorState(emptyLevel());
editorState = applyBatch(editorState, ops, 'Generate level (seed 42)');
// Now undo/redo works on the generated level

// Advanced: inspect physics constraints
const constraints = derivePhysicsConstraints(DEFAULT_PLATFORMER_CONFIG);
// constraints.maxJumpDistance = 112 px = 7 tiles (at tileSize=16)
// constraints.maxStepUp = 48 px = 3 tiles
```

### Trade-offs

- **Ergonomics:** Good. Single call returns both `LevelData` and `EditorOperation[]`. The consumer picks which output to use. No extra wiring needed for the common case.
- **Determinism:** Pure. All randomness through `mulberry32`. Physics constraints are derived analytically from `PlatformerConfig` constants (closed-form, no simulation). Same `(seed, config)` → same ops → same level.
- **Runtime cost:** Low. Physics constraint derivation is O(1) per placement. Editor ops generation is O(entities + tiles). Applying ops to `EditorState` is O(ops × stateSize) but this is consumer-side, not generator-side.
- **Consumer complexity:** Moderate. Consumer receives `GeneratedLevel` and chooses between `level` (for direct use) and `ops` (for editor integration). The dual output adds a decision but no extra work.
- **Composition with existing API:** Excellent. `level` feeds into `validateLevel` + `compileLevel`. `ops` feeds into `applyBatch`. Physics constraints are derived from `DEFAULT_PLATFORMER_CONFIG` so the generator is automatically correct for the shipped kernel.
- **Editor integration:** Excellent. The `ops` array is a complete sequence of `paintTiles` + `addEntity` + `setSpawnPoint` operations. Applying them via `applyBatch` gives undo/redo for free. The consumer can also inspect individual ops for analytics or selective undo.
- **Convention fit:** Strong. Follows the library's "pure ops, config object, defensive never-throw" pattern. The `derivePhysicsConstraints` helper matches the `deriveJumpPhysics` internal pattern in `src/animation/jump.ts`. The `GeneratedLevel` return type is a plain data record (no closures, JSON-serializable).

**What this makes easy:** Editor integration, conservative physics-aware placement, and inspection of generation decisions. The canonical plan replaces nested batch output with a singular `replaceLevel` operation and requires verification before claiming beatability.

**What this makes hard:** Replacing individual generation stages (the pipeline is less decomposed than Approach B), custom geometry interpretation (physics constraints are baked in).

---

## Comparison Table

| Criterion | A: Path-First Chunk | B: Rhythm Pipeline | C: Physics Editor-Ops |
|---|---|---|---|
| **Ergonomics** | ★★★★☆ One call | ★★★☆☆ Three calls | ★★★★☆ One call, two outputs |
| **Determinism** | ★★★★★ Pure | ★★★★★ Pure | ★★★★★ Pure |
| **Runtime cost** | ★★★★★ Sub-ms | ★★★★★ Sub-ms | ★★★★☆ Sub-ms + op overhead |
| **Consumer complexity** | ★★★★★ Minimal | ★★★☆☆ Pipeline wiring | ★★★★☆ Dual output choice |
| **Composition w/ existing API** | ★★★★☆ Direct | ★★★★☆ Direct | ★★★★★ level + ops + physics |
| **Editor integration** | ★★☆☆☆ Manual conversion | ★★☆☆☆ Manual conversion | ★★★★★ Built-in ops |
| **Customizability** | ★★★☆☆ Config only | ★★★★★ Replace any stage | ★★★☆☆ Config only |
| **Physics guarantee** | ★★★☆☆ Chunk-based | ★★★☆☆ Grammar-based | ★★★★★ Analytic derivation |
| **Convention fit** | ★★★★★ Library pattern | ★★★★★ Music-sequencer shape | ★★★★★ Pure-ops pattern |
| **Risk** | Low (proven pattern) | Medium (more surface area) | Medium (dual output) |

## Recommendation

**Prototype Approach C first.**

The physics-constrained editor-ops generator is the strongest starting point for three reasons:

1. **Physics-aware construction.** It derives conservative placement constraints from the platformer kernel's configuration, eliminating many impossible candidates cheaply. Joint trajectory checks and replay verification are still required because independent horizontal/vertical maxima do not prove a fixed-step route.

2. **Editor integration.** The `EditorOperation[]` output means generated levels load directly into the editor with undo/redo. This is critical for the "generate → edit → playtest → share" workflow that Clone-to-Jest games need. The consumer doesn't need to convert `LevelData` to ops manually.

3. **Dual output without complexity.** The `GeneratedLevel` return type gives the consumer both `level` (for direct `compileLevel` use) and `ops` (for editor integration) without extra API surface. The consumer picks which output they need.

Approach B (rhythm pipeline) should be the second prototype — its decomposability is valuable for games that want custom geometry interpretation. Approach A (path-first chunks) is the simplest and could serve as a "minimum viable generator" if C proves too complex to implement.

The three approaches are not mutually exclusive. Approach C's physics constraints can be composed with Approach B's rhythm pipeline — the `realizeRhythm` stage can use `derivePhysicsConstraints` to constrain gap widths. The recommended path is: prototype C first, then add B as a composable alternative, and keep A as the simple fallback.

## Open Questions for @architect

1. **Should `GeneratedLevel.ops` be wrapped in a `batch` op?** A single `batch` op gives one undo step for the whole generation. Individual ops give fine-grained undo. Which default is better for the consumer?

2. **How should the generator handle the `EntityId` counter?** The generator needs to allocate entity IDs that don't collide with future editor ops. Should the generator start from `DEFAULT_ENTITY_ID_START` (1) or from a configurable offset?

3. **Should `derivePhysicsConstraints` be exported from `src/levelgen/` or from `src/platformer/`?** It reads `PlatformerConfig` constants but is used by the generator. The "physics constraint derivation" is generic enough to live in the platformer pillar, but it's only useful to the generator right now.

4. **Chunk template library: how many templates should v1 ship?** Spelunky ships ~50 templates per area. For a library, 10-15 templates across 3-4 configurations (flat, step-up, gap, hazard) seems sufficient for v1. The consumer can extend via config.

5. **Should the generator support vertical levels (up/down traversal) in v1?** The research note focuses on left-to-right platformers. Vertical levels would need a different path-first algorithm. Deferred to v2?

---

## Determinism & Purity Contract

Every export from `src/levelgen/` MUST satisfy the library's core-layer determinism rules. This is non-negotiable — the generator is a deterministic subsystem, not a renderer-adjacent helper.

### Never-throw

All public functions return valid values for any input. They never throw, never propagate exceptions, never crash the consumer. Defensive degradation patterns:

| Input class | Behavior |
|---|---|
| Missing required field | Substitute the default from `src/levelgen/constants.ts` or `src/level/constants.ts` |
| Non-finite number (`NaN`, `Infinity`) | Substitute `0` (or the default), never propagate `NaN` |
| Negative number where non-negative expected | Clamp to `0` |
| Out-of-range difficulty | Clamp to `[MIN_DIFFICULTY, MAX_DIFFICULTY]` |
| Empty config object | Use `DEFAULT_GEN_CONFIG` |
| Zero `tileSize` | Substitute `DEFAULT_TILE_SIZE` (16) |

This matches the existing defensive-adapter pattern from `src/primitives/motion.ts` and the never-throw contract from `src/animation/jump.ts` (`createJumpState`, `advanceJump`).

### No-mutate

All public functions are pure: they take their inputs by value (or by `Readonly<>` reference) and return a brand-new object. They never mutate:

- The `LevelData` input (if any)
- The `LevelGenConfig` input
- The `PlatformerConfig` input
- The `EditorState` input (if any — `applyBatch` is consumer-side)
- Any shared module-level state

This matches the pure-progression-ops pattern from `src/platformer/kernel.ts` (`stepPlatformer` returns a new `PlatformerState`) and `src/collectibles/` (`derivePickups` returns a new `CollectibleSave`).

### Pure (deterministic)

Same `(seed, config)` → same output, forever. This is the core invariant. Concretely:

- **No `Math.random`.** All randomness flows through `mulberry32` (or the consumer's RNG instance for Approach B's `pickRhythm` / `realizeRhythm`).
- **No `Date.now()`.** Time is not a parameter; the generator is stateless w.r.t. wall-clock time.
- **No global mutable state.** Module-level constants are `readonly`; no caches that could leak across calls.
- **No DOM reads.** The generator never touches `window`, `document`, `localStorage`, or any host API.
- **No I/O.** The generator never reads from disk, network, or platform SDKs.
- **No `Math.random`-like APIs** (`crypto.getRandomValues`, `performance.now()`, etc.).

### Per-export contract

| Export | Never-throw | No-mutate | Pure |
|---|---|---|---|
| `generateLevel(seed, config?)` | ✓ | ✓ | ✓ |
| `pickRhythm(rng, config)` | ✓ | ✓ | ✓ |
| `realizeRhythm(rng, rhythm, config)` | ✓ | ✓ | ✓ |
| `assembleLevel(segments, config)` | ✓ | ✓ | ✓ |
| `derivePhysicsConstraints(config)` | ✓ | ✓ | ✓ |
| `deriveMaxJumpDistance(config)` | ✓ | ✓ | ✓ |
| `deriveMaxStepUp(config)` | ✓ | ✓ | ✓ |
| `emptyLevel(opts?)` | ✓ | ✓ | ✓ |

The `validateLevel` post-check is consumer-side — if a generated level fails validation (shouldn't happen by construction, but is checked defensively), the consumer decides whether to retry with a different seed, log a warning, or surface the error to the player. The library never auto-retries.

---

## JSDoc Mandate

Every public export from `src/levelgen/` MUST have a JSDoc block. This is enforced by `@coder` during implementation review and by `@api-designer` during API-surface reconciliation. The JSDoc MUST include:

1. **One-line summary** — what the function does in plain English.
2. **`@param`** — every parameter, with type and meaning (one sentence).
3. **`@returns`** — the return type and shape (one sentence for primitives, a brief description for records).
4. **`@example`** — a runnable usage example (consumer imports + call + expected output shape). The example MUST use real exports and real values, not pseudocode.
5. **Determinism note** — for any function that takes a `seed` or `rng`: a sentence stating "Same `(seed, config)` → same output forever" or equivalent.
6. **Never-throw note** — for any function that returns a value: "Never throws. Non-finite inputs degrade to `<default>`." or equivalent.
7. **Cross-references** — `@see` links to related exports (`@see mulberry32`, `@see compileLevel`, `@see applyBatch`).

Types (`LevelGenConfig`, `GeneratedLevel`, `PhysicsConstraints`, `Beat`, `Rhythm`, `RhythmConfig`, `RealizedSegment`, `EmptyLevelOptions`) MUST have JSDoc on every field, documenting units (pixels vs tiles vs 0..1 normalized), required vs optional, and the default value if any.

Constants (`DEFAULT_GEN_CONFIG`, `DEFAULT_RHYTHM_CONFIG`, `MIN_DIFFICULTY`, `MAX_DIFFICULTY`, `DEFAULT_SOLID_TILE`) MUST have JSDoc stating the value and its meaning.

This is consistent with the existing JSDoc discipline in `src/animation/jump.ts`, `src/platformer/kernel.ts`, and `src/level/validate.ts`.

---

## API Surface Impact

This proposal adds a new module `src/levelgen/` under Pillar 2 (Level Generation). The module exports are listed in `docs/api-surface.md` under `## Pillar 2: Level Generation (PROPOSED)`. The full export map is:

### New module: `src/levelgen/`

| File | Exports |
|---|---|
| `src/levelgen/index.ts` | Barrel re-export of every export below |
| `src/levelgen/types.ts` | `LevelGenConfig`, `GeneratedLevel`, `PhysicsConstraints`, `Beat`, `Rhythm`, `RhythmConfig`, `RealizedSegment`, `EmptyLevelOptions` |
| `src/levelgen/constants.ts` | `DEFAULT_GEN_CONFIG`, `DEFAULT_RHYTHM_CONFIG`, `MIN_DIFFICULTY`, `MAX_DIFFICULTY`, `DEFAULT_SOLID_TILE` |
| `src/levelgen/generate.ts` | `generateLevel(seed, config?)` |
| `src/levelgen/physics.ts` | `derivePhysicsConstraints(config)`, `deriveMaxJumpDistance(config)`, `deriveMaxStepUp(config)` |
| `src/levelgen/empty-level.ts` | `emptyLevel(opts?)` |
| `src/levelgen/rhythm.ts` (Approach B only) | `pickRhythm(rng, config)`, `realizeRhythm(rng, rhythm, config)`, `assembleLevel(segments, config)` |

### `src/levelgen/index.ts` barrel

The barrel re-exports every public export from the module sub-files. Consumers can import either from the barrel (`aicraft-engine/src/levelgen`) or from individual sub-files (`aicraft-engine/src/levelgen/physics`). Tree-shaking is preserved because each sub-file has its own barrel.

```ts
// src/levelgen/index.ts
export type {
  LevelGenConfig,
  GeneratedLevel,
  PhysicsConstraints,
  Beat,
  Rhythm,
  RhythmConfig,
  RealizedSegment,
  EmptyLevelOptions,
} from './types';

export {
  DEFAULT_GEN_CONFIG,
  DEFAULT_RHYTHM_CONFIG,
  MIN_DIFFICULTY,
  MAX_DIFFICULTY,
  DEFAULT_SOLID_TILE,
} from './constants';

export { generateLevel } from './generate';
export {
  derivePhysicsConstraints,
  deriveMaxJumpDistance,
  deriveMaxStepUp,
} from './physics';
export { emptyLevel } from './empty-level';
export {
  pickRhythm,
  realizeRhythm,
  assembleLevel,
} from './rhythm';
```

### Cross-pillar composition

The new exports compose with existing exports without modification:

- `src/rng/mulberry32.ts` — `mulberry32(seed)` provides the RNG for `generateLevel` and (consumer-side) for the rhythm pipeline.
- `src/level/types.ts` — `LevelData`, `LevelEntity`, `TileGrid`, `LevelRect` are the input/output shapes.
- `src/level/constants.ts` — `LEVEL_VERSION`, `DEFAULT_TILE_SIZE`, `DEFAULT_LEVEL_WIDTH`, `DEFAULT_LEVEL_HEIGHT`, `DEFAULT_ENTITY_ID_START` are reused by `emptyLevel`.
- `src/level/entity-id.ts` — `allocateEntityId(level)` is used internally by `generateLevel` to allocate stable entity IDs.
- `src/level/validate.ts` — `validateLevel(level)` is the consumer's post-generation check.
- `src/editor/types.ts` — `EditorOperation` is the shape of the `ops` array.
- `src/editor/operations.ts` — `applyBatch(state, ops, label)` is the consumer's entry point for editor integration.
- `src/platformer/types.ts` — `PlatformerConfig` is the input to `derivePhysicsConstraints`.
- `src/platformer/constants.ts` — `DEFAULT_PLATFORMER_CONFIG` is the fallback when `LevelGenConfig.platformerConfig` is omitted.
- `src/platformer/level-runtime.ts` — `compileLevel(level)` is the consumer's entry point for runtime use.

No existing export is modified. No existing module gains new exports. This is purely additive.

### `docs/api-surface.md` update

The `## Pillar 2: Level Generation (PROPOSED)` section in `docs/api-surface.md` MUST be updated in the same task as this proposal to reflect the new exports (`emptyLevel`, the explicit `PhysicsConstraints` field list, the corrected `pickRhythm(rng, ...)` signature). The orchestrator checks this file before committing any change to `src/`.

### `.opencode/instructions/project-structure.md` update

The Pillar Model table MUST be updated to include `levelgen/` under Pillar 2 (Cosmetics / Level Generation). The directory layout listing MUST include `levelgen/` as a sibling of `level/`.

---

## Test Plan

Tests live in `src/tests/levelgen.test.ts` (vitest, node env). The test suite MUST cover the following categories:

### Determinism tests

| Test | What it verifies |
|---|---|
| `generateLevel(42) === generateLevel(42)` | Byte-identical output for same seed + default config |
| `generateLevel(42, cfg) === generateLevel(42, cfg)` | Byte-identical output for same seed + same config |
| `generateLevel(42) !== generateLevel(43)` | Different seed → different output |
| `pickRhythm(rng, cfg)` is deterministic given the same RNG sequence | Replay-safe rhythm generation |
| `realizeRhythm(rng, rhythm, cfg)` is deterministic given the same RNG sequence | Replay-safe geometry realization |
| `derivePhysicsConstraints(cfg)` is deterministic | Same config → same constraints |
| `emptyLevel()` is deterministic | Same opts → same output |

### Solvability tests

Structural invariants are fast preconditions, not a proof of beatability. The canonical plan retains these checks and adds kernel-aligned trajectory tests plus winning-replay verification for production-selected levels:

| Test | What it verifies |
|---|---|
| Every gap width ≤ `maxGapWidth` (derived from `PlatformerConfig`) | No untraversable gaps |
| Every step-up height ≤ `maxStepUpTiles` | No unreachable platforms |
| Every step-down height ≤ `maxStepUpTiles` | No fall-into-oblivion traps |
| Spawn point is on a solid tile | Player doesn't spawn in midair |
| Exit point is on a solid tile and reachable from spawn | Player can complete the level |
| Every collectible is on or above a solid tile | No floating coins |
| Every enemy is on a solid tile | No floating enemies |

These are fast property checks (no simulation), so the test suite runs in milliseconds even for hundreds of generated levels.

### Difficulty tests

| Test | What it verifies |
|---|---|
| `difficulty: 0` → no gaps, no hazards, flat platforms | Trivial difficulty produces trivial levels |
| `difficulty: 1` → max gaps, max hazards, max rhythm complexity | Max difficulty produces hard levels |
| `difficulty: 0.5` → mid-range gap widths and hazard density | Mid difficulty is between extremes |
| Increasing `difficulty` monotonically increases gap width variance | Difficulty knob has the expected effect |

### Edge case tests

| Test | What it verifies |
|---|---|
| `generateLevel(0)` works (seed 0 is valid) | Edge of seed space |
| `generateLevel(-1)` works (negative seeds are valid; mulberry32 handles them) | Out-of-range seed |
| `generateLevel(1, { cols: 1, rows: 1 })` works (tiny level) | Minimum dimensions |
| `generateLevel(1, { cols: 10000, rows: 10000 })` works (huge level) | Maximum dimensions |
| `generateLevel(1, { difficulty: NaN })` clamps to `[0, 1]` | Non-finite input |
| `generateLevel(1, { difficulty: -0.5 })` clamps to `0` | Out-of-range input |
| `generateLevel(1, { difficulty: 1.5 })` clamps to `1` | Out-of-range input |
| `generateLevel(1, { tileSize: 0 })` substitutes `DEFAULT_TILE_SIZE` | Zero input |
| `emptyLevel({ width: NaN })` substitutes `DEFAULT_LEVEL_WIDTH` | Non-finite input |
| `emptyLevel()` returns a deterministic `LevelData`-shaped scaffold | Editor scaffold construction |
| `pickRhythm(rng, { length: 0 })` returns empty rhythm | Zero-length input |
| `pickRhythm(rng, { length: -1 })` returns empty rhythm | Negative-length input |
| `derivePhysicsConstraints({ jump: { apexHeight: NaN, ... } })` returns `maxStepUp: 0` | Non-finite physics input |

### Editor integration tests

| Test | What it verifies |
|---|---|
| `applyBatch(createEditorState(emptyLevel()), generated.ops, 'Generate')` produces the same `level` as `generated.level` | Round-trip: ops reproduce the level |
| Undoing the batch restores the empty level | Undo works on generated levels |
| Redoing the batch restores the generated level | Redo works on generated levels |
| The `ops` array is a valid sequence (no illegal state transitions) | Ops are well-formed |

### Cross-pillar composition tests

| Test | What it verifies |
|---|---|
| `validateLevel(generated.level)` returns `{ valid: true }` (no errors) | Output passes the level schema validator |
| `compileLevel(generated.level)` produces a valid `CompiledLevel` | Output compiles with the platformer kernel |
| `generated.level.entities` are all valid `LevelEntity` records | Entity shapes are correct |
| `generated.level.tiles` is a valid `TileGrid` of correct dimensions | Tile grid shapes are correct |

### Snapshot tests

A small set of golden `(seed, config)` pairs are snapshotted (via `expect(...).toMatchSnapshot()`) and locked in `src/tests/__snapshots__/levelgen.test.ts.snap`. Any change to the generator's output for these inputs is a regression and must be reviewed. This catches accidental drift in the generation algorithm.

---

## Benchmarks

Benchmark suite lives in `benchmarks/levelgen/` and is maintained by `@benchmarker`. The suite compares Approach A, B, and C on three dimensions: runtime cost, level diversity, and solvability.

### Runtime cost

| Benchmark | What it measures |
|---|---|
| `benchmarks/levelgen/runtime-60x15.png` | Time to generate a 60×15 level (typical daily-seed level) across 1000 seeds |
| `benchmarks/levelgen/runtime-120x30.png` | Time to generate a 120×30 level (large level) across 1000 seeds |
| `benchmarks/levelgen/runtime-by-difficulty.png` | Time per difficulty bucket `[0, 0.25, 0.5, 0.75, 1]` |
| `benchmarks/levelgen/ops-count.png` | Number of `EditorOperation[]` entries per generated level (Approach C only) |

Expected budgets (sub-ms target):

| Level size | Target | Hard ceiling |
|---|---|---|
| 60×15 | < 1 ms | < 5 ms |
| 120×30 | < 5 ms | < 20 ms |
| 240×60 | < 20 ms | < 100 ms |

If any approach exceeds the hard ceiling, the orchestrator pauses implementation and `@architect` reviews the algorithm.

### Level diversity

| Benchmark | What it measures |
|---|---|
| `benchmarks/levelgen/diversity-tile-histogram.png` | Tile value distribution across 1000 generated levels — should be roughly uniform |
| `benchmarks/levelgen/difficulty-monotonicity.png` | Average gap width and hazard density as a function of `difficulty` — should be monotonically increasing |
| `benchmarks/levelgen/seed-space-coverage.png` | Pairwise Hamming distance between levels generated from 100 random seeds — should be high (low similarity) |

### Solvability

| Benchmark | What it measures |
|---|---|
| `benchmarks/levelgen/solvability-rate.png` | Fraction of 1000 generated levels that pass all structural solvability assertions (target: 100% — solvable by construction) |
| `benchmarks/levelgen/max-gap-distribution.png` | Distribution of max gap widths in generated levels — should be ≤ `deriveMaxJumpDistance(defaultConfig)` |
| `benchmarks/levelgen/max-step-up-distribution.png` | Distribution of max step-up heights in generated levels — should be ≤ `deriveMaxStepUp(defaultConfig)` |

If the solvability rate is below 100% for any approach, the approach is rejected — solvability by construction is the core promise.

### Comparison report

`benchmarks/levelgen/comparison-report.md` summarizes the three approaches side-by-side, with the runtime cost, diversity, and solvability numbers for each. This is the input to the orchestrator's final decision on which approach to ship.

---

## Resolved Open Questions

The following open questions from the original proposal have been resolved during the `@architect` critique:

### Q1: Should `GeneratedLevel.ops` be wrapped in a `batch` op?

**Historical resolution:** wrap in a single `batch` op by default.

**Superseded:** the canonical plan uses a singular `replaceLevel` operation. Existing
ops cannot reproduce arbitrary generated dimensions, metadata, tile-grid shape, or
entity counters, whereas snapshot-based replacement supports one-step undo/redo
without nested batching.

The `ops` array returned by `generateLevel` is a single `{ type: 'batch', ops: [...], label: 'Generate level (seed N)' }` operation, NOT a flat array of individual ops. Rationale:

- The consumer's common case is "generate a level, load it into the editor." A single `batch` op gives one undo step for the whole generation, which matches the consumer's mental model.
- The consumer can still inspect individual ops by reading `batch.ops` if they need fine-grained undo or analytics.
- The editor's `applyBatch` already accepts both shapes (a flat array or a single `batch` op), so this is a no-op for the editor.

The flat array shape is preserved as an internal detail — `generateLevel` builds the flat array first, then wraps it. The consumer never sees the flat array unless they explicitly unwrap `batch.ops`.

### Q2: How should the generator handle the `EntityId` counter?

**Resolution:** **Start from `DEFAULT_ENTITY_ID_START` (1) by default; allow override via `LevelGenConfig.entityIdStart`.**

The generator uses `allocateEntityId(level)` from `src/level/entity-id.ts` to allocate stable entity IDs. The starting counter is `DEFAULT_ENTITY_ID_START` (1) by default. The consumer can override via `LevelGenConfig.entityIdStart?: number` if they need to merge a generated level into an existing level (e.g., a level that already has entities with IDs 1-50 → start at 51).

Rationale:

- Defaulting to `1` matches the existing `allocateEntityId` behavior — the consumer can always merge two generated levels by bumping the second's entity IDs.
- Override is opt-in, so the common case stays simple.
- The override is a single number field, not a full re-implementation of entity ID allocation.

### Q3: Should `derivePhysicsConstraints` be exported from `src/levelgen/` or from `src/platformer/`?

**Resolution:** **Export from `src/levelgen/` for v1; consider moving to `src/platformer/` if a second consumer appears.**

The physics constraint derivation is currently only used by the generator. Exporting it from `src/levelgen/` keeps the surface area minimal and avoids polluting `src/platformer/` with a generator-specific helper. If a second consumer (e.g., a level validator, a difficulty analyzer) needs the same derivation, the orchestrator will move it to `src/platformer/physics-constraints.ts` and re-export from `src/levelgen/` for back-compat.

Rationale:

- The helper reads `PlatformerConfig` constants but doesn't add new physics behavior — it's pure derivation, not physics simulation.
- Keeping it in `src/levelgen/` follows the library's "consumer-facing module owns its helpers" convention.
- The move-to-platformer path is additive (re-export), not breaking.

### Q4 & Q5: Deferred to v2

- **Q4 (chunk template library size):** Deferred. v1 ships with `DEFAULT_GEN_CONFIG` (no template library exposed). Templates can be added in v2 once we know what consumers actually need.
- **Q5 (vertical levels):** Deferred. v1 supports left-to-right platformers only. Vertical levels require a different path-first algorithm and are out of scope.
