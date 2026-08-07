# Spritesheet & Modular Sprite Pipelines

> Research note for spritesheet and modular asset pipelines. Slug: `spritesheet-pipelines`.
> Investigated: 2026-06-18. Revised: 2026-08-07.
> Verdict: **PARTIALLY ACCEPTED** — full heavy asset-pipeline tooling remains out of scope, but a deterministic, asset-light sprite-animation pipeline is now a first-class engine feature in `src/sprites/`.

## TL;DR

As of 2026-08-07 the engine's rendering principle is **procedural-first, with CC0/PD pixel art as a first-class citizen**. Procedural characters (skeletal rigging, IK) remain the default, and an Aseprite-JSON-superset sprite pipeline now sits alongside them — the two can be mixed per-entity in one scene. What stays out of scope is the *heavy asset-pipeline tooling*: FFmpeg/ImageMagick/Aseprite-source importers, JSON-atlas packing tools, and modular layered-asset slot systems. The engine consumes a single authored `.json` + `.png` pair; it does not build spritesheets from raw art.

## Why this matters for aicraft-engine

The `aicraft-engine` library prioritizes zero-runtime dependencies and strict determinism. The original rendering principle — "no imported art assets, the algorithm IS the art" — put every character, world, and effect behind procedural vector drawing. In practice that produced a uniquely capable procedural-character pipeline (skeletal rig + IK + seeded humanoid body plans) but made it awkward to ship conventional pixel art, which is the dominant art style for the platformer genre the engine targets.

The 2026-08-07 revision keeps procedural rendering as the **default and first-class** path and lifts CC0/PD pixel art to the same tier. A single Aseprite-JSON-superset `.json` + one `.png` now defines a whole game's cast, mirroring how one `.ldtk` + a tileset defines a whole level. The engine stays asset-free at the core: it parses the JSON and owns the deterministic frame math; the consumer loads the PNG (same `decodeImage`/`drawImage` seam already used for parallax backgrounds and LDtk tilesets). The two rendering modes can be mixed per-entity in one scene — a procgen protagonist alongside sprite enemies, or vice versa.

What remains out of scope is the **heavy asset-pipeline tooling** the original survey evaluated: build-time spritesheet compilers (FFmpeg/ImageMagick), Aseprite-`.aseprite` binary importers, JSON-atlas packing/trim/rotation, and modular layered-asset slot systems. The engine consumes one authored `.json` + `.png` pair; it does not synthesize spritesheets from raw art, and v1 supports grids + explicit rects only (packed/trimmed/rotated frames are deferred).

## Prior Art Survey (Evaluated Corpus)

The following sources were surveyed to understand modern 2D character pipelines. The original 2026-06-18 verdict rejected all of them; the 2026-08-07 revision accepts the *consumption* of authored sprite sheets (Aseprite JSON) while keeping the *build/packing* tooling out of scope.

### 1. "Modern Computational Pipelines for 2D Procedural Character Production"
- **Focus**: Architectural engineering of modular sprite systems.
- **What it covers**: Generic anatomy slots and dynamic runtime renaming to link layered assets to universal animation timelines.
- **Status**: The modular-asset-pipeline portion remains out of scope — it relies on importing layered external image files (separate PNGs for arms, legs, heads) and mapping them to a slot system, which is a build pipeline the engine deliberately does not own.
- **Procedural Math Salvage**: The paper's procedural mathematical formulations for joint movement are salvaged in `procedural-locomotion.md` and drive the procedural humanoid.

### 2. "Creating 2D sprites with AI (but above all, with a method) - Coding Park"
- **Focus**: Practical framework for animation loops and asset compilation.
- **What it covers**: Using CLI tools like **FFmpeg and ImageMagick** to build game-ready spritesheets from raw animation frames.
- **Status**: Still out of scope. This is a build-time asset- compilation pipeline; the engine consumes authored sheets, it does not compile them.

### 3. "AI Sprite Generator for 2D Games: 3 Ways to Build Game-Ready Assets Fast"
- **Focus**: Production methods for generating keyframe-based sprite sheets.
- **What it covers**: Extracting key motion poses (contact, lift-off, mid-stride) from video and assembling evenly-spaced, grid-aligned animation cycles.
- **Status**: Out of scope for the engine (authoring-side concern). The *output* of such a pipeline — a grid-aligned spritesheet with named animation ranges — is exactly what `src/sprites/` consumes.

---

## Accepted: the `src/sprites/` pipeline (implemented 2026-08-07)

The "Deterministic Grid Frame-Player" flagged below as a future primitive is now implemented and generalized in `src/sprites/`. The module mirrors `src/ldtk/`'s layering:

- `types.ts` — Aseprite-JSON-superset wire schema (`frames`, `meta.frameTags`, plus `meta.grid` for uniform sheets and top-level `characters[]` for multi-character files). `readonly`, survives JSON round-trip.
- `parse.ts` — defensive `parseSpriteSheet(json): SpriteParseResult`, never throws, hand-written guards (no zod).
- `compile.ts` — compiles to the internal `CompiledSpriteSheet`: synthesizes grid frames, expands `frameTags` into ordered frame-index clips (forward/reverse/pingpong), groups by `characters[]`.
- `resolve.ts` — the deterministic frame-player: pure functions of accumulated ms over per-frame durations, with loop/reverse/pingpong.
- `render.ts` — pure `drawSprite` blit (9-arg `drawImage`), facing mirror via `ctx.scale(facing,1)`, and silhouette tint for recoloring monochrome art.
- `anim-state.ts` — `deriveSpriteAnimKind`, the character-agnostic physics→anim-kind deriver shared by the player and enemies (branching parity with `src/character/humanoid/state.ts`).

The showcase `sprite-demo` section proves it end-to-end against the Kenney 1-Bit Platformer pack (CC0): one `.json` + one `.png` animates a player plus two enemy types, driven by the same fixed-step loop and platformer kernel as the procedural scenes.

---

## Cross-References

- `docs/research/procedural-locomotion.md` — Active sibling note for procedural movement math.
- `docs/research/skeletal-rigging.md` — Active sibling note for code-based bone transformations.
- `docs/research/inverse-kinematics.md` — Active sibling note for procedural joint positioning.
- `ai-craft-strategy/knowledge/sokpop-minimalist-rendering-teardown.md` — Canonical reference for asset-free procedural rendering.
- `README.md` — Core principles (no imported art assets, algorithmic cosmetics).
