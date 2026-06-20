# API Proposal: Particle Emitters

> Target pillar: 1 (Primitives / Particles). Module: `src/particles/`.
> Builds on research: `docs/research/particle-emitters.md`.
> Status: DRAFT.

## Consumer Need

Spitekeep currently uses particles for one effect only: a deterministic 8-particle death "poof" (`core/update.ts:44-63`). Particles are hand-constructed with evenly-distributed angles, no RNG, and no regional spawning. The renderer draws them with a fixed palette color and linear alpha fade (`render/sprites.ts:1718-1728`).

This works for one-shot bursts but cannot support:
- **Continuous effects**: Campfires, lava pools, rain, smoke plumes — any effect that emits particles steadily over time.
- **Regional spawning**: Particles emerging from a surface line (lava pool), a rectangle (waterfall), or a ring (shield bubble) rather than a single point.
- **Directional emission**: Fire rising upward in a narrow cone, not bursting radially.
- **Heterogeneous physics**: Fire particles falling back (positive gravity) while smoke rises (negative gravity) — mixed in a single array.

The emitter abstraction extends the existing pure `spawn`/`advance`/`cull` pipeline into these capabilities while maintaining determinism, zero runtime dependencies, and non-breaking compatibility with the shipped `Particle`, `spawn`, `advance`, `cull`, and `step` exports.

---

## Open Questions — Resolution

### 1. RNG Stream Isolation

**Position: Yes — emitters MUST use their own sub-seeded RNG instance.**

Every emitter receives its own `rng` function, derived by sub-seeding from a consumer-provided seed. This prevents regional/cone spawn sampling (which may consume 2-4 RNG calls per particle) from polluting the gameplay simulation's RNG stream. The consumer creates the sub-seed at emitter creation time using `mulberry32(seed)` and passes the resulting function into the emitter. The library does NOT auto-create RNGs — the consumer controls the seed lifecycle.

**Justification:** Spitekeep uses `mulberry32` for deterministic combat, card draws, and trap placement. If particle spawn sampling consumed the same RNG stream, visual variation would alter gameplay outcomes across replays. The research note recommends isolation. This matches the library's convention: "consumer passes dependencies as parameters, library doesn't auto-resolve."

### 2. Reduced-Motion Adaptation

**Position: Config-level rate scaling — consistent with the locomotion proposal's pattern.**

Continuous emitters scale emission rate via a `rateScale` multiplier in the config. The consumer reads `prefersReducedMotion()` in their renderer layer and passes the scale factor:

```ts
const scale = reduceMotion ? 0.25 : 1.0;
const config = { ...fireEmitterConfig, rateScale: scale };
```

The library does NOT call `prefersReducedMotion()` internally. This keeps the deterministic core free of host-API dependencies. The `rateScale` field defaults to `1.0` (full rate) — consumers who don't need reduced motion never touch it.

**Justification:** Matches the locomotion proposal's `scaledGait(config, scale)` pattern exactly. Every tunable number lives in the config object the consumer can spread into their own. The 0.25 factor (4× reduction) is the consumer's policy choice, not the library's.

### 3. Lifetime Curves

**Position: Renderer-adjacent helpers. NOT on the particle.**

Color/size/alpha-over-life are evaluated by the renderer at draw time, using the particle's existing `life`/`maxLife` fields. The library provides two small helper functions:

```ts
function particleAge(p: Particle): number;            // 0→1 normalized age
function particleSizeCurve(p: Particle, start: number, end: number): number;
function particleAlphaCurve(p: Particle, start: number, end: number): number;
```

**Justification:** Keeps `Particle` ultra-lightweight and serializable. Decouples physics from rendering — the same particle array can be drawn differently by different renderers. Matches Spitekeep's existing `drawParticle` pattern: `const alpha = p.maxLife > 0 ? Math.max(0, p.life / p.maxLife) : 0` (`sprites.ts:1719`). The helpers just formalize this.

---

## Approach A: Composable Pure Primitives

**Source pattern:** Research Patterns 1, 2, 3 — individual pure functions (`advanceEmitter`, `sampleRegion`, `sampleConeVelocity`) that the consumer wires together manually.

**Design philosophy:** Small, individually tree-shakeable functions. Maximum composability. Consumer controls the wiring. Matches the library's existing pattern of `spawn` + `advance` + `cull` as separate steps.

**Signature sketch:**

