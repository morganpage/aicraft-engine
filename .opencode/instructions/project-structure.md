# Project Structure

This is `aicraft-engine` — a TypeScript library of procedural rendering primitives, algorithmic cosmetics, and an IAP bridge. It is consumed by AI Craft games (Spitekeep and future Clone-to-Jest siblings) via git submodule or vendored copy.

## Directory Layout

```
aicraft-engine/
├── src/                       # Library source (the only thing consumers import from)
│   ├── index.ts               # Top-level barrel export
│   ├── primitives/            # Pillar 1 — color, outline-rect, pixel, motion, animation
│   ├── rng/                   # Pillar 1 — seeded mulberry32 PRNG + distribution helpers
│   ├── particles/             # Pillar 1 — deterministic spawn / advance / cull / step
│   ├── palette/               # Pillar 2 — per-skin palette substitution + contrast check (planned)
│   ├── cosmetics/             # Pillar 2 — skin manifest, seeded generation, ownership (planned)
│   ├── iap/                   # Pillar 3 — IAP bridge + adapters (planned)
│   ├── fake3d/                # Pillar 4 — Sokpop-inspired billboarding/isometric/cube (planned)
│   └── tests/                 # *.test.ts, vitest node env
├── docs/                      # Documentation (not shipped to consumers)
│   ├── architecture.md        # Layer model + determinism rules
│   ├── conventions.md         # Code style rules
│   ├── integration.md         # How consumers wire the library in
│   ├── api-surface.md         # Maintained by @api-designer — the export map by pillar
│   └── research/              # Maintained by @researcher — prior-art notes per technique
├── benchmarks/                # Maintained by @benchmarker — sample PNGs + comparison reports
├── prompts/                   # Agent prompts (referenced by opencode.json)
├── .opencode/
│   └── instructions/          # Always-loaded context (this file + tech-stack.md)
├── opencode.json              # Agent team configuration
├── package.json               # devDependencies only — no runtime deps
├── tsconfig.json              # Strict TS, mirrors Spitekeep exactly
├── tsconfig.node.json         # For vite.config.ts
└── vite.config.ts             # Vitest config (node env)
```

## Pillar Model

The library is organised into pillars that ship incrementally. See `README.md` for the status table.

| Pillar | Modules | What it provides |
|---|---|---|
| **1. Primitives** | `primitives/`, `rng/`, `particles/` | Rendering helpers, seeded determinism, deterministic FX |
| **2. Cosmetics** | `palette/`, `cosmetics/` | Skin manifests, palette substitution, ownership state |
| **3. IAP** | `iap/` | Bridge adapter interface, entitlement store, dev adapters |
| **4. Fake-3D** | `fake3d/` | Billboarding, isometric, orthographic cube, heightmap |
| **5. Platform adapters** | (extends `iap/`) | Jest SDK, Poki SDK — on-demand |

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

## Sibling projects

| Sibling | Path | Relationship |
|---|---|---|
| Spitekeep | `~/Documents/VSCODE/OPENCODE/ai-craft-game-dev-devil` | The codebase this library was extracted from; future consumer via submodule |
| AI Craft Strategy | `~/Documents/VSCODE/OPENCODE/ai-craft-strategy` | Strategic context — Clone-to-Jest methodology, Sokpop teardown, etc. |

When researching or designing, the Sokpop teardown at `ai-craft-strategy/knowledge/sokpop-minimalist-rendering-teardown.md` is the canonical reference for what the library must support.
