# Decision: Procedural Spider Locomotion & Organic Body

> Status: **APPROVED — Approach B (hybrid)** — benchmark-validated.
> Technique reads as a scary, scuttling, multi-legged spider (vision QA: 9/10 scary).

## Decision

Approve **Approach B (refined hybrid): Pure Gait-Solver + Renderer** from `procedural-spider-locomotion-proposal.md`.

Ship a new `src/animation/spider/` module with a clean layer split:
- **Deterministic core** (`gait.ts`, `ground-sample.ts`, `spider-state.ts` facade) — pure, tick/dt-driven, TDD-isolatable, zero rendering imports.
- **Renderer-adjacent** (`spider.ts`) — `evaluateSpiderPose` + `drawSpider`, composing `solveLimb` + `spring-rod` + `breathe` + seeded jitter.

## Why this approach

1. **Matches the library's established split.** The animation pillar already separates pure core (`locomotion.ts`, `foot-lock.ts`) from renderer-adjacent composition (`ik/`, `skin.ts`). Approach B extends this exactly. Approach A (monolithic) would have tangled gait logic with rendering, making isolated TDD impossible. Approach C (generic `LegSystem`) was rejected as premature generalisation — no second creature (crab/insect/centipede) exists yet, per the elastic-rod precedent.
2. **The new gait logic is genuinely novel and must be testable.** Alternating-tetrapod coordination + frantic free-stepping + comfort-radius step triggers + parabolic Bezier step arcs + lazy ground sampling + fail-safe tucking are all new deterministic logic with subtle coordination rules. They need failing-tests-first, in isolation, with mock `TileSolidityQuery` — no Canvas2D, no IK. Only Approach B gives that.
3. **The hybrid facade restores ergonomics.** A thin deterministic-core facade (`createSpiderState` / `stepSpider`) bundles gait + pedipalp advancement, so consumers get Approach A's simple 4-call flow (`createSpiderState` → `stepSpider` → `evaluateSpiderPose` → `drawSpider`) without sacrificing the layer split or testability.
4. **Future-extendable without built-now scope creep.** Wall/ceiling climbing stays OUT of v1 (floor-only, downward sampling hard-coded). The `sampleGround(direction)` signature is the non-breaking hook for multi-surface later — a config-field strategy, not dead code.

## Scope (LOCKED by user)

- **Gait:** both `'coordinated'` (alternating tetrapod) and `'frantic'` (free-stepping + neighbour-lock), switchable via `SpiderConfig.mode`.
- **Legs:** 4 foreground + 4 background (darker, offset) — full 8-leg silhouette, no clutter.
- **Climbing v1:** floor/platform walking ONLY. Feet sample downward via `TileSolidityQuery`. No wall/ceiling in the shipped API.
- **Body:** full segmented — cephalothorax + lagging breathing abdomen (volume-preserving squash/stretch), 8 eyes (varied size), chelicerae fangs, two twitchy spring-rod pedipalps, seeded body-outline jitter (stable per spider via `mulberry32(seed)` alone, no tick).

## Benchmark validation

Prototype at `src/_prototype/spider.ts` + render at `benchmarks/_scripts/spider-render.ts` → `benchmarks/spider/sample-sheet.png` (4 panels: coordinated walk, frantic scuttle, 3-palette body showcase, multi-spider swarm). Two vision QA passes by `@benchmarker`:

- **QA #1:** technique sound (body/eyes/fangs/palps/jitter/palette all read well; rated potential 9/10) but render script had 3 harness bugs (dt-unit mismatch, floor clipping, panel-3 coordinates) + gait stepped too eagerly. Fixed in a focused round.
- **QA #2:** **PROCEED — 9/10 scary.** Legs arch upward (correct splay), coordinated gait reads as a rolling-wave predatory stalk, frantic mode is chaotically distinct, body segments/eyes/fangs/palps/jitter/bg-legs/swarm all read correctly. Determinism confirmed (byte-identical PNG across runs). `npm run build` clean; all 1542 tests pass.

## Open-question rulings (decided during critique)