```ts
// src/particles/types.ts — additive non-breaking extensions to Particle

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color?: string;
  // Additive non-breaking extensions — read by advance() via ?? 1.0 defaulting:
  /** Per-particle gravity multiplier. Missing/undefined → 1.0 (no override). */
  gravityScale?: number;
  /** Per-particle drag multiplier. Missing/undefined → 1.0 (no override). */
  dragScale?: number;
}

// NOTE: The existing advance() function in src/particles/advance.ts is extended
// (non-breaking) to read optional per-particle gravityScale and dragScale fields.
// When absent or undefined, each defaults to 1.0 via ?? 1.0, producing byte-identical
// output to the current advance() for all existing Particle[] usage. No separate
// advanceHeterogeneous function is needed — heterogeneous physics comes for free
// via the optional fields on Particle.

// src/particles/regions.ts — new file

export type SpawnRegion =
  | { type: 'point' }
  | { type: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { type: 'rect'; x: number; y: number; w: number; h: number }
  | { type: 'circle'; cx: number; cy: number; radius: number; innerRadius?: number };

/**
 * Deterministically sample a coordinate from a SpawnRegion.
 * Uses seeded RNG for strict determinism. 2-3 RNG calls per sample.
 */
export function sampleRegion(region: SpawnRegion, rng: () => number): { x: number; y: number };

// src/particles/cone.ts — new file

export interface ConeConfig {
  /** Direction of cone center in radians. */
  baseAngle: number;
  /** Total angular width of cone in radians. */
  spread: number;
  /** Minimum spawn speed. */
  speedMin: number;
  /** Maximum spawn speed. */
  speedMax: number;
}

/**
 * Deterministically compute velocity vector within an angular cone.
 * 2 RNG calls per sample (angle + speed).
 */
export function sampleConeVelocity(config: ConeConfig, rng: () => number): { vx: number; vy: number };

// src/particles/emitter.ts — new file

export interface EmissionState {
  /** Accumulated fractional particles to spawn. Pure state. */
  accumulator: number;
}

export interface EmissionRateConfig {
  /** Particles to spawn per unit time. Can be fractional (0.1 = 1 per 10 ticks). */
  rate: number;
}

/**
 * Pure state progression. Integrates elapsed time and returns the number
 * of particles to spawn this tick, plus updated emitter state.
 * The fractional remainder is preserved to prevent particle loss over time.
 *
 * @returns { next, spawnCount } — spawnCount is a non-negative integer.
 */
export function advanceEmitter(
  state: EmissionState,
  dt: number,
  config: EmissionRateConfig,
  rateScale?: number,
): { next: EmissionState; spawnCount: number };

// src/particles/lifetime.ts — new file (renderer-adjacent helpers)

/**
 * Normalized age of a particle: 0 = just spawned, 1 = about to die.
 * Safe to call when maxLife is 0 (returns 0).
 */
export function particleAge(p: Particle): number;

/**
 * Interpolate size over particle lifetime.
 * At age 0 returns startSize, at age 1 returns endSize.
 */
export function particleSizeCurve(p: Particle, startSize: number, endSize: number): number;

/**
 * Interpolate alpha over particle lifetime.
 * At age 0 returns startAlpha, at age 1 returns endAlpha.
 */
export function particleAlphaCurve(p: Particle, startAlpha: number, endAlpha: number): number;
```

**Usage example — Lava pool (fire + smoke):**

```ts
import { mulberry32 } from 'aicraft-engine/src/rng';
import { spawn, step } from 'aicraft-engine/src/particles';
import { sampleRegion, sampleConeVelocity, advanceEmitter } from 'aicraft-engine/src/particles/emitter';
import type { Particle, EmissionState, EmissionRateConfig, SpawnRegion, ConeConfig } from 'aicraft-engine/src/particles/types';

// Config: horizontal line 60px wide, fire rises in a narrow cone
const lavaLine: SpawnRegion = { type: 'line', x1: 100, y1: 300, x2: 160, y2: 300 };
const fireCone: ConeConfig = { baseAngle: -Math.PI / 2, spread: 0.5, speedMin: 1.5, speedMax: 3.0 };
const smokeCone: ConeConfig = { baseAngle: -Math.PI / 2, spread: 1.0, speedMin: 0.5, speedMax: 1.5 };

const fireRate: EmissionRateConfig = { rate: 2.0 };
const smokeRate: EmissionRateConfig = { rate: 0.8 };

// RNG instances — created once at setup time, NOT per frame (would reset the seed)
const fireRng = mulberry32(42);
const smokeRng = mulberry32(99);

// State (persisted across frames)
let fireEmitter: EmissionState = { accumulator: 0 };
let smokeEmitter: EmissionState = { accumulator: 0 };
let fireParticles: Particle[] = [];
let smokeParticles: Particle[] = [];

// Per-frame (deterministic sim tick)
function tick(dt: number, reduceMotion: boolean) {
  const rateScale = reduceMotion ? 0.25 : 1.0;

  // Advance emitters
  const fireEmit = advanceEmitter(fireEmitter, dt, fireRate, rateScale);
  const smokeEmit = advanceEmitter(smokeEmitter, dt, smokeRate, rateScale);
  fireEmitter = fireEmit.next;
  smokeEmitter = smokeEmit.next;

  // Spawn fire particles
  const newFire: Particle[] = [];
  for (let i = 0; i < fireEmit.spawnCount; i++) {
    const pos = sampleRegion(lavaLine, fireRng);
    const vel = sampleConeVelocity(fireCone, fireRng);
    newFire.push({
      x: pos.x, y: pos.y,
      vx: vel.vx, vy: vel.vy,
      life: 30, maxLife: 30, size: 3,
      color: '#ff6600',
      gravityScale: 0.1,  // fire falls slowly
      dragScale: 0.98,
    });
  }

  // Spawn smoke particles
  const newSmoke: Particle[] = [];
  for (let i = 0; i < smokeEmit.spawnCount; i++) {
    const pos = sampleRegion(lavaLine, smokeRng);
    const vel = sampleConeVelocity(smokeCone, smokeRng);
    newSmoke.push({
      x: pos.x, y: pos.y,
      vx: vel.vx, vy: vel.vy,
      life: 60, maxLife: 60, size: 6,
      color: '#888888',
      gravityScale: -0.3,  // smoke rises
      dragScale: 0.95,
    });
  }

  // Merge + advance + cull (pure pipeline)
  fireParticles = step([...fireParticles, ...newFire], dt, { gravity: 0.5 });
  smokeParticles = step([...smokeParticles, ...newSmoke], dt, { gravity: 0.5 });
}
```

