# Showcase

A standalone Vite app that consumes the `aicraft-engine` library via relative imports and demos its primitives end-to-end. It is **not** shipped to library consumers -- it is a reference/demo app that lives inside the library repo for development and visual validation.

Each section renders an independent canvas that exercises a specific cluster of library APIs. The parallax section is the first to consume AI-generated raster art; all others draw procedurally from code.

---

## Run / Build / Typecheck / Test

Commands are run from the **repo root** (`aicraft-engine/`):

| Command | What it does |
|---|---|
| `npm run showcase:dev` | Dev server (prints a localhost URL) |
| `npm run showcase:build` | Production build to `showcase/dist/` |
| `npm run showcase:typecheck` | tsc gate for the showcase (separate tsconfig) |
| `npm run showcase:test` | Vitest run of the showcase's DOM-free pure-logic suites (`showcase/tests/*.test.ts`) — CI / pre-commit |
| `npm run showcase:test:watch` | Same suite in watch mode |

The showcase has its own `showcase/tsconfig.json` that excludes `showcase/_scripts/` (Node-only generators) from the browser typecheck. The `vite/client` ambient types provide `.png` import typing.

The showcase also has its own Vitest config (`showcase/vitest.config.ts`) separate from the root library suite. The showcase's DOM-coupled section code (`sections/playground.ts`) imports browser APIs (`window`, `matchMedia`, `IntersectionObserver`, `AudioContext`) and cannot be unit-tested under the project's Node-only Vitest setup without adding `jsdom` (forbidden by the tech-stack rules). Instead, the pure logic the section actually uses — the play/edit session boundary and the mouse/editing math — is extracted into `sections/playground-session.ts` and `sections/playground-helpers.ts` (the section imports these helpers, so the suite exercises the same code path the live showcase runs).

---

## Sections

| Section | ID | Library modules demonstrated |
|---|---|---|
| **Hero** | `#hero` | Seeded slime-knight character: rng, animation, IK, locomotion, jump |
| **Lava pool** | `#lava-pool` | Gerstner wave surface + heterogeneous particle emitters (wave-line, particles) |
| **Playground** | `#playground` | Playable platformer with integrated level editor: Edit/Play toggle, click-drag to draw platforms, click-to-place for fixed-size kinds, multi-select + drag to move, moving-platform path widget with draggable waypoints, undo/redo, playtest sandbox via `enterPlaytest`/`exitPlaytest`. Composes the editor core (`applyOp`, `undo`, `select`, `snapToGrid`, `entityAtPoint`, `findCatalogEntry`), the platformer kernel (`compileLevel`, `stepPlatformer`, `advanceMovingPlatform`, `createMovingPlatformDisplacementProvider`), the renderer helpers (`drawLevelEntity`, `drawActor`), enemy archetypes with behavior registry (`compileEnemies`, `stepEnemies`, `stepProjectile`, `drawEnemies`, `drawProjectiles`), turret shootTo direction+range with zero-overshoot clamping, and all game-feel polish (death feedback lifecycle, squash/stretch, dust, hit-stop, screen shake, locomotion, audio) |
| **Parallax** | `#parallax` | 4-layer IMP underworld background: `drawTiledParallax` with AI-generated raster art (primitives/parallax) |

The hero, lava-pool, and playground sections draw entirely from procedural primitives in code. The parallax section is the first to consume raster PNGs, validating that `drawTiledParallax`'s `drawTile` callback is asset-agnostic.

---

## Architecture

`main.ts` bootstraps a global store (`createStore<GlobalState>`) and initializes each section via `init<Name>(container, store)`. Sections are independent canvases with local state. The store currently holds only `heroSeed` and `heroSpeed` -- other sections accept `_store` to match the uniform section-init signature but do not use it.

`prefers-reduced-motion` is gated via `showcase/helpers/motion-gate.ts`, which probes `matchMedia` once at module load and caches the result. When reduced motion is preferred, each section renders a single static frame and never starts its `requestAnimationFrame` loop.

The showcase tsconfig (`showcase/tsconfig.json`) excludes `showcase/_scripts/` from the browser typecheck, since those scripts are Node-only (depend on `canvas`, `fs`, `path`).

---

## Parallax section -- deep dive

### What it shows

Four horizontally-seamless PNG layers scrolling at depth factors via the library's `drawTiledParallax`:

| Layer | Factor | Content |
|---|---|---|
| Sky | 0.10 | Crimson-to-black underworld sky, ash, embers |
| Far fortress | 0.25 | Jagged obsidian fortress silhouette (transparent, composites over sky) |
| Mid ruins | 0.50 | Ruined cavern, broken pillars, lava cracks (transparent) |
| Foreground | 0.85 | Chains, stalactites, foreground rubble (transparent) |

The scene-specific depth factors (0.10 / 0.25 / 0.50 / 0.85) are tuned for this painted underworld scene's depth gradient and differ from the library's generic `PARALLAX_FAR` / `PARALLAX_MID` / `PARALLAX_NEAR` constants (0.25 / 0.5 / 1.0).

