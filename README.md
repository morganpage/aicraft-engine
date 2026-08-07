# aicraft-engine

> Ultra-minimalist procedural rendering + algorithmic cosmetics + IAP bridge for AI Craft games.
> Zero runtime dependencies. Canvas2D-only. Strict TypeScript. Vitest.

---

## What this is

A small TypeScript library extracted from the [Spitekeep](https://github.com/) codebase (now renamed **IMP - Not a Troll**) and generalised for reuse across every game in the [Clone-to-Jest pipeline](../ai-craft-strategy/knowledge/clone-to-jest-methodology.md). Three principles drive every design decision:

1. **Procedural-first rendering** — characters, worlds, and effects are drawn from vector primitives in code. Inspired by [Sokpop Collective](https://sokpop.itch.io/)'s ~100-title catalog and their public [fake-3D demo](https://sokpop.itch.io/sokpop-fake-3d-demo). CC0/PD pixel art is also a first-class citizen: the `src/sprites` pipeline plays Aseprite-JSON sprite sheets (one `.json` + one `.png` = a whole game's cast), and the two can be mixed per-entity in one scene.
2. **Algorithmic cosmetics** — skins, themes, and content variants are parameter presets, not art files. The algorithm IS the art. This gives a full IAP cosmetics surface with zero asset pipeline.
3. **Determinism everywhere** — the same inputs always produce the same outputs. No `Math.random` in deterministic code (renderers may use it only when the result never feeds back into the simulation). Saves, replays, and recorded footage all reproduce exactly.

---

## What it provides (when complete)

| Pillar | Modules | Status |
|---|---|---|
| **1. Primitives** | `outlineRect`, `shade`, color guards, device-pixel camera snapping, motion probe, surface ripple (`waveDisplacement`, `generateWaveLine`), hit-stop (freeze-frame game-feel), additive glow (`drawGlow`), parallax scroll (`parallaxOffset`, `drawTiledParallax`) | **Shipped** |
| **1. RNG** | Seeded mulberry32, distribution helpers, stateless typed visual-address folding | **Shipped** |
| **1. Particles** | Deterministic spawn / advance / cull, region/cone sampling, continuous emitters, heterogeneous physics | **Shipped** |
| **1. Animation** | Skeletal rig, IK (limb/CCD/FABRIK), procedural locomotion, squash/stretch, Verlet springs, foot-lock, oscillators, procedural spider enemy, and seeded visual-only humanoid body plan | **Shipped** |
| **1. Character body plans** | Typed body-plan registry plus deterministic humanoid config, displacement-driven visual state, signed-gravity poses, and Canvas2D renderer | **Shipped** |
| **1. Sprite animation** | Aseprite-JSON-superset pipeline: one `.json` + one `.png` defines a whole game's cast. Defensive never-throws parser, grid + explicit-rect frames, named animations (`frameTags`), multi-character `characters[]`, deterministic per-frame-duration player (loop/reverse/pingpong), facing mirror + silhouette tint, and a character-agnostic anim-state deriver shared by player and enemies | **Shipped** |
| **1. Collision** | AABB overlap, per-axis move-and-resolve, tile-grid collision (one-way platforms), moving-gap platforms, capped supercover line of sight | **Shipped** |
| **1. Camera** | Follow camera (lerp, clamp, snap-to-target) | **Shipped** |
| **1. Input** | Edge accumulator, keyboard adapter, touch-button adapter, multi-touch button set, gamepad adapter (Standard Gamepad, axial deadzone), OR-merge | **Shipped** |
| **1. Game loop** | Fixed-step accumulator, defensive RAF adapter, spiral-of-death guard, visibilitychange pause | **Shipped** |
| **1. Game state** | Pure `dt`-driven FSM reducer (`reduceGameState`, `createGameState`, `isLegalTransition`), declarative adjacency table (`DEFAULT_GAME_STATE_ADJACENCY`); menu/playing/paused/gameover/levelComplete | **Shipped** |
| **1. Audio** | WebAudio synthesized SFX adapter (oscillator tones, filtered noise), defensive lazy-unlock, mute/volume | **Shipped** |
| **1. Music** | Procedural step-sequencer — pure theory, seeded patterns, boundary-correct fixed-step `advanceSequencer`, autonomous `createSequencer`, and external-event `createNoteFirePlayer` adapters | **Shipped** |
| **1. Save** | Defensive localStorage/memory backends, JSON load/write helpers (`SaveStorage`, `loadSave`, `writeSave`) | **Shipped** |
| **1. Replay** | Replay record/playback — fluent `createReplayRecorder` (mutable renderer-output buffer), pure `playReplay` re-sim driver (calls consumer's `step`), deterministic 32-bit `replayHash` fingerprint via `canonicalize` + `fnv1a` (share-codes / CI verification); zero new determinism work — reuses `stepPlatformer` kernel | **Shipped** |
| **1. Blend** | Pose-interpolation primitives (`Pose2D`, `blendPose`, `blendPoses`) — independent of animation pillar | **Shipped** |
| **1. Easing & tween** | Penner easing curves (`linear`, `easeOutCubic`, `easeOutBack`, `easeOutElastic`, `easeOutBounce`, …), generic `powOut`, inversion helpers (`easeIn`, `easeInOut`), fixed-step tween driver (`createTweenState`, `advanceTween`) | **Shipped** |
| **1. Bitmap text** | Asset-less 5×7 pixel font (full printable ASCII, MIT-sourced glyph data), pure `measureText`, `drawText` / `drawTextOutlined`, font registry (`createFont`, `addGlyph`, `DEFAULT_FONT`) | **Shipped** |
| **1. Platformer kernel** | Composable character controller + ability pipeline, signed gravity with gravity-relative support/carry, stable physical contact identity, deterministic tick | **Shipped** |
| **1. Enemy archetypes** | Enemy compile/step pipeline + behavior registry (`spinny`, `turret`, `spider`, telegraphed `charger`), projectiles, renderer, custom-handler dispatch via `EnemyBehaviorHandler` | **Shipped** |
| **2. Palette** | OKLCH substitution, harmonic generation, WCAG AA contrast repair | **Shipped** |
| **2. Cosmetics** | Versioned manifest, seeded variant generation, multi-slot ownership | **Shipped** |
| **2. Level schema** | Versioned platformer levels, migration and validation, standalone tile queries, and unified `compileLevel` output combining captured tile collision with entity geometry | **Shipped** |
| **2. Level generation** | Procedural level generator — route-graph generation, rhythm/pacing planning, motif-based geometry, physics-constrained realization, candidate search with quality scoring, targeted repair, diversity/novelty tracking, and difficulty calibration. Entry point: `generateLevel(seed, config) → GeneratedLevel` | **Shipped** |
| **2. Terrain rendering** | Prepared connectivity and exposure, normalized materials, seamless connected tiles, deterministic exposed-edge treatments, and role-aware rectangle rendering | **Shipped** |
| **3. Level themes** | Two-stage theme/level preparation, ordered render passes, resolved runtime entities, and Ruins/Cavern/Mechanical/Outdoor examples | **Shipped** |
| **4. Semantic level art** | Themed exits, coin/gem/key silhouettes, warning-form traps, edit-only markers, and stateless reduced-motion atmosphere recipes | **Shipped** |
| **5. Visual authoring** | Art/Collision editor previews, consumer-supplied theme selection and fallback, structural re-preparation, and deterministic thumbnails | **Shipped** |
| **2. Collectibles** | First-class `'collectible'` `EntityKind`, pure-progression-ops `CollectibleSave` mirroring `cosmetics/ownership.ts` (`collect`/`hasCollected`), pure `derivePickups` (deterministic AABB collision — kernel unaware, zero replay impact); per-level scoping is consumer-owned via `Record<levelId, CollectibleSave>` | **Shipped** |
| **2. Editor core** | Headless level-editor operations: serializable ops + snapshot undo/redo, transactions, multi-select, grid + edge snapping, in-memory clipboard, sandbox playtest boundary, prefab catalog. `applyOp`, `undo`, `beginTransaction`, `selectInRect`, `snapToEdges`, `enterPlaytest`, `DEFAULT_CATALOG` | **Shipped** |
| **2. Level testing** | Platformer level verification — jump-arc trajectory sampling, static reachability BFS, platformer simulation adapter, three bot policies (cautious/direct/collector), win conditions, and tri-state `verifyLevel`/`verifyCompiledLevel` (proven-beatable / proven-unreachable / inconclusive) | **Shipped** |
| **Cross-cutting simulation testing** | Generic deterministic simulation-test core — fixed-tick orchestration, policy execution, trace recording/playback, and honest `verifyScenario` / `playSimulationTrace` / `simulationTraceHash`. Zero imports from platformer/level/editor; `leveltest` is the platformer adapter | **Shipped** |
| **3. IAP** | Bridge adapter interface, entitlement store, pure progression ops, memory + localStorage dev adapters (Poki/Jest/StoreKit/Play Billing deferred to Phase 5) | **Shipped** |
| **4. Fake-3D** | Billboarding, isometric tiles, orthographic cube, heightmap | Phase 4 |
| **5. Platform adapters** | Jest SDK, Poki SDK | Phase 5 (on-demand) |

---

## Install (submodule)

The library is consumed as a git submodule to preserve consumer-side zero-runtime-deps invariants and keep source greppable for AI agents.

```bash
# From your game repo
git submodule add <aicraft-engine-url> src/lib/aicraft-engine
git commit -m "Add aicraft-engine submodule"
```

Then import from a relative path:

```ts
import { outlineRect, shade } from './lib/aicraft-engine/src/primitives';
import { mulberry32 } from './lib/aicraft-engine/src/rng';
```

Vite + `moduleResolution: "bundler"` handle relative imports transparently — no build plumbing changes in the consumer. See `docs/integration.md` for full details.

## Install (npm)

The library is also published as compiled ESM + `.d.ts` (no source ships). The emitted entry is `dist/index.js` with full type declarations; consumers resolve it through `package.json` `exports`:

```bash
npm install aicraft-engine
```

```ts
import { outlineRect, mulberry32, spawn } from 'aicraft-engine';
```

`sideEffects: false` is set, so bundlers tree-shake aggressively. Only `dist/` + `README.md` + `package.json` ship — `src/`, `tests/`, `showcase/`, `docs/`, and `benchmarks/` are excluded. The tarball carries no runtime dependencies.

> **Bundler required.** The emitted ESM uses extensionless internal imports (`moduleResolution: "bundler"`). It resolves cleanly through Vite/esbuild/webpack but not through plain Node ESM without a bundler — appropriate for a Canvas2D game library whose consumers all bundle.

---

## Usage

```ts
import { outlineRect, shade } from './aicraft-engine/src/primitives';
import { mulberry32 } from './aicraft-engine/src/rng';
import { spawn, step } from './aicraft-engine/src/particles';

// Deterministic PRNG — same seed, same sequence, forever
const rng = mulberry32(12345);

// Flat-fill rect with 1px dark outline (matches GDD §11.3 art rules)
outlineRect(ctx, 100, 100, 32, 32, '#FE5701');

// Deterministic particle burst — 8 particles, evenly distributed
let particles = spawn(player.x, player.y, {
  count: 8,
  speed: 3,
  life: 24,
  size: 4,
});
particles = step(particles, 1);  // advance + cull
```

---

## Showcase

The `showcase/` directory is a standalone Vite app that demos the library end-to-end. It is not shipped to consumers -- it is a reference and visual-validation tool that lives inside the repo. Run it with:

```bash
npm run showcase:dev     # dev server (prints a localhost URL)
npm run showcase:build   # production build to showcase/dist/
```

Four sections, each an independent canvas:

| Section | What it shows |
|---|---|
| Hero | Seeded slime-knight character (rng, animation, IK, locomotion, jump) |
| Lava pool | Gerstner wave surface + heterogeneous particle emitters |
| Playground | Playable platformer (input, collision, camera, hit-stop, game-loop) |
| Parallax | 4-layer IMP underworld background with AI-generated raster art (`drawTiledParallax`) |

The parallax section is the first to consume raster art, validating that the library's `drawTile` callback is asset-agnostic. See `showcase/README.md` for full details including the art regeneration pipeline.

---

## Conventions

This library is a sibling of [Spitekeep](../ai-craft-game-dev-devil/) (now renamed **IMP - Not a Troll**) and shares its conventions exactly. See `docs/conventions.md` for the full list. Highlights:

- **Zero runtime dependencies.** Adding one is a breaking change.
- **Strict TypeScript.** `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `isolatedModules`.
- **File naming:** lowercase-kebab (`outline-rect.ts`, not `OutlineRect.ts`).
- **Defensive adapters:** lazy host-API resolution, swallow errors, in-memory test fallback, never-throw public APIs.
- **Pure progression/ownership ops:** immutable returns, JSON-clone, never mutate input.
- **No `Math.random` in deterministic code.** Use `src/rng` instead.
- **`prefers-reduced-motion` respected** via a cached-at-module-load probe.
- **Extensive JSDoc + inline rationale.** Terse code feels foreign here.

---

## Development

```bash
npm install        # devDependencies only (typescript, vite, vitest, canvas for headless benchmark rendering)
npm test           # vitest run
npm run test:watch # vitest watch mode
npm run build      # tsc --noEmit (typecheck gate)
npm run visual:sheets                 # deterministic level-art review gallery
npm run bench:level-visual             # same-host fallback/production benchmark gate
npm run check:terrain-tree-shaking     # leaf renderer bundle-isolation gate
```

The npm publish build is separate from the typecheck gate:

```bash
npm run build:dist # tsc -p tsconfig.build.json → emits dist/ (.js + .d.ts)
npm run check:level-visual-size # Phase 0-relative dist ceiling
npm publish        # prepack hook auto-runs build:dist, so the tarball is always fresh
```

## Agent team

This repository ships with a 6-agent team configured in `opencode.json`. The team is **research-first** rather than feature-driven, because the hard problem in a library is finding the right abstraction across many future games, not making a single feature work.

| Agent | Role | Mode |
|---|---|---|
| `@team` | Primary orchestrator. Coordinates research → API design → architect critique → prototype → benchmark → decide → implement → document. | primary |
| `@researcher` | Surveys prior art (Sokpop catalog, JS13k, demoscene, papers). Writes `docs/research/<technique>.md`. Read-only on `src/`. | subagent |
| `@api-designer` | Proposes 2-3 TypeScript API approaches per technique with trade-offs. Maintains `docs/api-surface.md`. | subagent |
| `@architect` | Read-only adversarial critic of API/architecture changes. Catches determinism violations, layering leaks, convention drift. | subagent |
| `@coder` | TDD implementer for deterministic helpers; clean implementation for renderers; prototype spikes in `src/_prototype/`. | subagent |
| `@benchmarker` | Headless `node-canvas` rendering. Sample galleries, variant sheets, stress tests. Writes to `benchmarks/`. Vision-capable. | subagent |

To start a session with the team agent as primary, run opencode in this directory. Prompts live in `prompts/`. Always-loaded instructions (tech stack, project structure) live in `.opencode/instructions/`.

### Workflow shape (different from feature-driven teams)

For each non-trivial technique:

1. **Research** → `@researcher` writes `docs/research/<technique>.md`
2. **API design** → `@api-designer` proposes 2-3 approaches in `docs/design/<technique>-proposal.md`
3. **Architect critique** → `@architect` returns APPROVED or NEEDS REVISION
4. **Prototype** (conditional) → `@coder` spikes 1-2 approaches in `src/_prototype/`
5. **Benchmark** → `@benchmarker` renders sample PNGs for comparison
6. **Decide** → `@team` picks the winner, writes `docs/design/<technique>-decision.md`
7. **Implement** → `@coder` does proper TDD implementation
8. **Document** → `@api-designer` finalizes `docs/api-surface.md`; `@benchmarker` adds the gallery

Multiple techniques can be in flight at different stages simultaneously. Bug fixes and trivial utilities skip the full loop.

See `prompts/team.md` for the full orchestrator instructions.

---

## License

MIT — see [LICENSE](./LICENSE).

---

## Cross-references

- [Spitekeep source](../ai-craft-game-dev-devil/) — the codebase this was extracted from (now renamed **IMP - Not a Troll**)
- [Clone-to-Jest methodology](../ai-craft-strategy/knowledge/clone-to-jest-methodology.md) — the pipeline this serves
- [Sokpop teardown](../ai-craft-strategy/knowledge/sokpop-minimalist-rendering-teardown.md) — reference study informing the design
- [IAP redesign patterns](../ai-craft-strategy/knowledge/iap-redesign-patterns.md) — what the cosmetics + IAP pillars must support