**Trade-offs:**
- **Ergonomics:** Consumer calls 5+ functions per emitter per frame (`advanceEmitter` + `sampleRegion` + `sampleConeVelocity` + `step`). Verbose but explicit — every step is visible and testable independently.
- **Determinism:** Maximum. Every function is pure. Sub-seeded RNG per emitter type prevents stream pollution.
- **Runtime cost:** Pure-clone per the existing particles pattern. Allocates new arrays and particle objects each tick. For 50 particles/frame this is ~50 allocations — negligible for low counts, measurable at 500+.
- **Consumer complexity:** Medium. Consumer manages emitter state, RNG instances, spawn loops, and particle arrays. But each piece is small and testable.
- **Tree-shake-ability:** Excellent. Consumer can import just `sampleRegion` without `sampleConeVelocity`, or just `advanceEmitter` without any spawn helpers. Each function lives in its own file.
- **Convention fit:** Matches the existing `spawn` + `advance` + `cull` pattern exactly. Small composable functions, no classes, no hidden state.

**What this makes easy:** Testing individual primitives. Composing region+cone+rate independently. Consumer has full control over spawn loop logic. Easy to swap region shapes without changing velocity sampling.

**What this makes hard:** Wiring multiple emitters requires boilerplate (the spawn loop in the example above). Every new emitter type means copying the spawn loop pattern. No single-call "emit all" convenience.

---

## Approach B: Pure Emitter Config + Unified Step

**Source pattern:** Research Patterns 1-4 combined into a single `EmitterConfig` record + `createEmitter` factory + `stepEmitters` unified pipeline. Inspired by the locomotion proposal's `advanceLocomotion` + `evaluateLocomotion` split — but adapted for the one-to-many emitter-to-particle relationship.

**Design philosophy:** An emitter is a declarative config record. A factory creates an emitter state from that config. A single `stepEmitters` call advances all emitters, spawns new particles, advances all particles, and culls dead ones — all in one pure pass.

**Signature sketch:**

