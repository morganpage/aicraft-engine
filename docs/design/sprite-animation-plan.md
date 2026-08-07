# Plan: Sprite Animation Pipeline (`src/sprites/`)

> Status: **SHIPPED**
> Created: 2026-08-07.
> Owner: `@team`.

## Context

The engine's procedural-character pipeline (skeletal rig + IK + seeded humanoid
body plans, see `docs/research/skeletal-rigging.md`) is uniquely capable, but
the founding "no imported art assets" principle (`docs/research/spritesheet-pipelines.md`,
originally **REJECTED**) made it awkward to ship conventional pixel art — the
dominant style for the platformer genre the engine targets.

This plan lifts CC0/PD pixel art to a first-class tier, alongside (not
replacing) procedural rendering. The two can be mixed per-entity in one scene.

## Decision

Add a new `src/sprites/` module that consumes a single authored **Aseprite-JSON
superset** document + one PNG and produces all animations for one character or a
whole game's cast — mirroring how one `.ldtk` + a tileset defines a whole level.

**Format choice — Aseprite superset (accepted):** use Aseprite's JSON field
names verbatim (`frames`, `meta.frameTags`, `frame`, `duration`) so real
Aseprite/LibreSprite exports drop in with zero translation, plus two additive
optional extensions:
- `meta.grid` — uniform-grid sheets (Kenney CC0 packs) get frames synthesized
  from `{tileWidth, tileHeight, columns}`; `frameTags` then reference tile
  indices. No per-frame rects needed.
- top-level `characters[]` — maps each character's semantic anim keys
  (`idle`/`walk`/…) to tag names, so one file defines multiple characters.

**v1 scope — grids + explicit rects only.** Packed/trimmed/rotated frames
(`spriteSourceSize`/`rotated`) are deferred. This covers Aseprite "strip"
exports and all uniform-grid packs.

## Architecture (mirrors `src/ldtk/`)

| File | Role | LDtk analogue |
|------|------|---------------|
| `types.ts` | Wire-format schema (`readonly`, JSON-round-trip-safe) | `ldtk/types.ts` |
| `parse.ts` | `parseSpriteSheet(json): SpriteParseResult` — never throws, hand-written guards | `ldtk/parse.ts` |
| `compile.ts` | Compile to `CompiledSpriteSheet`: grid synth, tag expansion, character grouping | `ldtk/translate.ts` |
| `resolve.ts` | Deterministic frame-player (loop/reverse/pingpong) | (new — the sanctioned primitive) |
| `render.ts` | Pure `drawSprite` blit + facing mirror + silhouette tint | `ldtk/render.ts` |
| `anim-state.ts` | `deriveSpriteAnimKind` — character-agnostic physics→anim-kind | `character/humanoid/state.ts` |

The image is consumer-supplied through a `CanvasImageSource` (same seam as
`buildLdtkTilesetBundle`'s `loadImage` callback); the engine never imports
`Image` or calls `fetch`. Tinting recolors monochrome art via an offscreen
`source-in` composite, with an optional consumer `createCanvas` factory so it
works under node-canvas in tests.

## Mixing procedural + sprite rendering

No new abstraction. Procgen characters (`drawHumanoid`) and sprite characters
(`drawSprite`) are both pure draw calls over a shared `CanvasRenderingContext2D`;
a game mixes them by calling both in one render pass. The showcase's
`sprite-demo` section is fully sprite-based; existing scenes stay procedural.

## Verification

- `npm test`: 83 new unit tests (parse/compile/resolve/render/anim-state);
  full suite 3097 green.
- `npm run build`: tsc clean.
- `npm run showcase:build`: Vite bundles the new scene.
- End-to-end render verified by sampling the composed frame's pixels through
  the real pipeline (player/enemy tints land at expected coordinates).

## Out of scope

- Heavy asset-pipeline tooling (FFmpeg/Aseprite-source import, packing tools).
- Packed/trimmed/rotated frame support — v2.
- LDtk entity-field → sprite-clip binding (level files assigning clips to
  entities) — natural follow-up.
- A unified procgen/sprite `BodyPlanHandler` dispatch.

## Cross-references

- `docs/research/spritesheet-pipelines.md` — revised verdict (PARTIALLY ACCEPTED).
- `src/sprites/` — the implementation.
- `showcase/sections/sprite-demo.ts` — the end-to-end demo.
- `assets/sprites/samples/kenney-1bit.json` + `README.md` — the sample cast.
