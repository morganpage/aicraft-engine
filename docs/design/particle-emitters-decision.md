# Decision: Particle Emitters (`src/particles/emitter.ts`, `regions.ts`, `cone.ts`, `lifetime.ts`; extended `advance.ts`)

**Status:** APPROVED — proceeds to TDD implementation.
**Inputs:** `docs/research/particle-emitters.md` · `docs/design/particle-emitters-proposal.md` · architect critique (NEEDS REVISION minor → APPROVED, loop 2/2) · prototype `src/_prototype/particle-emitters-spike.ts` · benchmark `benchmarks/particle-emitters/lava-pool.png`.

## Decision

Adopt **Approach A (composable primitives) + Approach B (bundled pipeline)** for v1. Approach C (mutable pool) is deferred to Phase 1b behind a separate benchmark. The shipped `spawn`/`advance`/`cull`/`step`/`Particle` exports stay byte-identical; the extension is purely additive.

- **Region sampling** (`regions.ts`): `sampleRegion(region: SpawnRegion, rng) → {x, y}`. `SpawnRegion` is a discriminated union (`{type:'line',x1,y1,x2,y2}` minimum; rect/circle-outline as bonus). Fixed RNG-draws-per-shape (line: 1, rect: 2, circle: 2) for clean determinism audits.
- **Cone velocity** (`cone.ts`): `sampleConeVelocity(config: ConeConfig, rng) → {vx, vy}`. Base angle + angular spread + speed (with optional jitter). Upward cones for fire/smoke.
- **Emission accumulator** (`emitter.ts`): `advanceEmission(state: EmissionState, dt, config: EmissionRateConfig) → { next: EmissionState; spawnCount: number }`. Pure rate-accumulator returning the next state and how many particles to spawn this tick.
- **Extended `advance()`** (`src/particles/advance.ts`, in-place): reads optional per-particle `gravityScale?`/`dragScale?` (default `?? 1.0`). Existing particles without those fields produce byte-identical output. **⚠ Implementation note:** the shipped `advance()` enumerates fields explicitly in its return literal (no `...p` spread) — the implementation MUST add `gravityScale`/`dragScale` to the output object or particles lose their physics profile after one tick. No separate `advanceHeterogeneous` function — extending `advance()` gives `step()` heterogeneous support for free.
- **Bundled `Emitter` record** (`emitter.ts`): `createEmitter(config: EmitterConfig) → Emitter`. Each `Emitter` owns its config + accumulator + live particles in one record. `stepEmitters(emitters, dt, opts?) → Emitter[]`. **The bundled shape replaces the proposal's original parallel-array `stepEmitters(emitters, configs, particles, dt, opts)` signature** — the prototype found 5-arg parallel arrays to be a class of index-desync bug the type system cannot catch.
- **Per-call world opts** (`StepEmittersOptions`): `{ gravity?, drag?, rateScale? }`. `gravity`/`drag` are world properties (fire and smoke share world gravity; they differ only in their per-particle *scale* of it). `rateScale` is the reduced-motion hook (you don't reduce fire but not smoke).
- **RNG threading**: `rng: () => number` on `EmitterConfig`. Consumer creates `mulberry32(subSeed)` once at setup time and passes the function. Matches the existing `SpawnOptions.rng` convention; lets consumers share/correlate RNGs between emitters.
- **Lifetime curves** (`lifetime.ts`, renderer-adjacent): `particleAge(p)`, `particleSizeCurve(p, ...)`, `particleAlphaCurve(p, ...)` — pure helpers for fade/scale/color-over-life. NOT stored on the particle; evaluated by the renderer at draw time.

## Ratified from prototype + benchmark

- **Bundled `Emitter` shape adopted** (prototype finding). The original 5-arg parallel-array signature was unworkable; the bundle eliminates index-desync bugs and lets renderers iterate `emitter.particles` directly.
- **`rateScale` lifted to `StepEmittersOptions`** (prototype finding). Having it on both `EmitterConfig` AND per-call opts caused confusion; reduced-motion is a global concern.
- **`gravity`/`drag` lifted to `StepEmittersOptions`** (prototype finding). They are world properties, not emitter properties.
- **`next` over `nextState`** on `advanceEmission` return — shorter, clear in context.
- **Benchmark verdict (`benchmarks/particle-emitters/lava-pool.png`):** the lava pool reads convincingly. Fire (positive `gravityScale: 0.6`) launches up and falls back as sparks/embers; smoke (negative `gravityScale: -0.4`) rises smoothly and fades. Steady-state counts converge exactly (fire ~58/60, smoke ~48/48) — accumulator math and cull behavior are correct. Heterogeneous physics confirmed working.

## What was rejected

- **Approach C (mutable pool) in v1** — premature. The lava pool uses <60 particles; the pool's zero-allocation claim is untested at 1000+. Deferred to Phase 1b behind `benchmarks/particles/pool-perf.png`. When it ships: `src/primitives/pool.ts` (renderer-adjacent, NOT `src/particles/`); `PoolConfig extends EmissionRateConfig`; silent drop + return count on capacity overflow; `@danger` JSDoc on `poolParticles()` (readonly view, not a copy).
- **`advanceHeterogeneous` as a separate function** — would duplicate `advance()` semantics and require a parallel `stepHeterogeneous`. Extending `advance()` in place is cleaner and gives `step()` heterogeneous support for free.
- **`seed: number` on config (library auto-creates RNG)** — couples the emitter to `mulberry32`, prevents correlated RNG streams between emitters, and contradicts the existing `SpawnOptions.rng` convention.
- **Library-internal `prefersReducedMotion()` probe** — layer violation. The consumer reads the probe and passes `rateScale` via opts.

## Cross-references

- `docs/research/particle-emitters.md` — prior-art survey.
- `docs/design/particle-emitters-proposal.md` — API proposal (Approaches A/B/C, revised).
- `src/_prototype/particle-emitters-spike.ts` — prototype that drove the bundled-Emitter and opts findings.
- `benchmarks/particle-emitters/lava-pool.png` — the benchmark that validated the lava pool use case.
- `benchmarks/_scripts/particle-emitters-render.ts` — reproducible render script.