```ts
// src/particles/types.ts — same additive Particle extensions as Approach A

// src/particles/emitter-config.ts — new file

export interface EmitterConfig {
  /** Particles per unit time. Fractional OK. */
  rate: number;

  /** Spawn region shape. Default: { type: 'point' } (spawns at emitter origin). */
  region?: SpawnRegion;

  /** Velocity cone. Default: full radial burst (baseAngle: 0, spread: π*2). */
  cone?: ConeConfig;

  /** Per-particle gravityScale. Default 1.0. */
  gravityScale?: number;
  /** Per-particle dragScale. Default 1.0. */
  dragScale?: number;

  /** Initial particle life in ticks. */
  life: number;
  /** Particle render size. */
  size: number;
  /** Particle color. */
  color?: string;

  /**
   * Seeded RNG for this emitter's isolated stream. Consumer creates it once
   * (e.g. `mulberry32(42)`) and passes the same function reference each
   * frame; recreating it would reset the seed and re-emit the same sequence.
   */
  rng: () => number;

  // --- Nested types (same definitions as Approach A) ---
}

// src/particles/emitter.ts — new file

/**
 * Bundled emitter: config (immutable ref) + rate accumulator + live
 * particles. Each emitter owns its particles, so renderers iterate
 * `emitter.particles` directly. Pure ops: `stepEmitters` returns new
 * `Emitter` objects; inputs are never mutated.
 */
export interface Emitter {
  /** Immutable emitter configuration. */
  readonly config: EmitterConfig;
  /** Accumulated fractional particles. Mutated by stepEmitters, returned as new record. */
  state: EmissionState;
  /** Live particles owned by this emitter. */
  particles: readonly Particle[];
}

/**
 * Per-call options for `stepEmitters`. World-space properties (`gravity`,
 * `drag`) and global concerns (`rateScale`) live here — NOT on EmitterConfig.
 * Fire and smoke share the same world gravity; they differ only in their
 * per-particle `gravityScale`/`dragScale` (which is on EmitterConfig).
 */
export interface StepEmittersOptions {
  /** World gravity (px/tick²) applied to all emitters. Default 0. */
  gravity?: number;
  /** World drag multiplier. Default 1. */
  drag?: number;
  /** Emission rate multiplier (e.g. 0.25 for reduced-motion). Default 1. */
  rateScale?: number;
}

/**
 * Pure unified pipeline: advance all emitters, spawn new particles,
 * advance all existing particles, and cull dead ones. Single call,
 * single return, zero side effects.
 *
 * Each emitter's RNG stream is independent — spawning particles from
 * one emitter does not affect the RNG sequence of another. The consumer
 * creates and passes the RNG function at config time.
 */
export function stepEmitters(
  emitters: readonly Emitter[],
  dt: number,
  opts?: StepEmittersOptions,
): Emitter[];

/**
 * Create an initial Emitter from a config. The emitter starts with an
 * empty accumulator and no live particles.
 *
 * @param config - declarative emitter configuration
 * @returns a fresh Emitter ready to step
 */
export function createEmitter(config: EmitterConfig): Emitter;
```

**Usage example — Lava pool (fire + smoke):**

```ts
import { mulberry32 } from 'aicraft-engine/src/rng';
import { createEmitter, stepEmitters } from 'aicraft-engine/src/particles/emitter';
import type { Emitter, EmitterConfig, StepEmittersOptions } from 'aicraft-engine/src/particles/types';

// Configs: declarative — describe what to emit, not how.
// gravity/drag are NOT here — they're world-space, shared by all emitters.
const fireEmitterConfig: EmitterConfig = {
  rate: 2.0,
  region: { type: 'line', x1: 100, y1: 300, x2: 160, y2: 300 },
  cone: { baseAngle: -Math.PI / 2, spread: 0.5, speedMin: 1.5, speedMax: 3.0 },
  gravityScale: 0.1, dragScale: 0.98,
  life: 30, size: 3, color: '#ff6600',
  rng: mulberry32(42),
};

const smokeEmitterConfig: EmitterConfig = {
  rate: 0.8,
  region: { type: 'line', x1: 100, y1: 300, x2: 160, y2: 300 },
  cone: { baseAngle: -Math.PI / 2, spread: 1.0, speedMin: 0.5, speedMax: 1.5 },
  gravityScale: -0.3, dragScale: 0.95,
  life: 60, size: 6, color: '#888888',
  rng: mulberry32(99),
};

// State (persisted across frames) — each Emitter owns its config + accumulator + particles
let emitters: Emitter[] = [createEmitter(fireEmitterConfig), createEmitter(smokeEmitterConfig)];

// Per-frame (single call)
function tick(dt: number, reduceMotion: boolean) {
  const opts: StepEmittersOptions = {
    gravity: 0.5,
    rateScale: reduceMotion ? 0.25 : 1.0,
  };
  emitters = stepEmitters(emitters, dt, opts);
}

// Render: iterate emitter.particles directly
function render() {
  for (const emitter of emitters) {
    for (const p of emitter.particles) {
      const alpha = p.maxLife > 0 ? p.life / p.maxLife : 0;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color ?? '#ff6600';
      ctx.beginPath();
      ctx.arc(Math.floor(p.x), Math.floor(p.y), Math.max(1, p.size), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
```