Canvas is 640x320 (2:1 aspect, matching the tiles' 2048x1024 source aspect), DPR-aware via `resizeCanvasToBackingStore`. Controls: pause/play button, speed slider (0--2x). Auto-scroll camera advances rightward at 60 px/sec (1 px/tick at 60fps) times the speed multiplier. `cameraX` grows unbounded -- the library's `% tileWidth` wrap handles infinite scroll. A +1px overscan (`OVERSCAN_PX`) eliminates hairline seams during sub-pixel scrolling.

### The art is AI-generated, not procedural

This is the first showcase section to consume raster art. This is consistent with the library's design: `drawTiledParallax`'s `drawTile: (ctx, screenX) => void` callback is deliberately asset-agnostic. The same primitive tiles procedural draws (hero/lava/playground sections) AND `drawImage` calls (parallax section). The library stays zero-dep; the showcase (consumer) supplies the art.

---

## Parallax art regeneration pipeline

### Prerequisites

- Node.js with `canvas` package installed (`npm install` covers this -- `canvas` is a devDependency).
- An OpenAI API key with `gpt-image-2` access.

### Setup

1. Copy `.env.example` to `.env` in the repo root.
2. Fill in your `OPENAI_API_KEY` in `.env`.

### Running

From the **repo root** (`aicraft-engine/`):

```bash
# Generate all 4 layers + contact sheet
npx tsx showcase/_scripts/gen-parallax-tiles.ts

# Generate one layer only (with greenscreen test sheet for transparent layers)
npx tsx showcase/_scripts/gen-parallax-tiles.ts --only=foreground
```

Valid `--only` values: `sky`, `far-fortress`, `mid-ruins`, `foreground`.

### Output

- `showcase/assets/parallax/{sky,far-fortress,mid-ruins,foreground}.png` -- 2048x1024 each (mirror-padded from 1024x1024 source).
- `showcase/assets/parallax/_contact-sheet.png` -- visual review sheet (full run only).
- `showcase/assets/parallax/_test-<name>.png` -- 3-panel greenscreen diagnostic (single-layer mode, transparent layers only).

### Model and fallback chain

The script tries models in order: `gpt-image-2` -> `gpt-image-2-2026-04-21` -> `gpt-image-1.5` -> `gpt-image-1`. For each model, it tries `1024x1024` with `opaque` background, then `1024x1024` without background param, then `auto` size with `opaque`, then `auto` without background.

### Cost

Approximately $0.20--$0.50 per full run (4 generations at standard quality). Retries on param/model errors can add a call or two.

---

## The greenscreen keying technique

This is a reusable pattern for extracting transparency from image models that ignore `background:"transparent"`.

### Problem

Image models ignore `background:"transparent"`. The naive fallback -- keying on near-black (`max(r,g,b) < 30`) -- punches holes through dark-palette subjects. The IMP aesthetic is dominantly dark, so the key ate legitimate art, producing swiss-cheese transparency.

### Solution

Prompt the model to paint the subject on a flat pure **chroma-green** background (`#00FF00`), then key the green out in post:

1. **Saturation-based key** (not brightness): a pixel is chroma-green when `greenDominance = g - max(r, b)` is high.

2. **Feathered alpha** over the band `KEY_ON=60` (alpha 0) to `KEY_OFF=15` (alpha 255) for anti-aliased edges. Linear interpolation in between prevents jaggies.

3. **Despill**: clamp `g <= max(r, b) + 8` on kept pixels. Removes the green fringe the model's anti-aliasing bled into subject edges.

### Why green

Zero overlap with the warm IMP palette (crimsons, oranges, blacks). **Plan-B** if green spills into the subject: switch the chroma color to magenta `#FF00FF`.

### Results

- mid-ruins: 1.9% transparency (broken near-black key) -> 65.3% (clean green key).
- Zero interior holes across all layers.
- Approximately 0.5% feathered edges.

---

## Mirror-pad seamless-tiling guarantee

Image models do not produce reliably seamless tiles from prompts alone. The generator mirror-pads each 1024-wide tile into a 2048-wide composite:

```
[ original (1024px) | horizontal-mirror(original) (1024px) ]
```

The right edge of the original is identical to the left edge of the mirrored half, so the internal join is invisible. The right edge of the mirrored half is the original's left edge, so when two 2048px tiles are placed side by side, the join is left-edge-to-left-edge -- again identical. This guarantees zero visible seams for any source image, regardless of what the model produced.

The consumer's `drawTiledParallax` then tiles the 2048px asset horizontally. With `TILE_W = 640` (canvas width), `tiledParallaxRange` computes the exact copy count via the Optimal Branching Remainder formula.

---

## Security

- `.env` holds `OPENAI_API_KEY`. It is gitignored (`.gitignore` ignores `.env` / `.env.*` except `.env.example`).
- The generator reads the key at runtime only; it is never logged, never written to any committed file, never shipped to the showcase bundle.
- The committed artifacts are the generated PNGs (not secret); the key never enters git.

---

## Layer spec reference

| Layer | Factor | Background | Content | Transparency |
|---|---|---|---|---|
| sky | 0.10 | opaque | crimson-to-black sky, ash, embers | n/a |
| far-fortress | 0.25 | green -> keyed | jagged obsidian fortress silhouette | ~77% |
| mid-ruins | 0.50 | green -> keyed | ruined cavern, broken pillars, lava cracks | ~65% |
| foreground | 0.85 | green -> keyed | chains, stalactites, foreground rubble | ~64% |

Each layer's prompt instructs the model to paint on a flat pure chroma-green (`#00FF00`) background (transparent layers) or a dark atmospheric background (sky). All prompts include "left edge must visually continue into the right edge" for seamlessness, which the mirror-pad then guarantees mechanically.