- **Q1 — gait location:** `src/animation/spider/gait.ts` (spider sub-module). Defer promotion to `src/animation/gait.ts` until a second multi-legged creature materialises (elastic-rod precedent). `locomotion.ts` continues to own the biped space.
- **Q2 — `GaitState` layer:** **authoritative deterministic-core state** (persisted in `EnemyState.data`, pure-clone progression, full TDD). It is NOT renderer-caching like `Rig.worldTransforms`: it is the input to the next `advanceGait`, not a rederived cache. Renderer reads-only.
- **Q3 — pedipalps:** **hybrid** — the `createSpiderState`/`stepSpider` facade advances gait + both palp spring-rods together (deterministic core). The pure `advanceGait` and `advanceSpringRod` remain independently composable and testable.
- **Q4 — config split:** keep `GaitConfig` + `SpiderVisualConfig` as internal concerns; the facade takes the combined `SpiderConfig` and splits via `splitSpiderConfig`. Keeps palette/eye-radius fields out of the deterministic core.

## Implementation notes

- **New module:** `src/animation/spider/` — `types.ts`, `gait.ts`, `ground-sample.ts`, `spider-state.ts`, `spider.ts`, `constants.ts` (`DEFAULT_SPIDER`, `DEFAULT_SPIDER_PALETTE`), `index.ts`. Port from the validated `src/_prototype/spider.ts`, then delete the prototype.
- **TDD (mandatory for deterministic core):** failing tests FIRST for `advanceGait` (coordinated set-staggering, frantic neighbour-lock, comfort-radius trigger, step-arc interpolation, fail-safe tuck), `sampleGround` (downward sampling, no-ground-found path, passthrough), `sampleStepArc` (Bezier correctness), `stepSpider` (gait+palp composition). Use mock `TileSolidityQuery`.
- **Renderer (clean implementation, smoke-tested):** `evaluateSpiderPose` + `drawSpider`. Verify via a fresh benchmark render (re-run `spider-render.ts`) that output matches the validated prototype.
- **Enemy-registry wiring:** register a `'spider'` behavior handler in `src/platformer/enemy/registry.ts` (free-string archetype — NO union change). The handler drives `stepSpider` with the enemy's body x/y/vx/vx + the level's `TileSolidityQuery`; the renderer calls `evaluateSpiderPose` + `drawSpider`. Movement AI (patrol/chase) is consumer-owned; the renderer is decoupled.
- **Exports:** add to `docs/api-surface.md` under a new `src/animation/spider/` section; re-export from `src/animation/index.ts` and the top-level barrel.

## Tuning items deferred to implementation (from vision QA)

1. **Foot-snap fix (high):** feet currently plant ~13-16px below the drawn floor line due to 16px tile-grid snapping in `sampleGround`. Adjust the floor render offset or the target plant height so feet sit on the floor's top surface. (Cosmetic, not logic.)
2. **Lower posture (medium):** bring the body slightly closer to the ground for heavier predatory feel.
3. **Palp twitch (medium):** add high-frequency micro-jitter to the pedipalps/fangs so they look like they're tasting the air.
4. **Knee spikes (low):** tiny thickness bump or 1px spike at knee joints for texture/menace.

## Process transparency

The `@architect` subagent returned empty results on two consecutive critique invocations (infrastructure failure, not a verdict). The orchestrator performed the adversarial critique on the record — finding 4 defects (now fixed) and ruling on the 3 open questions above. The critique notes are folded into the revised proposal's "Open Questions" section.

## Inputs

- Research: `docs/research/procedural-spider-locomotion.md`
- Proposal: `docs/design/procedural-spider-locomotion-proposal.md` (revised)
- Benchmark: `benchmarks/spider/sample-sheet.png` (+ `benchmarks/spider/README.md`, `benchmarks/_scripts/spider-render.ts`)
- Prototype: `src/_prototype/spider.ts` (to be ported then deleted)
- Anchors: `docs/architecture.md`, `docs/conventions.md`, `docs/design/platformer-enemy-archetypes-decision.md`
