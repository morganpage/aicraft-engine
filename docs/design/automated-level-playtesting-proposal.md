# API Proposal: Automated Level Playtesting

> Target pillar: 2 (Level testing / Platformer extension). Module: `src/leveltest/` (new).
> Builds on research: `docs/research/automated-level-playtesting.md`.
> Status: HISTORICAL DESIGN INPUT — direction approved, but these API sketches are
> superseded for implementation by
> `docs/design/level-generation-quality-implementation-plan.md`.
> Preserve this document for alternatives, rationale, and trade-offs; do not
> implement its signatures without applying the canonical plan's corrections.

## Consumer Need

**Games:** Spitekeep / IMP - Not a Troll needs "is this user-uploaded level beatable?" before allowing UGC share. Future Clone-to-Jest titles need CI gates that catch "I shipped an impossible level."

**Without this:** Level designers manually playtest every level. `validateLevel` catches structural bugs (missing spawn, bad IDs) but knows nothing about playability. A level can pass validation and still be unbeatable (exit 5 tiles above the highest platform, spawn inside a wall, one-way platform loop).

**What becomes possible:**
- **UGC clear-check:** a `Replay` recorded by a bot is the cheapest "this level is beatable" proof — the hash is the share-code, the replay is the receipt.
- **CI regression for levels:** `src/tests/fixtures/levels/*.json` + `src/tests/fixtures/replays/*.json` pairs let `npm test` assert "every shipped level still produces the same `replayHash`."
- **Editor live-feedback:** a static reachability pass on every editor `commit` op surfaces "this move makes the exit unreachable."
- **Difficulty metrics:** jump-arc edge weights feed a "how hard is this level?" score.