**Trade-offs:**
- **Ergonomics:** Highest. One call per frame: `stepEmitters(emitters, dt, opts)`. Each emitter is a single bundled record — no parallel arrays, no index-alignment bugs. Configs are declarative records — easy to serialize, diff, or edit in a tool. Renderers iterate `emitter.particles` directly.
- **Determinism:** Maximum. Pure function. RNG is sub-seeded per emitter at creation. Same emitters + same dt → same output.
- **Runtime cost:** Same allocation profile as Approach A (pure-clone). The unified pass is slightly more efficient because it avoids intermediate array concatenation — the merge happens inside `stepEmitters` without creating temporary spread arrays.
- **Consumer complexity:** Lowest. Consumer manages a single `Emitter[]` array and calls one function. No need to understand the spawn loop, the region sampling, or the cone math — those are encapsulated.
- **Tree-shake-ability:** Medium. The `stepEmitters` function pulls in all spawn helpers, region sampling, cone sampling, and physics. Consumer who only needs `sampleRegion` still gets the entire pipeline if they import `stepEmitters`. However, the individual primitives from Approach A could still be exported alongside for tree-shake-ability.
- **Convention fit:** Good. Matches the "config record + factory + pure step" pattern from `advanceLocomotion`/`evaluateLocomotion`. The bundled emitter eliminates the parallel-array antipattern that the type system can't catch.

**What this makes easy:** Adding a new emitter is a single config record. Multiple emitters from one call. Declarative configs are easy to test, serialize, and tool. Reduced-motion is a per-call opt, not a config mutation. Renderers iterate `emitter.particles` directly — no separate particle array to manage.

**What this makes hard:** Custom spawn logic (e.g., "spawn only when the player is near") requires bypassing `stepEmitters` and using the Approach A primitives. The unified pass doesn't expose intermediate spawn results for custom filtering.

---

## Approach C: Mutable Particle Pool (Renderer-Adjacent) — DEFERRED TO PHASE 1b

> **Phase 1b gate:** Approach C ships only after `@benchmarker` produces a
> `benchmarks/particles/pool-perf.png` validating the zero-allocation claim
> at 500+ and 1000+ particle counts. This is not in v1 scope.

**Source pattern:** Research Pattern 4 (zero-allocation mutable pool) + the "Renderer-output buffer exception" from `docs/architecture.md:15`. The pool is explicitly placed in the renderer-adjacent layer — its state is never read by deterministic simulation logic.

**Design philosophy:** Pre-allocate everything. Mutate in-place. Zero GC pressure. This is the performance-critical path for dense visual FX (500+ particles/frame). The pool is a rendering output buffer, not authoritative simulation state — it can be discarded and rebuilt each frame from authoritative sim data.

**Signature sketch:**

```ts
// src/primitives/pool.ts — new file, renderer-adjacent layer

/**
 * Pre-allocated particle pool. Mutates in-place. Zero allocation per tick.
 *
 * LAYERING: This module is renderer-adjacent. Its contents are never
 * read by deterministic simulation logic. The pool can be discarded
 * and rebuilt each frame from authoritative sim data (e.g., emitter
 * configs + dt). This satisfies the "renderer-output buffer exception"
 * in docs/architecture.md.
 */
export interface EmitterPool {
  /** Pre-allocated particle buffer. Active particles occupy [0, activeCount). */
  readonly particles: Particle[];
  /** Number of live particles in the buffer. */
  activeCount: number;
  /** Accumulated fractional particles for this emitter. */
  accumulator: number;
  /** Emitter RNG (consumer-provided function reference). */
  rng: () => number;
}

export interface PoolConfig {
  /** Maximum simultaneous particles. Pre-allocated at creation. */
  maxParticles: number;
  /** Particles per unit time. */
  rate: number;
  /** Rate multiplier for reduced-motion. Default 1.0. */
  rateScale?: number;
  /** Spawn region. Default: point at (0,0). */
  region?: SpawnRegion;
  /** Velocity cone. Default: full radial. */
  cone?: ConeConfig;
  /** Per-particle gravity scale. Default 1.0. */
  gravityScale?: number;
  /** Per-particle drag scale. Default 1.0. */
  dragScale?: number;
  /** Initial particle life in ticks. */
  life: number;
  /** Particle render size. */
  size: number;
  /** Particle color. */
  color?: string;
  /** RNG function for this emitter's stream. Consumer creates and passes it. */
  rng: () => number;
}

/**
 * Create a pre-allocated pool. Call once. O(maxParticles) allocation,
 * then zero allocations for the pool's lifetime.
 */
export function createPool(config: PoolConfig): EmitterPool;

/**
 * Advance all active particles in-place and compact the live array.
 * Zero allocation. Mutates pool.particles and pool.activeCount.
 *
 * LAYERING: This mutates a rendering-output buffer, NOT authoritative
 * sim state. The pool is rebuilt each frame from sim data.
 */
export function advancePool(pool: EmitterPool, dt: number, opts?: { gravity?: number; drag?: number }): void;

/**
 * Emit particles into the pool from the emitter config.
 * Mutates pool in-place. Zero allocation (uses pre-allocated slots).
 * Silently drops particles when the pool is full and returns the count
 * of dropped particles (0 if all were emitted). Matches the library's
 * "never throw on invalid input" convention.
 */
export function emitIntoPool(
  pool: EmitterPool,
  config: PoolConfig,
  dt: number,
): number;

/**
 * Read-only snapshot of active particles for rendering.
 * Returns a view over the pool's internal buffer — DO NOT mutate.
 * Valid until the next call to advancePool or emitIntoPool.
 *
 * @danger Holding references across ticks will read stale data after
 * advancePool() mutates the buffer. Re-fetch via poolParticles() each frame.
 */
export function poolParticles(pool: EmitterPool): readonly Particle[];
```

