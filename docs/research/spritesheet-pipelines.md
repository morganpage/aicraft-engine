# Spritesheet & Modular Sprite Pipelines

> Research note for spritesheet and modular asset pipelines. Slug: `spritesheet-pipelines`.
> Investigated: 2026-06-18.
> Verdict: **REJECTED (OUT OF SCOPE)**

## TL;DR

Frame-by-frame spritesheet and modular-sprite techniques have been evaluated and explicitly **REJECTED** for the `aicraft-engine` library. These asset-pipeline methods directly conflict with our core principle of "ultra-minimalist rendering — no imported art assets," where "the algorithm IS the art." Instead, the engine is adopting procedural animation, skeletal rigging, and inverse kinematics (IK) as its primary animation paradigm.

## Why this matters for aicraft-engine

The `aicraft-engine` library prioritizes zero-runtime dependencies, strict determinism, and fully procedural rendering. As stated in the `README.md`, the first driving principle is **"Ultra-minimalist rendering — no imported art assets. Characters, worlds, and effects are drawn from vector primitives in code."** Traditional spritesheet and modular-sprite pipelines require external asset pipelines, heavy image assets, and complex runtime loader/binder logic that violates this core constraint. Supporting them as core features would shift the library's focus away from procedural generation toward standard asset management.

## Prior Art Survey (Evaluated Corpus)

The following sources were surveyed to understand modern 2D character pipelines before deciding to exclude them from the core engine:

### 1. "Modern Computational Pipelines for 2D Procedural Character Production"
- **Focus**: Architectural engineering of modular sprite systems.
- **What it covers**: Generic anatomy slots and dynamic runtime renaming to link layered assets to universal animation timelines.
- **Rejection Reason**: The modular-asset-pipeline portion is rejected because it relies on importing layered external image files (e.g., separate PNGs for arms, legs, heads) and mapping them to a slot system. 
- **Procedural Math Salvage**: The paper's procedural mathematical formulations for joint movement are highly relevant and have been salvaged/redirected to `procedural-locomotion.md`.

### 2. "Creating 2D sprites with AI (but above all, with a method) - Coding Park"
- **Focus**: Practical framework for animation loops and asset compilation.
- **What it covers**: Using CLI tools like **FFmpeg and ImageMagick** to build game-ready spritesheets from raw animation frames.
- **Rejection Reason**: This is an asset-heavy pipeline requiring external compilation tools and static spritesheet files. It is incompatible with a library that renders everything procedurally from code primitives.

### 3. "AI Sprite Generator for 2D Games: 3 Ways to Build Game-Ready Assets Fast"
- **Focus**: Production methods for generating keyframe-based sprite sheets.
- **What it covers**: Extracting key motion poses (contact, lift-off, mid-stride) from video and assembling evenly-spaced, grid-aligned animation cycles.
- **Rejection Reason**: This method focuses on keyframe extraction and grid alignment of pre-rendered static raster assets. It does not align with our goal of real-time, deterministic, seed-driven procedural animation.

---

## Salvageable Sub-Techniques (For Future Consideration)

While full asset pipelines are rejected, there is a minimal, deterministic, asset-light piece worth flagging as a potential future optional primitive:

- **Deterministic Grid Frame-Player**: A pure function of `tick` over a fixed grid (e.g., calculating UV offsets or frame indices based on time and frame count: `frameIndex = Math.floor(tick * speed) % totalFrames`). If a consumer chooses to bring their own custom spritesheet, they could use this lightweight helper to calculate frame indices deterministically.
- **Status**: Explicitly **NOT** in scope for the current `src/animation/` pillar, but flagged as a possible future optional primitive under Pillar 1 or 2 if consumers request basic sprite integration.

---

## Cross-References

- `docs/research/procedural-locomotion.md` — Active sibling note for procedural movement math.
- `docs/research/skeletal-rigging.md` — Active sibling note for code-based bone transformations.
- `docs/research/inverse-kinematics.md` — Active sibling note for procedural joint positioning.
- `ai-craft-strategy/knowledge/sokpop-minimalist-rendering-teardown.md` — Canonical reference for asset-free procedural rendering.
- `README.md` — Core principles (no imported art assets, algorithmic cosmetics).
