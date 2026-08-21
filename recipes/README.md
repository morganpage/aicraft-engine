# Recipes — the engine's structured home for reusable game wiring

A recipe is a **copy-in source module** for the wiring every game rebuilds by
hand: audio unlock-on-first-gesture, the reduced-motion-gated fixed-tick boot,
particle color fades, the sprite slot→cell mapping, the LDtk draw pipeline,
the room-slide letterbox aperture. Games copy the file into `src/recipes/`
and import it — they do **not** install or import it as a package path.

## Why this directory exists

Before recipes, this knowledge lived as inline TypeScript sketches inside the
build briefs (`games/*.md`). Eight briefs each carried their own copy of the
same wiring, updated by hand, and a brief pinned to an older engine version
would silently drift from the shipped API — a real build (Celerock, 0.20.0)
hit ~14 such drifts and needed a full audit of the `.d.ts` before any game
code was safe to write. Sketches in prose cannot be compiled, so nothing
caught the drift until a build broke.

Recipes fix that structurally:

- **They are real modules, typechecked every commit** against the live
  `src/` (`npm run typecheck:recipes`, chained into `npm run build` via a
  `paths` alias that resolves `aicraft-engine` to `src/index.ts`). A change
  to the engine API that breaks a recipe breaks CI — drift is impossible by
  construction.
- **They are unit-tested** (`recipes/tests/`, run by the root Vitest config
  alongside `src/tests/`).
- **They are consumer-accurate**: each imports from the root barrel exactly
  the way a game does, so what a builder copies is what they'd have written.
- **They are version-pinned with the engine**: a brief pinned to
  `aicraft-engine@X` copies the recipes as of `X` (from the repo tag or the
  npm tarball, which ships this directory), so a recipe and its brief can
  never disagree.

## The governance ladder (standing rule)

> **If a code sketch written for a brief, doc, or issue would be reusable by
> more than one game, it must not stay inline.** Add it here as a compiled,
> tested recipe and reference it by name from wherever it was needed.

The promotion path for reusable game code:

1. **Brief sketch** — inline code in a single brief, for that game only.
   Fine while exactly one game wants it.
2. **Recipe** (`recipes/<name>.ts`) — the moment a second game would want
   the same code, or the first game had to derive it from prose rather than
   copy it. Compiled, tested, referenced by name from all briefs.
3. **First-class engine export** — when two or more shipped games import a
   recipe verbatim, promote it into `src/` with real API design (naming,
   options, JSDoc) and delete the recipe. The recipe layer is a staging
   area, not a dumping ground.

## The recipes

| Recipe | Replaces | Used by |
|---|---|---|
| [`audio-unlock.ts`](./audio-unlock.ts) | One-shot `keydown`/`pointerdown` → `adapter.unlock()` listener (+ `onUnlock` gate hook) | every brief's audio section |
| [`fixed-tick-game.ts`](./fixed-tick-game.ts) | `createGameLoop` + reduced-motion static-frame gate | every brief's loop/boot section |
| [`image-decoder.ts`](./image-decoder.ts) | The bounded, never-throwing image decoder — `decodeImageBounded` (URL-facing, for sprite boot) + `decodeImageBytesBounded` (bytes core, for the LDtk loader's injectable) | sprite-sheet games (celerock) |
| [`platformer-input.ts`](./platformer-input.ts) | `PlatformerInput` derivation from the merged per-tick edge map | every kernel game (celerock) |
| [`sprite-sheet-boot.ts`](./sprite-sheet-boot.ts) | Defensive PNG + Aseprite-JSON boot: fetch → parse → compile → clip lookup, `null` on any failure | sprite-sheet games (celerock) |
| [`sheet-frame-index.ts`](./sheet-frame-index.ts) | The `clip.frameIndices[currentFrameIndex(...)]` double indirection | sprite-sheet games (celerock) |
| [`particle-color-fade.ts`](./particle-color-fade.ts) | Re-stamping `colorEnd` after every particle `advance()` | particle-juiced games |
| [`ldtk-draw-pipeline.ts`](./ldtk-draw-pipeline.ts) | Surface-cache + `worldOffset` + `view` + invalidate wiring | LDtk games (celerock) |
| [`ldtk-entity-art.ts`](./ldtk-entity-art.ts) | The `drawLevelEntity` override map rendering entities with their authored LDtk tiles via the `entityArt` side channel | LDtk games (celerock) |
| [`ldtk-hot-reload-plugin.ts`](./ldtk-hot-reload-plugin.ts) | Vite dev-server watcher forwarding `.ldtk` saves as the `ldtk:update` websocket event | LDtk games with live level editing (celerock) |
| [`ldtk-entity-tile-art.ts`](./ldtk-entity-tile-art.ts) | Baking a terrain-like LDtk ENTITY's art with the project's own auto-rules, stamped in-context | LDtk games with falling/push/crumble blocks (celerock) |
| [`particle-system.ts`](./particle-system.ts) | Owning the seconds→ticks conversion + shared air medium for the tick-unit particle pillar (**promoted into the engine** as `advanceSeconds`/`stepSeconds`/`DEFAULT_PARTICLE_AIR`; this file is the back-port for pre-promotion pins) | every particle-juiced game (celerock, embertomb) |
| [`room-slide-aperture.ts`](./room-slide-aperture.ts) | `presentationForRoomSlide` → aperture → letterbox (never union `bounds`) | room-transition games (celerock) |

Recipes are deliberately **not** in `docs/api-surface.md` — they are not
runtime exports of the package. This README is their index.

## Using a recipe in a game

```bash
# from the engine repo at your brief's pinned tag, or from the npm tarball's recipes/
cp recipes/audio-unlock.ts recipes/fixed-tick-game.ts <your-game>/src/recipes/
```

Then import locally (`./recipes/audio-unlock`). Recipes import only from the
`aicraft-engine` root barrel, so they compile unchanged in any Vite/TS
consumer scaffold the briefs create.

## Adding a recipe

- One wiring concern per file, lowercase-kebab, JSDoc on every export
  (same conventions as `docs/conventions.md`).
- Import from `'aicraft-engine'` only — never relative paths into the
  engine's `src/`.
- Add a test in `recipes/tests/<name>.test.ts` (Vitest, node environment,
  same as the engine suite).
- Add a row to the table above, and swap the inline sketches in every brief
  the recipe replaces for a by-name reference.
