# Project Structure

This is `aicraft-engine` — a TypeScript library of procedural rendering primitives, algorithmic cosmetics, and an IAP bridge. It is consumed by other games via git submodule or vendored copy.

## Directory Layout

```
aicraft-engine/
├── src/                       # Library source (the only thing consumers import from)
│   ├── index.ts               # Top-level barrel export (re-exports every module below)
│   ├── primitives/            # color, outline-rect, pixel, motion/dpr probes, glow, parallax, hit-stop, bitmap font, wave-line
│   ├── rng/                   # seeded mulberry32 PRNG + distribution helpers
│   ├── particles/             # deterministic spawn / advance / cull / step + emitters + presets
│   ├── animation/             # skeletal rig, IK (limb/ccd/fabrik), locomotion, squash/stretch, springs, spring-rod, spider
│   ├── easing/                # Penner curves + stateless tween driver
│   ├── collision/             # AABB, per-axis resolve, tile-grid, moving-gap platforms
│   ├── camera/                # follow camera (lerp, clamp, snap)
│   ├── input/                 # edge accumulator, keyboard/touch/gamepad adapters, OR-merge
│   ├── game-loop/             # fixed-step accumulator + defensive RAF adapter
│   ├── game-state/            # pure dt-driven FSM reducer + adjacency table
│   ├── audio/                 # WebAudio synthesized SFX adapter
│   ├── music/                 # procedural step-sequencer: theory, seeded patterns, advanceSequencer, createSequencer, createNoteFirePlayer
│   ├── save/                  # defensive localStorage/memory backends + JSON load/write
│   ├── blend/                 # pose interpolation (blendPose/blendPoses)
│   ├── palette/               # OKLCH substitution, harmonic generation, WCAG contrast repair
│   ├── cosmetics/             # versioned manifest, seeded variant generation, multi-slot ownership
│   ├── iap/                   # IAP bridge + memory/localStorage dev adapters + entitlements
│   ├── level/                 # versioned platformer level schema, migration, validation, tile queries
│   ├── levelgen/              # procedural level generator: route graph, rhythm/pacing, motif catalog, physics-constrained realization, candidate search, quality scoring, diversity, calibration
│   ├── leveltest/             # platformer level verification: jump-arc trajectory, reachability BFS, bot policies, win conditions, tri-state verifyLevel
│   ├── simtest/               # generic deterministic simulation-test core: fixed-tick orchestration, policies, traces, playback, hash
│   ├── platformer/            # composable kernel + ability pipeline + signed gravity + level-runtime + renderer + presets + enemy archetypes
│   ├── editor/                # headless level-editor core (ops, history, selection, snapping, clipboard, catalog, playtest)
│   ├── collectibles/          # pure-progression CollectibleSave + deterministic derivePickups
│   ├── replay/                # record/playback + 32-bit replayHash fingerprint
│   ├── _prototype/            # throwaway spikes (not shipped, may be empty)
│   └── tests/                 # *.test.ts, vitest node env
├── docs/                      # Documentation (not shipped to consumers)
│   ├── architecture.md        # Layer model + determinism rules
│   ├── conventions.md         # Code style rules
│   ├── integration.md         # How consumers wire the library in
│   ├── api-surface.md         # Maintained by @api-designer — the export map by pillar
│   ├── design/                # Decisions, proposals, plans (per-technique)
│   └── research/              # Maintained by @researcher — prior-art notes per technique
├── benchmarks/                # Maintained by @benchmarker — sample PNGs + comparison reports
├── showcase/                  # Standalone Vite app demoing the library (not shipped)
├── games/                     # Game build-brief prompts (consume the npm package)
├── prompts/                   # Agent prompts (referenced by opencode.json)
├── .opencode/
│   └── instructions/          # Always-loaded context (this file + tech-stack.md)
├── opencode.json              # Agent team configuration
├── package.json               # devDependencies only — no runtime deps
├── tsconfig.json              # Strict TS
├── tsconfig.build.json        # Emits dist/ (.js + .d.ts) for npm publish
├── tsconfig.node.json         # For vite.config.ts
└── vite.config.ts             # Vitest config (node env)
```

> _Planned: `fake3d/` (Pillar 4 — Sokpop-inspired billboarding/isometric/cube). Not yet implemented._

## Pillar Model

The library is organised into pillars that ship incrementally. See `README.md` for
the live status table. `levelgen/`, `leveltest/`, and `simtest/` are shipped;
`fake3d/` is planned; `_prototype/` is scratch.

| Pillar | Modules | What it provides |
|---|---|---|
| **1. Primitives** | `primitives/`, `rng/`, `particles/`, `animation/`, `easing/`, `collision/`, `camera/`, `input/`, `game-loop/`, `game-state/`, `audio/`, `music/`, `save/`, `blend/` | Rendering helpers, seeded determinism, deterministic FX, motion, audio, music, FSM, replay-safe fixed-step loop |
| **2. Cosmetics** | `palette/`, `cosmetics/`, `level/`, `collectibles/` | Palettes, skins, versioned level schema + validation, collectible ownership |
| **2. Level Generation** | `levelgen/` | Deterministic route graph, rhythm/pacing, motif-based realization, candidate search with quality scoring, targeted repair, diversity tracking, and difficulty calibration |
| **2. Platformer** | `platformer/`, `editor/` | Composable kernel + abilities, signed gravity, level runtime, renderer, presets, enemy archetypes, headless editor core |
| **Cross-cutting simulation testing** | `simtest/`, `leveltest/` | Generic deterministic scenario verification plus the standard platformer/LevelData adapter. `simtest` is the generic core (zero platformer imports); `leveltest` is the platformer adapter built on top |
| **3. IAP** | `iap/` | Bridge adapter interface, entitlement store, memory + localStorage dev adapters |
| **4. Fake-3D** | `fake3d/` (planned) | Billboarding, isometric, orthographic cube, heightmap |
| **5. Platform adapters** | (extends `iap/`) | Poki SDK, StoreKit, Play Billing — on-demand |
| **— Replay** | `replay/` | Record/playback + deterministic hash fingerprint (cross-cutting, consumes the kernel) |

## File naming

- **All files:** lowercase-kebab (`outline-rect.ts`, not `OutlineRect.ts`).
- **Test files:** `*.test.ts`, colocated in `src/tests/`.

## Module structure (every module)

```
src/<module>/
├── types.ts        # Type definitions only (if non-trivial)
├── <thing>.ts      # Implementation
├── index.ts        # Barrel export
└── (tests live in src/tests/<thing>.test.ts)
```

## Consumer import patterns

Consumers import via relative paths from the submodule mount point:

```ts
// In a game that mounted the library at src/lib/aicraft-engine/
import { outlineRect } from './lib/aicraft-engine/src/primitives';
import { mulberry32 } from './lib/aicraft-engine/src/rng';
```

Or via the top-level barrel:

```ts
import { outlineRect, mulberry32 } from './lib/aicraft-engine/src';
```

The top-level barrel re-exports everything from each pillar. Tree-shaking still works because each module has its own barrel too.

## Scope

This library is self-contained. It has no parent game, no private sibling repos, and no internal codenames. When researching or designing, the public Sokpop catalog ([sokpop.itch.io](https://sokpop.itch.io)) is the canonical external reference for the minimalist-procedural rendering style the library aims to support.