**Usage example — Lava pool (fire + smoke):**

```ts
import { mulberry32 } from 'aicraft-engine/src/rng';
import { createPool, emitIntoPool, advancePool, poolParticles } from 'aicraft-engine/src/primitives/pool';
import type { PoolConfig } from 'aicraft-engine/src/particles/types';

const fireConfig: PoolConfig = {
  maxParticles: 200,
  rate: 2.0,
  region: { type: 'line', x1: 100, y1: 300, x2: 160, y2: 300 },
  cone: { baseAngle: -Math.PI / 2, spread: 0.5, speedMin: 1.5, speedMax: 3.0 },
  gravityScale: 0.1, dragScale: 0.98,
  life: 30, size: 3, color: '#ff6600',
  rng: mulberry32(42),
};

const smokeConfig: PoolConfig = {
  maxParticles: 100,
  rate: 0.8,
  region: { type: 'line', x1: 100, y1: 300, x2: 160, y2: 300 },
  cone: { baseAngle: -Math.PI / 2, spread: 1.0, speedMin: 0.5, speedMax: 1.5 },
  gravityScale: -0.3, dragScale: 0.95,
  life: 60, size: 6, color: '#888888',
  rng: mulberry32(99),
};

// Create once
const firePool = createPool(fireConfig);
const smokePool = createPool(smokeConfig);

// Per-frame
function render(dt: number, reduceMotion: boolean) {
  const scale = reduceMotion ? 0.25 : 1.0;

  // Advance physics (mutates in-place)
  advancePool(firePool, dt, { gravity: 0.5 });
  advancePool(smokePool, dt, { gravity: 0.5 });

  // Emit new particles (mutates in-place)
  emitIntoPool(firePool, { ...fireConfig, rateScale: scale }, dt);
  emitIntoPool(smokePool, { ...smokeConfig, rateScale: scale }, dt);

  // Read for rendering (view into buffer, no copy)
  const fire = poolParticles(firePool);
  const smoke = poolParticles(smokePool);

  for (let i = 0; i < fire.length; i++) {
    const p = fire[i];
    const alpha = p.maxLife > 0 ? p.life / p.maxLife : 0;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color ?? '#ff6600';
    ctx.beginPath();
    ctx.arc(Math.floor(p.x), Math.floor(p.y), Math.max(1, p.size), 0, Math.PI * 2);
    ctx.fill();
  }
  // ... same for smoke
}
```

**Trade-offs:**
- **Ergonomics:** Medium. Three calls per pool per frame (`advancePool` + `emitIntoPool` + `poolParticles`). Slightly less verbose than Approach A because the spawn loop is encapsulated in `emitIntoPool`. But the consumer must manage pool instances and max-particle budgets.
- **Determinism:** Maximum. Sub-seeded RNG per pool. All operations are deterministic given the same inputs. However, if the pool fills up, excess particles are silently dropped — this is a capacity constraint, not a determinism issue, but the consumer must size pools correctly.
- **Runtime cost:** Zero allocation per tick after initial `createPool`. The pre-allocated buffer eliminates GC pressure entirely. For 500+ particles/frame this is a significant performance win over Approaches A and B.
- **Consumer complexity:** Medium. Consumer must size pools correctly (too small = dropped particles, too large = wasted memory). Consumer must understand that pool contents are a rendering buffer, not authoritative sim state.
- **Tree-shake-ability:** Medium. The pool module is self-contained — importing it doesn't pull in the pure primitives from Approach A. But the pool is a larger unit (can't import just `advancePool` without the pool type).
- **Convention fit:** This is the "Renderer-output buffer exception" pattern from `docs/architecture.md:15`. The pool mutates its own rendering-output buffers, which are never read by deterministic simulation logic. This is explicitly documented as the only relaxation of "no state mutation" in the architecture. The pool does NOT store authoritative sim data — it's rebuilt each frame from emitter configs.

**What this makes easy:** High particle counts without GC pressure. Simple per-frame API. Clear separation: sim layer uses Approaches A/B for gameplay particles, renderer layer uses Approach C for visual-only FX.

**What this makes hard:** Pool sizing is a consumer responsibility. No dynamic resizing. Custom spawn logic requires accessing the pool's internal RNG (exposed via `pool.rng`). Not suitable for gameplay-affecting particles (these are visual-only).