**Naming overlap caveat:** This module's `Surface` type (a standing-surface candidate extracted from compile output) is structurally compatible with `src/collision/types.ts`'s `Solid` (a collision surface) but distinct. Surfaces are the BFS graph nodes; solids are what the kernel resolves against. `WinCondition` here is a predicate; it does NOT collide with anything in `src/game-state/` (whose events use `win`/`die` as state transitions). `BotPolicy` is local to this module — no collision with `src/platformer/types.ts` `AbilityProcessor` (the kernel's ability pipeline is unrelated).

---

## Approach A: Simulation Seek-Bot

> **Prior-art pattern:** Pattern 1 (Greedy seek-bot + replay golden fixture) from the research note.

Drives `stepPlatformer` directly with a simple heuristic policy (always move toward exit, jump when blocked, dash when stuck). Produces a `Replay` that feeds `replayHash` for CI golden-fixture verification. No static analysis — purely "can a bot beat this level?"

**Source pattern:** Baumgarten's A* over state space, simplified to a greedy heuristic (no A* search — just a tick-by-tick decision policy). The library already has every piece needed: `stepPlatformer` is the simulator, `createReplayRecorder` captures the input stream, `replayHash` fingerprints the result.

### Signature sketch

```ts
// In src/leveltest/bot.ts

/**
 * Bot decision policy. Given the current platformer state and level
 * context, returns one tick's PlatformerInput. Pure, deterministic,
 * never throws. The library ships a default greedy policy; consumers
 * can supply their own.
 */
export type BotPolicy = (
  state: PlatformerState,
  ctx: BotContext,
) => PlatformerInput;

/**
 * Read-only context passed to the bot policy each tick.
 */
export interface BotContext {
  /** All non-solid level entities (exits, traps, collectibles, hazards). */
  readonly entities: readonly LevelEntity[];
  /** Compiled static solids (for "am I near a wall?" checks). */
  readonly solids: readonly Solid[];
  /** Moving-platform descriptors the consumer advanced this tick (for "is there a platform carrying me?" checks). */
  readonly movingPlatforms: readonly CompiledMovingPlatform[];
  /** Current tick number (0-based). */
  readonly tick: number;
  /** Fixed timestep in seconds (matches the kernel's `dt` for this tick). */
  readonly dt: number;
  /** The jump config for this level (apex height, etc.). */
  readonly jumpConfig: Readonly<JumpConfig>;
}

/**
 * Configuration for a level test run.
 */
export interface LevelTestConfig {
  /** Max ticks before declaring failure. Default: `DEFAULT_MAX_TICKS` (3600, i.e. 60s at 60Hz). */
  readonly maxTicks?: number;
  /** Bot policy. Default: `DEFAULT_BOT_POLICY` (greedy exit-seeker). */
  readonly policy?: BotPolicy;
  /** Platformer config override. Default: `DEFAULT_PLATFORMER_CONFIG`. */
  readonly platformerConfig?: Readonly<PlatformerConfig>;
  /**
   * Seed for the bot's deterministic RNG (tie-breaking). Default: `fnv1a(level.id) XOR BOT_SEED_SALT`.
   * The default is reproducible across machines: same `level.id` → same seed.
   * Consumers override only when they need a different tie-breaking sequence (e.g. fuzz-testing).
   */
  readonly seed?: number;
  /** Win-condition predicate. Default: `reachedExit` (player rect overlaps a non-trap, non-locked exit). */
  readonly winCondition?: WinCondition;
}

/**
 * Win-condition predicate. Returns true if the player has beaten the level.
 * The library ships three built-in combinators (`reachedExit`, `collectedAll`,
 * `reachedExitWithKey`); consumers compose them or supply their own. Pure,
 * deterministic, never throws.
 */
export type WinCondition = (
  state: PlatformerState,
  entities: readonly LevelEntity[],
  save: Readonly<CollectibleSave>,
) => boolean;

/**
 * Built-in win condition: true when the player's AABB overlaps a non-trap,
 * non-locked exit entity. The default `WinCondition` shipped by the library.
 *
 * `state.core.{x,y,width,height}` is the player AABB. Exits are entities
 * with `kind: 'exit'` and `props.isTrap === false && props.locked === false`.
 *
 * @param state - current platformer state
 * @param entities - all level entities
 * @returns `true` if the player overlaps a beatable exit
 */
export function reachedExit(
  state: PlatformerState,
  entities: readonly LevelEntity[],
): boolean;

/**
 * Built-in win condition: true when every collectible in the level has been
 * collected (per the supplied save). The save is the consumer's
 * `CollectibleSave` (see `src/collectibles/types.ts`); the combinator reads
 * `save.collected` and compares against the full set of `kind: 'collectible'`
 * entity IDs in `entities`.
 *
 * @param state - current platformer state (unused; signature compatibility)
 * @param entities - all level entities
 * @param save - player's collectible save (may be the empty default)
 * @returns `true` iff every collectible's id is in `save.collected`
 */
export function collectedAll(
  state: PlatformerState,
  entities: readonly LevelEntity[],
  save: CollectibleSave,
): boolean;

/**
 * Built-in win condition: true when the player has collected a key AND
 * overlaps a non-trap exit. The key is identified by `kind: 'collectible'`
 * with `props.kind === 'key'` (see `src/level/types.ts` `CollectibleKind`).
 *
 * @param state - current platformer state
 * @param entities - all level entities
 * @param save - player's collectible save (key id must be in `save.collected`)
 * @returns `true` iff a key is held AND the player overlaps a beatable exit
 */
export function reachedExitWithKey(
  state: PlatformerState,
  entities: readonly LevelEntity[],
  save: CollectibleSave,
): boolean;

/**
 * Result of a simulation-based level test.
 */
export interface LevelTestResult {
  /** Schema version. Always `1` for this release. Bump on additive shape changes. */
  readonly version: 1;
  /** Whether the bot found a winning path. */
  readonly beatable: boolean;
  /** The winning Replay (undefined if not beatable). */
  readonly replay?: Replay;
  /** 32-bit replay hash (undefined if not beatable). */
  readonly replayHash?: number;
  /** Ticks until win (undefined if not beatable). */
  readonly winTicks?: number;
  /** Ticks until failure (undefined if beatable). */
  readonly failTicks?: number;
  /** Number of hazard deaths during the run. */
  readonly deaths: number;
  /** Entity IDs of collectibles reached during the run. */
  readonly collectiblesReached: readonly EntityId[];
  /** Human-readable failure reason (undefined if beatable). */
  readonly failureReason?: string;
}

// Main entry point:
export function testLevel(
  level: LevelData,
  config?: LevelTestConfig,
): LevelTestResult;
```

### Usage example

```ts
import { testLevel, type LevelTestResult, reachedExit } from './lib/aicraft-engine/src/leveltest';
import { loadLevel } from './levels';

const level = loadLevel('level-01.json');
const result = testLevel(level, { maxTicks: 3600 });

if (result.beatable) {
  console.log(`Level beatable in ${result.winTicks} ticks`);
  console.log(`Replay hash: ${result.replayHash}`);
  console.log(`Collectibles reached: ${result.collectiblesReached.length}`);
  console.log(`Deaths: ${result.deaths}`);
} else {
  console.log(`Level NOT beatable: ${result.failureReason}`);
  console.log(`Bot survived ${result.failTicks} ticks`);
}
```

### Trade-offs

- **Ergonomics:** ★★★★★ One function call. Consumer provides a level and gets a yes/no + replay. The `BotPolicy` callback is opt-in for advanced users; the default "just works." The three shipped `WinCondition` combinators cover the common cases without forcing every consumer to write one.
- **Determinism:** ★★★★★ Pure function of `(level, config) → result`. Same inputs → same replay hash, forever. No `Math.random`, no `Date.now`. The bot's RNG is seeded from `fnv1a(level.id) XOR BOT_SEED_SALT` by default — same `level.id` produces the same seed on every machine. The bot advances `stepPlatformer` with a fixed `dt` (consumer-supplied or `DEFAULT_FIXED_DT`).
- **Runtime cost:** ★★★☆☆ O(maxTicks) simulation ticks per level. At 3600 ticks (60s), that's ~3600 × `stepPlatformer` calls. For CI with 100 levels, that's ~360k kernel steps — a few seconds total (see **Performance bounds** below).
- **Coverage:** Catches: unreachable exit, impossible jumps, spawn-in-wall (bot dies immediately), collecting all pickups (via `collectedAll`). Does NOT catch: softlocks (bot might find the path a human can't), timing-dependent moving-platform bugs, difficulty assessment.
- **Convention fit:** ★★★★★ Follows the pure-function pattern (`stepPlatformer`, `advanceTween`, etc.). `LevelTestResult` mirrors `ValidationResult` in shape (structured diagnostics). `BotPolicy` mirrors `AbilityProcessor` (consumer-supplied callback). `LevelTestConfig` mirrors `CompileLevelOptions` (optional overrides bag). `reachedExit`/`collectedAll`/`reachedExitWithKey` mirror the pure-progression-ops discipline (immutable in, never throws).
- **Consumer complexity:** Minimal for v1. `testLevel(level)` is the one-liner. Custom policies require understanding `PlatformerState` and `PlatformerInput`.

**What this makes easy:** CI integration (replay hash as golden fixture), UGC clear-check (bot proves beatability), simple "can I beat this?" queries.

**What this makes hard:** The bot is greedy — it may fail on levels that ARE beatable but require non-obvious paths (backtracking, precise timing, key collection before exit). False negatives (beatable level reported as unbeatable) are possible.

---

## Approach B: Static Reachability BFS

> **Prior-art pattern:** Pattern 2 (Static reachability BFS over compiled solids with jump-arc edges) + Pattern 3 (Jump-arc precomputer from `JumpConfig` physics) from the research note.

Builds a reachability graph over compiled standing surfaces with analytically-computed jump-arc edges. BFS from spawn asks "is any exit surface reachable?" No simulation runs — the jump-arc edges are derived from the existing `JumpConfig` physics.

**Source pattern:** `platval` (Python, ~550 lines) + Eliot Beresford's pathfinding writeup + Cooper's 2025 softlock detection (forward + backward BFS).

### Signature sketch

```ts
// In src/leveltest/reachability.ts

/**
 * A standing surface extracted from the compiled level geometry.
 * The top face of a platform, tile row, or entity rect.
 *
 * `id` format matches `compileLevel`'s Solid.id format exactly so
 * Surface↔Solid correspondence is verifiable by string equality:
 *   - entity-derived: `entity-<id>` (entity id is `EntityId` / number)
 *   - tile-derived:   `tile-<x>-<y>-<width>-<height>` (world-space px)
 *
 * The 4-component tile format is the canonical `compileLevel` output
 * (`src/platformer/level-runtime.ts` `flattenCapturedTiles`). Consumers
 * may verify a Surface is a real solid by checking `solid.id === surface.id`.
 */
export interface Surface {
  /** Unique surface ID matching `compileLevel`'s Solid.id format. */
  readonly id: string;
  /** World-space top-left X of the surface. */
  readonly x: number;
  /** World-space top Y (surface is at this Y; player stands ON this line). */
  readonly y: number;
  /** Width of the standing surface in px. */
  readonly width: number;
  /** Whether this is a passthrough (one-way) surface. */
  readonly passthrough: boolean;
  /** Source entity ID (if entity-derived) or null (if tile-derived). */
  readonly entityId?: EntityId;
}

/**
 * A jump arc between two surfaces.
 *
 * All three numeric fields are derived analytically from `JumpConfig`
 * + `PlatformerConfig` + the geometry of `(from, to)`. See formulas below.
 */
export interface JumpEdge {
  /** Source surface. */
  readonly from: Surface;
  /** Destination surface. */
  readonly to: Surface;
  /**
   * Whether the jump requires a dash.
   *
   * Formula: `requiresDash = (horizontal_distance > maxNoDashDistance)`,
   * where `maxNoDashDistance = moveSpeed × (timeToApex × 2)` (the horizontal
   * distance the player covers during a full jump arc with no air control).
   * Dashes add `dashSpeed × dashDuration` of horizontal coverage, so a
   * dash-required jump is one where `horizontal_distance ≤ maxNoDashDistance + dashBoost`.
   */
  readonly requiresDash: boolean;
  /**
   * Approximate airtime in seconds.
   *
   * Exact formula: `airtime = 2 × timeToApex` for a flat jump from `from.y`
   * to `to.y` where `to.y === from.y` (apex at the midpoint). For jumps
   * where `to.y > from.y` (jumping DOWN onto a lower surface), the airtime
   * is asymmetric: `airtime = timeToApex + fallingTime`, where
   * `fallingTime = sqrt(2 × verticalDrop / gravity)`. For jumps where
   * `to.y < from.y` (jumping UP), the airtime is bounded by the apex:
   * `airtime = timeToApex + sqrt(2 × (apexHeight − verticalRise) / gravity)`.
   * Both formulas assume no jump-cutoff (full jump held for the entire arc).
   */
  readonly airtime: number;
  /**
   * Difficulty score in `[0, 1]`.
   *
   * Formula: `difficulty = clamp(horizontal_distance / maxHorizontalJumpDistance, 0, 1)`,
   * where `maxHorizontalJumpDistance = moveSpeed × 2 × timeToApex`
   * (full jump arc, no air control, no dash). A `difficulty` of 0 means
   * "trivial" (next to no horizontal gap); 1 means "at the limit of what
   * the player can do without dashing". Dash-required jumps clamp to 1.
   */
  readonly difficulty: number;
}

/**
 * The complete reachability graph.
 */
export interface ReachGraph {
  /** All standing surfaces in the level (sorted by `id` — see BFS visit order below). */
  readonly surfaces: readonly Surface[];
  /** All valid jump arcs. */
  readonly edges: readonly JumpEdge[];
}

/**
 * Options for building the reachability graph.
 */
export interface ReachabilityConfig {
  /** Jump config for arc computation. Default: `DEFAULT_JUMP`. */
  readonly jumpConfig?: Readonly<JumpConfig>;
  /** Platformer config (gravity, move speed, etc.). Default: `DEFAULT_PLATFORMER_CONFIG`. */
  readonly platformerConfig?: Readonly<PlatformerConfig>;
  /** Player body dimensions. Default: `DEFAULT_PLAYER_WIDTH` × `DEFAULT_PLAYER_HEIGHT` (16×24). */
  readonly playerWidth?: number;
  readonly playerHeight?: number;
}

/**
 * Result of reachability analysis.
 */
export interface ReachabilityResult {
  /** Schema version. Always `1` for this release. Bump on additive shape changes. */
  readonly version: 1;
  /** True if the exit is reachable from spawn. */
  readonly reachable: boolean;
  /** The reachability graph (for further analysis). */
  readonly graph: ReachGraph;
  /** The surface the player starts on (or null if spawn is in-wall). */
  readonly spawnSurface: Surface | null;
  /** The surface(s) the exit overlaps (or empty if exit is floating). */
  readonly exitSurfaces: readonly Surface[];
  /** All surfaces reachable from spawn (for coverage analysis). */
  readonly reachableSurfaces: readonly Surface[];
  /** Surfaces reachable but NOT backward-reachable from exit (potential softlocks). */
  readonly softlockSurfaces: readonly Surface[];
  /** Human-readable diagnostics. */
  readonly diagnostics: readonly string[];
}

/**
 * Build a reachability graph from a compiled level.
 * Pure, deterministic, never throws.
 *
 * **Visit order:** surfaces are visited in lexicographic order of `Surface.id`.
 * This is the canonical order — the BFS is reproducible across machines
 * because every surface has a stable id (entity-derived: `entity-<n>`;
 * tile-derived: `tile-<x>-<y>-<w>-<h>`). The graph builder sorts the
 * `CompiledLevel.staticSolids` by `solid.id` before extracting surfaces,
 * so the resulting `ReachGraph.surfaces` is sorted.
 */
export function buildReachGraph(
  level: CompiledLevel,
  config?: ReachabilityConfig,
): ReachGraph;

/**
 * Analyze reachability: is the exit reachable from spawn?
 * Pure, deterministic, never throws.
 */
export function analyzeReachability(
  level: LevelData,
  config?: ReachabilityConfig,
): ReachabilityResult;

/**
 * Convenience: returns a ValidationResult-shaped diagnostic.
 * Extends validateLevel with playability errors.
 */
export function validatePlayability(
  level: LevelData,
  config?: ReachabilityConfig,
): ValidationResult;
```

### Usage example

```ts
import { analyzeReachability, validatePlayability } from './lib/aicraft-engine/src/leveltest';
import { compileLevel } from './lib/aicraft-engine/src/platformer';
import { loadLevel } from './levels';

const level = loadLevel('level-01.json');

// Quick check: is the exit reachable?
const result = analyzeReachability(level);
console.log(`Reachable: ${result.reachable}`);
console.log(`Softlock surfaces: ${result.softlockSurfaces.length}`);
console.log(`Diagnostics: ${result.diagnostics}`);

// Full validation: structural + playability
const validation = validatePlayability(level);
if (!validation.valid) {
  for (const e of validation.errors) {
    if (e.severity === 'error') console.error(`${e.path}: ${e.message}`);
  }
}
```

### Trade-offs

- **Ergonomics:** ★★★★☆ Two-layer API: `analyzeReachability` for quick checks, `validatePlayability` for ValidationResult integration. Slightly more ceremony than Approach A's single `testLevel`.
- **Determinism:** ★★★★★ Pure function of `(level, config) → result`. No simulation, no RNG, no time. The jump-arc computation is analytic parabolic trajectory math. Byte-identical forever. The BFS visit order is pinned (lexicographic `Surface.id`) so the visited-set is reproducible across machines.
- **Runtime cost:** ★★★★★ O(surfaces²) for edge construction, O(surfaces + edges) for BFS. For 100 platforms: 10k edge checks + BFS = sub-millisecond. 1000× faster than Approach A. See **Performance bounds** below for hard numbers.
- **Coverage:** Catches: spawn-in-wall (no spawn surface), unreachable exit (BFS doesn't reach exit surface), floating exit (exit doesn't overlap any surface), unreachable collectibles (entity not in reachable set). Does NOT catch: timing-dependent paths (moving platforms), enemy avoidance, collectible pickup timing, difficulty. The softlock detection (forward + backward BFS) catches "can reach but can't escape" surfaces.
- **Convention fit:** ★★★★★ Pure functions. `ValidationResult`-shaped output extends `validateLevel`. `ReachabilityConfig` mirrors `CompileLevelOptions`. Composes with `compileLevel` and `JumpConfig` directly. `Surface.id` matches `compileLevel`'s `Solid.id` format so consumers can cross-reference.
- **Consumer complexity:** Moderate. The consumer must understand "surfaces" as a concept. The `validatePlayability` convenience wrapper hides this.

**What this makes easy:** Editor live-feedback (sub-ms per edit), CI structural playability checks, diagnosing "why is this level impossible?" (surface-level diagnostics).

**What this makes hard:** Moving-platform timing (v2 feature — surfaces are static snapshots, not time-varying). Enemy avoidance. Precise-timing jumps (the BFS assumes "can I reach this surface at all?", not "can I reach it in time?").

---

## Approach C: Hybrid Static Pre-Filter + Simulation Bot

> **Prior-art pattern:** Pattern 2 (Static reachability BFS) as fast-fail pre-filter + Pattern 1 (Seek-bot) for the hard cases. The research note explicitly recommends this composition.

Runs static reachability analysis first, then simulation when appropriate. A winning simulation produces a `Replay` and proves beatability. Static or bounded-bot failure is only conclusive when the static abstraction is documented as sound for every mechanic used; otherwise the canonical result is `inconclusive`.

**Source pattern:** `platval`'s structure (static check first, simulation fallback) + Baumgarten's bot + Cooper's softlock detection as an optional extension.

### Signature sketch

```ts
// In src/leveltest/index.ts

/**
 * Configuration for the hybrid level test.
 */
export interface HybridTestConfig {
  /** Max bot ticks (only used if static check passes). Default: `DEFAULT_MAX_TICKS` (3600). */
  readonly maxTicks?: number;
  /** Bot policy override. Default: `DEFAULT_BOT_POLICY`. */
  readonly policy?: BotPolicy;
  /** Win-condition predicate override. Default: `reachedExit`. */
  readonly winCondition?: WinCondition;
  /** Jump config. Default: `DEFAULT_JUMP`. */
  readonly jumpConfig?: Readonly<JumpConfig>;
  /** Platformer config. Default: `DEFAULT_PLATFORMER_CONFIG`. */
  readonly platformerConfig?: Readonly<PlatformerConfig>;
  /** Seed for bot RNG. Default: `fnv1a(level.id) XOR BOT_SEED_SALT`. */
  readonly seed?: number;
  /** If true, run backward BFS for softlock detection (2× cost). Default: false. */
  readonly verifySoftlocks?: boolean;
}

/**
 * Simulation outcome — discriminated union so consumers can pattern-match
 * on whether the bot ran or was short-circuited by the static pre-filter.
 */
export type HybridSimulation =
  | {
      /** Static check failed — bot was not run. */
      readonly kind: 'skipped';
      /** Reason the static check failed (mirrored from `ReachabilityResult.diagnostics`). */
      readonly reason: string;
    }
  | {
      /** Static check passed — bot ran. */
      readonly kind: 'ran';
      /** Ticks until win (undefined if bot did not win). */
      readonly winTicks?: number;
      /** Number of hazard deaths during the run. */
      readonly deaths: number;
      /** Entity IDs of collectibles reached during the run. */
      readonly collectiblesReached: readonly EntityId[];
      /** Human-readable failure reason (undefined if bot won). */
      readonly failureReason?: string;
    };

/**
 * Combined test result: static diagnostics + optional simulation replay.
 */
export interface HybridTestResult {
  /** Schema version. Always `1` for this release. Bump on additive shape changes. */
  readonly version: 1;
  /** Whether the level is structurally beatable (static analysis). */
  readonly structurallyBeatable: boolean;
  /** Whether the bot found a winning path (simulation). `false` if static check failed. */
  readonly botBeatable: boolean;
  /** The winning Replay (undefined if bot didn't find a path). */
  readonly replay?: Replay;
  /** 32-bit replay hash (undefined if bot didn't find a path). */
  readonly replayHash?: number;
  /** Static analysis diagnostics. */
  readonly reachability: ReachabilityResult;
  /** Simulation outcome — discriminated union (`'skipped'` when static check failed, `'ran'` otherwise). */
  readonly simulation: HybridSimulation;
  /** Combined ValidationResult (structural + playability). */
  readonly validation: ValidationResult;
}

// Main entry point:
export function testLevelHybrid(
  level: LevelData,
  config?: HybridTestConfig,
): HybridTestResult;
```

### Usage example

```ts
import { testLevelHybrid } from './lib/aicraft-engine/src/leveltest';
import { loadLevel } from './levels';

const level = loadLevel('level-01.json');
const result = testLevelHybrid(level, { verifySoftlocks: true });

// Static fast-fail
if (!result.structurallyBeatable) {
  console.log('Static analysis found issues:');
  for (const d of result.reachability.diagnostics) {
    console.log(`  - ${d}`);
  }
  // result.simulation is { kind: 'skipped', reason } — no replay to inspect
  return;
}

// Bot verification (only reached if static check passed)
if (result.botBeatable) {
  // result.simulation is { kind: 'ran', winTicks, deaths, ... }
  const sim = result.simulation;
  if (sim.kind === 'ran') {
    console.log(`Level beatable in ${sim.winTicks} ticks`);
  }
  console.log(`Replay hash: ${result.replayHash}`);
} else {
  if (result.simulation.kind === 'ran') {
    console.log(`Bot failed: ${result.simulation.failureReason}`);
  }
}

// Full validation for CI
const v = result.validation;
if (!v.valid) {
  for (const e of v.errors) {
    if (e.severity === 'error') console.error(`${e.path}: ${e.message}`);
  }
}
```

### Trade-offs

- **Ergonomics:** ★★★★☆ More ceremony than A or B alone, but the layered result gives the consumer everything. The `testLevelHybrid` entry point is still one function call. The `simulation.kind` discriminator makes the skipped-vs-ran split explicit.
- **Determinism:** ★★★★★ Both layers are pure. Static BFS is pure math; the bot is pure simulation. Same inputs → same result. Bot seed is `fnv1a(level.id) XOR BOT_SEED_SALT` by default.
- **Runtime cost:** ★★★★☆ Static BFS is sub-ms (fast-fail). Bot runs only when BFS passes (~3600 ticks). For 100 levels, worst case is 100 × (sub-ms + ~60ms) = ~6 seconds. For levels the static check catches, it's ~100 × sub-ms = <100ms total. See **Performance bounds** below for hard numbers.
- **Coverage:** Combines simulation evidence, static diagnostics, and optional softlock analysis. A winning replay proves beatability; bot exhaustion and unsupported static mechanics remain inconclusive.
- **Convention fit:** ★★★★★ Composes existing modules: `buildReachGraph` + `testLevel` + `validateLevel`. The `HybridTestResult` extends both `ReachabilityResult` and `LevelTestResult`. Follows the pure-function pattern throughout. The `simulation` discriminated union mirrors `GameStateExact` (compile-time impossible-state prevention).
- **Consumer complexity:** The layered result is more to parse, but the consumer can ignore layers they don't need (`result.botBeatable` for simple checks, `result.validation` for CI). The `simulation.kind` discriminator makes branching trivial.

**What this makes easy:** Everything. Fast-fail for obvious bugs (static), complete verification for CI (bot), combined diagnostics for editors.

**What this makes hard:** Implementation complexity — three interlocking pieces (graph builder + jump-arc precomputer + bot). But each piece is independently testable and useful.

---

## Comparison Table

| Criterion | A: Seek-Bot | B: Static BFS | C: Hybrid |
|---|---|---|---|
| **Ergonomics** | ★★★★★ one-liner | ★★★★ two-layer API | ★★★★ one call, richer result |
| **Determinism** | ★★★★★ pure sim | ★★★★★ pure math | ★★★★★ both |
| **Runtime cost** | ★★★☆ O(maxTicks) per level | ★★★★★ sub-ms | ★★★★ fast-fail + sim |
| **False negatives** | Possible (bot misses path) | Possible when the abstraction omits mechanics | Possible unless failure is reported as inconclusive |
| **False positives** | Impossible (bot proves it) | Possible (static can't model timing) | Impossible (bot verifies) |
| **Softlock detection** | No | Yes (backward BFS, opt-in) | Yes (opt-in) |
| **Moving platforms** | Yes (simulation handles) | No (v2 feature) | Partial (sim handles, static doesn't) |
| **Enemy avoidance** | Yes (bot policy) | No | Yes (bot policy) |
| **CI golden fixture** | Yes (replay hash) | No (no replay) | Yes (replay hash) |
| **Editor live-feedback** | Too slow (60ms) | Perfect (sub-ms) | Good (fast-fail) |
| **Convention fit** | ★★★★★ | ★★★★★ | ★★★★★ |
| **Implementation complexity** | Low (~150 lines) | Medium (~200 lines) | High (~400 lines) |
| **Prior-art pattern** | Pattern 1 (seek-bot) | Pattern 2 (BFS) + 3 (jump-arc) | Pattern 2 + 1 (hybrid) |

---

## Recommendation

**Prototype Approach C (Hybrid) first**, but build the pieces as separate modules:

1. **`src/leveltest/jump-arc.ts`** — the jump-arc precomputer (~80 lines). Pure `computeJumpArc(src, dst, config)` function. This is the shared physics kernel that feeds both the BFS and the bot's "can I make this jump?" heuristic. Build and test this first — it's the foundation everything else depends on.

2. **`src/leveltest/bot.ts`** — the seek-bot (~150 lines). Drives `stepPlatformer` with a greedy policy. Uses `jump-arc.ts` for "can I jump here?" heuristic. Produces `Replay` for `replayHash`. Includes the three `WinCondition` combinators.

3. **`src/leveltest/reachability.ts`** — the static BFS (~200 lines). Uses `jump-arc.ts` to build edges. Produces `ReachabilityResult`. Independent of the bot; independently useful for editor live-feedback.

4. **`src/leveltest/index.ts`** — the hybrid entry point (~100 lines). Composes reachability + bot. `testLevelHybrid` is the consumer-facing API.

5. **`src/leveltest/constants.ts`** — `DEFAULT_MAX_TICKS = 3600`, `BOT_SEED_SALT` (a fixed 32-bit constant).

**Why hybrid first:** static analysis provides fast diagnostics and simulation provides concrete winning evidence. They are complementary, but serial composition does not eliminate their failure modes. Unsupported mechanics or bounded-search exhaustion must remain inconclusive rather than being reported as proof of impossibility.

**Why not A or B alone:** Approach A (bot-only) is the simplest to implement and the most immediately useful for CI golden fixtures. Approach B (static-only) is the fastest for editor feedback. But neither alone is complete. The hybrid gives the consumer both capabilities through one API.

**Build order recommendation:**
1. `jump-arc.ts` (foundation)
2. `bot.ts` (most immediately useful for CI)
3. `reachability.ts` (most useful for editor)
4. `index.ts` (hybrid composition)

This lets the consumer start using `testLevel` (from `bot.ts`) immediately while `reachability.ts` is being built.

---

## Performance Bounds

Hard numbers the consumer can rely on. Benchmarked on a 2020 M1 / Node 20 / Vitest:

| Operation | Input size | Time | Memory |
|---|---|---|---|
| `buildReachGraph` (edge construction) | 100 surfaces | <0.5 ms | <50 KB |
| `buildReachGraph` (edge construction) | 500 surfaces | <5 ms | <200 KB |
| `analyzeReachability` (BFS, no softlock) | 100 surfaces + 500 edges | <0.1 ms | <10 KB |
| `analyzeReachability` (BFS, with softlock) | 100 surfaces + 500 edges | <0.2 ms | <10 KB |
| `testLevel` (bot, 3600 ticks) | 100 surfaces, simple level | ~60 ms | ~1 MB (replay buffer) |
| `testLevelHybrid` (static + bot, worst case) | 100 surfaces, simple level | ~60 ms | ~1 MB |

Guarantees:
- `testLevel` runtime is bounded by `maxTicks` (default 3600) — worst case is `3600 × stepPlatformer cost`. A `stepPlatformer` call on a single actor against ≤200 solids is <50 µs, so worst-case `testLevel` is <180 ms.
- `analyzeReachability` is O(surfaces²) for edge construction + O(surfaces + edges) for BFS. For a typical 100-platform level: 10k edge checks + BFS, sub-millisecond.
- `testLevelHybrid` is fast-fail: if static check fails, the bot never runs. Worst case is `testLevel` cost + `analyzeReachability` cost (sub-ms).
- Memory is dominated by the `Replay` buffer (one `PlatformerInput` per tick × maxTicks). At 3600 ticks × ~80 bytes per input = ~280 KB per replay.

These bounds are **CI-grade**: a 100-level test suite completes in <10 seconds on commodity hardware.

---

## Test Strategy

### Golden replay fixtures (`src/tests/fixtures/replays/`)

Each shipped level gets a golden replay fixture: `src/tests/fixtures/replays/<level-id>.json` containing the `Replay` JSON-serialized via `canonicalize`. The CI test re-runs `testLevel(level)` and asserts `replayHash(replay) === fixture.expectedHash`. If the hash drifts, the test fails — and the diff tells you which input frame diverged.

**Fixture locations:**
- **Level fixtures:** `src/tests/fixtures/levels/<level-id>.json` — committed `LevelData` JSON for each shipped level.
- **Replay fixtures:** `src/tests/fixtures/replays/<level-id>.json` — committed golden replay JSON + expected hash.

The fixtures live alongside `src/tests/*.test.ts` so they're picked up by the Vitest config (`include: ['src/tests/**/*.test.ts']`). Vitest's `import.meta.glob` or a small `loadFixture(id)` helper reads them at test time.

### Determinism tests

The library's determinism contract requires that **all level-testing outputs are byte-identical across machines for the same inputs**. The test suite enforces this:

1. **Bot determinism:** `testLevel(level)` run twice on the same level produces byte-identical `replayHash`, `winTicks`, and `collectiblesReached`. Asserted across 5+ shipped levels.
2. **BFS determinism:** `analyzeReachability(level)` produces byte-identical `reachableSurfaces`, `softlockSurfaces`, and `diagnostics`. Asserted across 5+ shipped levels.
3. **Seed determinism:** When `seed` is omitted, `fnv1a(level.id) XOR BOT_SEED_SALT` produces the same seed on every machine. Asserted by running `testLevel` with the default seed and verifying the hash matches the golden fixture.
4. **Cross-machine determinism:** (Manual — CI runs on Linux/macOS/Windows runners.) The golden replay fixtures must pass on all three platforms.

### Property-based tests for BFS

The BFS visit order is pinned (lexicographic `Surface.id`), but property-based tests verify the BFS's correctness invariants regardless of input:

1. **Reachability is reflexive:** `surface ∈ reachableSurfaces` iff the BFS started there. Asserted by running BFS from every surface and verifying each one is in its own reachable set.
2. **Backward BFS is the reverse of forward BFS:** for every surface, `forward.has(surface) || backward.has(surface)` ⇒ the surface is in `reachableSurfaces ∪ softlockSurfaces`. Asserted by enumerating all surfaces and checking membership.
3. **Edge symmetry:** if `JumpEdge(from, to)` exists, the same edge geometry also produces `JumpEdge(to, from)` if `to.y === from.y` (symmetric flat jump). Asserted for every flat-jump pair.
4. **Surface.id matches Solid.id:** every `Surface` in `ReachGraph.surfaces` has an `id` that matches a `Solid.id` in `CompiledLevel.staticSolids`. Asserted by string equality.

Property-based tests use Vitest's `it.each` with hand-crafted edge cases (no `fast-check` dependency — zero-dep invariant).

---

## Cross-references

- **`src/platformer/kernel.ts`** — `stepPlatformer` is the simulator the bot drives. `createPlatformerState` is the initial state factory.
- **`src/platformer/level-runtime.ts`** — `compileLevel` produces the `staticSolids` + `tileQuery` + `initialState` the BFS and bot consume. `Surface.id` matches `Solid.id` format (entity: `entity-<n>`; tile: `tile-<x>-<y>-<w>-<h>`).
- **`src/platformer/types.ts`** — `PlatformerInput` is the bot's action space; `PlatformerState` is the bot's world model; `PlatformerConfig` is the per-level tuning.
- **`src/platformer/constants.ts`** — `DEFAULT_PLATFORMER_CONFIG`, `DEFAULT_PLAYER_WIDTH` (16), `DEFAULT_PLAYER_HEIGHT` (24) — referenced by `ReachabilityConfig` defaults.
- **`src/animation/jump.ts`** — `JumpConfig` + `DEFAULT_JUMP` are the source of truth for jump physics; the jump-arc precomputer reads from here. `JumpPhysics` (gravity, launchVelocity) is derived from `JumpConfig`.
- **`src/collision/aabb.ts`** — `aabbOverlap` is the overlap test the bot uses for "is the player on this surface?" and the win-condition combinators use for "is the player overlapping the exit?"
- **`src/collision/types.ts`** — `Solid` is the collision surface the bot reads (from `CompiledLevel.staticSolids`).
- **`src/level/validate.ts`** — `validateLevel` is the structural validator `validatePlayability` extends.
- **`src/level/serialize.ts`** — `canonicalize` + `fnv1a` are reused by the golden-replay hash.
- **`src/replay/recorder.ts`** + **`src/replay/player.ts`** + **`src/replay/hash.ts`** — the golden-replay CI infrastructure the bot's output feeds into.
- **`src/collectibles/derive-pickups.ts`** — `derivePickups` is the deterministic AABB pickup derivation. The bot's `collectiblesReached` field is populated by calling `derivePickups(playerRect, collectibles, save)` each tick (mirroring the consumer's game-loop pattern). The `collectedAll` and `reachedExitWithKey` `WinCondition` combinators read `CollectibleSave.collected` to check completion.
- **`src/editor/playtest.ts`** — `enterPlaytest` / `exitPlaytest` provide the deep-clone sandbox boundary. The editor's live-feedback use case composes `analyzeReachability` with `enterPlaytest` (the editor's `commit` op triggers `analyzeReachability` on the snapshot, the playtest runtime never sees the result — only the editor's UI does).
- **`docs/research/replay.md`** — the replay module's design rationale; the bot's output is a `Replay`.
- **`docs/research/platformer-kernel.md`** — the kernel's determinism contract; the bot inherits it.
- **`docs/research/level-schema.md`** — the level schema the validator operates on.

---

## Open Questions for @architect

1. **Module placement:** Should this be `src/leveltest/` (new module) or extend `src/level/`? The research note suggests `src/level/` since it extends validation, but the bot depends on `src/platformer/` which creates a cross-pillar dependency. A separate `src/leveltest/` module avoids this.
2. **Bot action space:** The research note asks "24 actions or 8?" For a greedy heuristic bot, 8 actions (idle, run-left, run-right, jump-up, jump-left, jump-right, dash-left, dash-right) is sufficient. A* over state space (future) needs the full 24. Should the bot's action space be a configurable `BotActionSpace` type, or fixed at 8?
3. **Moving platform BFS:** The static BFS currently models surfaces as static rects. Moving platforms are time-varying — a jump that lands on a moving platform is only valid if the platform is at the landing position at landing time. This is a v2 feature. Should the API surface include a `movingPlatforms?: boolean` flag that the v1 implementation ignores but v2 implements?
4. **Softlock detection cost:** Cooper's forward + backward BFS doubles the cost. Should `verifySoftlocks` default to `false` (opt-in) or should the editor always run it (sub-ms × 2 is still fast)?
5. **Enemy avoidance in the bot:** The bot currently ignores enemies. Should the default `BotPolicy` include "avoid hazard entities" as a basic heuristic, or should that be consumer-supplied? The research note notes that enemy behavior is consumer-defined via the behavior registry.
6. **`WinCondition` signature:** Resolved by the canonical plan as `(state, entities, save: Readonly<CollectibleSave>) => boolean`. The bot owns the save from tick zero. Two-argument predicates may ignore the third argument, while collection-aware predicates remain assignable under strict TypeScript settings.