---

## Comparison Table

| Criterion | A: Composable Primitives | B: Config + Unified Step | C: Mutable Pool (Phase 1b) |
|---|---|---|---|
| **Ergonomics** | Medium (5+ calls/frame) | High (1 call/frame) | Medium (3 calls/pool/frame) |
| **Determinism** | Maximum | Maximum | Maximum |
| **Allocations/tick** | O(N) new objects | O(N) new objects | **Zero** (after createPool) |
| **GC pressure** | Low-moderate | Low-moderate | **None** |
| **Consumer complexity** | Medium (wiring) | Low (declarative, bundled) | Medium (pool sizing) |
| **Tree-shake-ability** | Excellent | Medium | Medium |
| **Convention fit** | Matches spawn+advance+cull | Matches advanceLocomotion | Renderer-adjacent exception |
| **Composability** | Maximum (each fn independent) | Medium (unified pass) | Low (pool is one unit) |
| **Custom spawn logic** | Easy (write your own loop) | Hard (bypass stepEmitters) | Medium (access pool.rng) |
| **Layer placement** | Deterministic core | Deterministic core | Renderer-adjacent |
| **Suitable for sim-affecting FX?** | Yes | Yes | **No** (visual-only) |
| **Max practical count** | ~200/frame | ~200/frame | **1000+/frame** |
| **v1 scope** | **Yes** | **Yes** | **No** (Phase 1b) |

---

## Recommendation

**v1 scope: Approach A primitives + Approach B pipeline + lifetime helpers + Particle extensions.**

**Primary API (Approach B):** The bundled `Emitter` record + `createEmitter` + `stepEmitters` pattern is the best default. It matches the locomotion proposal's `advanceLocomotion`/`evaluateLocomotion` split, keeps consumer boilerplate minimal, and the configs are easy to serialize for editor tools. For Spitekeep's immediate needs (campfires, lava pools, death effects), Approach B provides the best ergonomics with zero performance concern — these effects use <50 particles.

**Approach A primitives are NOT dropped.** They are the implementation substrate for Approach B's config types (`SpawnRegion`, `ConeConfig`). Approach A's `sampleRegion`, `sampleConeVelocity`, and `advanceEmitter` are exported as standalone functions for consumers who need custom spawn logic. Approach B's `stepEmitters` internally delegates to these primitives.

**Lifetime helpers + Particle extensions ship in v1.** `particleAge`, `particleSizeCurve`, `particleAlphaCurve` are renderer-adjacent and trivially useful. The `gravityScale`/`dragScale` optional fields on `Particle` enable heterogeneous physics via the extended `advance()`.

**Why not Approach A alone?** The boilerplate is significant. Spitekeep's dev iterating on a lava pool effect shouldn't need to write a spawn loop — that's library internals. The bundled `Emitter` record eliminates the parallel-array antipattern entirely; each emitter owns its config + accumulator + live particles, so the type system catches misalignment.

**Deferred: Approach C (mutable pool).** See [Phase 1b Follow-up](#phase-1b-follow-up-particle-pool) below.

---

## Phase 1b Follow-up: Particle Pool

> Approach C (`EmitterPool`, `createPool`, `advancePool`, `emitIntoPool`, `poolParticles`)
> is deferred until a benchmark validates the zero-allocation claim.

**Gate:** `@benchmarker` must produce `benchmarks/particles/pool-perf.png` demonstrating
measurable allocation reduction at 500+ and 1000+ particle counts vs. the pure-clone
pattern from Approaches A/B. Only then does `@coder` implement the pool.

**File location:** `src/primitives/pool.ts` — NOT `src/particles/pool.ts`. The pool is
mutation-heavy renderer-adjacent code; `src/primitives/` is the established
renderer-adjacent home (it already contains `motion.ts`). Note: `docs/architecture.md`
line 10 will need updating to list the pool under renderer-adjacent when it ships.

**Config-type hierarchy:**
```ts
interface PoolConfig extends EmissionRateConfig {
  maxParticles: number;
}
```
This extends `EmissionRateConfig` (Approach A's rate-accumulator config) to prevent
copy-paste drift when the pool is added later.

**Capacity failure semantics:** When `emitIntoPool` can't fit all requested particles
(pool full), it silently drops excess particles and returns the count of dropped
particles as a diagnostic. This matches the library's "never throw on invalid input,
silent no-op" convention. The consumer can log or act on the return value at their
discretion.

**`@danger` JSDoc on `poolParticles()`:** The function returns `readonly Particle[]`
— a view into the pool's internal buffer, NOT a copy. The JSDoc must warn:
> **@danger** Holding references across ticks will read stale data after
> `advancePool()` mutates the buffer. Re-fetch via `poolParticles()` each frame.

---

## Layering Constraint — Resolved

**Approach C's mutable pool requires the "renderer-output buffer exception" from `docs/architecture.md:15`.** When it ships in Phase 1b, the pool lives at `src/primitives/pool.ts` — the established renderer-adjacent home. Its contents are never authoritative sim state — the consumer rebuilds the pool each frame from emitter configs.

**Resolution:** `src/primitives/pool.ts` wins over `src/particles/pool.ts`. The pool is mutation-heavy renderer-adjacent code. `src/primitives/` already contains `motion.ts` (the canonical defensive adapter example) and is documented as renderer-adjacent. Placing the pool here keeps `src/particles/` purely deterministic core. The `docs/architecture.md` line 10 listing will be updated when the pool ships.

---

## Implementation Notes for @coder

1. **Non-breaking additions only.** The existing `Particle`, `spawn`, `advance`, `cull`, `step` exports stay byte-identical. The `gravityScale`/`dragScale` fields on `Particle` are optional — existing code that never sets them is unaffected.

2. **File structure:**
   - `src/particles/types.ts` — add `gravityScale?` and `dragScale?` to `Particle` interface
   - `src/particles/regions.ts` — `SpawnRegion` type + `sampleRegion` function
   - `src/particles/cone.ts` — `ConeConfig` type + `sampleConeVelocity` function
   - `src/particles/emitter.ts` — `EmissionState` + `EmissionRateConfig` + `advanceEmitter` (time accumulator) + `Emitter` + `EmitterConfig` + `StepEmittersOptions` + `createEmitter` + `stepEmitters`
   - `src/particles/lifetime.ts` — `particleAge`, `particleSizeCurve`, `particleAlphaCurve`
   - `src/particles/index.ts` — barrel re-exports (update)

3. **JSDoc on every public export.** Document the contract, not the implementation. Include `@returns` and `@throws` where applicable.

4. **Constants in config defaults.** No magic numbers in function bodies. If `advanceEmitter` uses a default accumulator of `0`, document it in the JSDoc, not as a magic constant.

5. **`advance()` extension must be backward-compatible.** Particles without `gravityScale`/`dragScale` must behave identically to the current `advance()` output. The `?? 1.0` defaulting ensures byte-identical math for existing usage. This is a non-breaking extension of the shipped function — the body changes but the mathematical output for existing Particle[] is preserved.

   > **⚠ Integration note for @coder:** The shipped `src/particles/advance.ts` enumerates particle fields explicitly in its return object literal (lines 36–45: `x`, `y`, `vx`, `vy`, `life`, `maxLife`, `size`, `color`) — it does **NOT** spread `...p`. When extending `advance()` to read `gravityScale`/`dragScale`, you **must add those two fields to the output object literal** or particles lose their physics profile after one tick. The prototype at `src/_prototype/particle-emitters-spike.ts` uses `...p` which sidesteps this; the real implementation must not.

6. **`stepEmitters` must produce byte-identical output** given the same `(emitters, dt, opts)` inputs. The RNG function reference must be stable — the consumer passes the same function for the same emitter.

7. **Pool `advancePool` and `emitIntoPool` mutate in-place.** This is intentional and documented. The `readonly` return from `poolParticles` is a view, not a copy — the consumer must not hold references across ticks.

---

## Open Questions for @architect

1. **Pool file location:** RESOLVED — `src/primitives/pool.ts` wins. The pool is mutation-heavy renderer-adjacent code; `src/primitives/` is the established renderer-adjacent home (already contains `motion.ts`). See [Layering Constraint — Resolved](#layering-constraint--resolved) section.

2. **`advanceHeterogeneous` vs extending `advance`:** RESOLVED — The existing `advance()` is extended to read optional per-particle `gravityScale`/`dragScale` fields (defaulting to `1.0` via `?? 1.0`). No separate `advanceHeterogeneous` function. This eliminates `src/particles/physics.ts` and the `HeterogeneousOptions` type. Non-breaking: existing Particle[] without these fields produces byte-identical output.

3. **Pool capacity failure semantics:** RESOLVED — Silently drop excess particles and return the count of dropped particles. This matches the library's "never throw on invalid input, silent no-op" convention. The consumer can log or act on the return value at their discretion. See [Phase 1b Follow-up](#phase-1b-follow-up-particle-pool) "Capacity failure semantics" paragraph.

4. **Sub-seed derivation:** RESOLVED — The consumer provides `rng: () => number` per emitter (not a seed number). This matches the existing `SpawnOptions.rng?: () => number` convention, lets consumers share/correlate RNGs between emitters, and avoids the library hard-coding `mulberry32`.
