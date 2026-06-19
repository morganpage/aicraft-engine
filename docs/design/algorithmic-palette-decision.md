# Decision: Algorithmic Palette (`src/palette/`)

**Status:** APPROVED — proceeds to TDD implementation.
**Post-implementation note:** The `FEATURE_CHROMA = 0.15` cap was ratified by the benchmark sample sheet (visually confirmed feature still pops vividly; mathematically necessary for the lightness-only repair to reach WCAG AA — higher chroma traps the feature in a mid-luminance band, leaving `feature`/`base` unrepairable for some seeds).
**Inputs:** `docs/research/algorithmic-palette-substitution.md` · `docs/design/algorithmic-palette-proposal.md` · architect critique (**APPROVED**, no revision loop) · benchmark pending (sample sheet to follow implementation as visual QA).

## Decision

Adopt a **5-slot semantic `Palette`** (`outline`, `base`, `accent`, `feature`, `background`), resolved per-skin from a base + overrides. Build color manipulation in **OKLCH** (perceptually uniform — preserves contrast under hue rotation; ~54-line zero-dep sRGB↔OKLCH conversion, composing the existing `src/primitives/color.ts`, not duplicating it). Generate variant palettes via **harmonic hue rotation** seeded by `mulberry32`. Repair WCAG AA violations with a **fixed 8-iteration binary search** on OKLCH lightness — the same fixed-iter determinism discipline as the IK solvers (never a `while`/convergence-epsilon loop). All public output rounds to 8-bit `#rrggbb` hex, absorbing float LSB differences across JS engines/CPUs.

This module is the **canonical color contract** that the cosmetics pillar (Phase 2b) embeds — `SkinPreset.palette` will be exactly this `Palette` type, with these slot names.

## Architect adjudications (locked)
- **Q1 — Slot model:** Fixed 5-slot (NOT the hybrid extras-bag). The palette is the color *theme*, not the part catalog; per-part coloring is the draw callback's job via `shade()`. YAGNI; adding a 6th slot later is a minor breaking change and the library has no consumers yet.
- **Q2 — accent vs base:** Do NOT contrast-check (both are fills; over-constrains generation).
- **Q3 — `repairContrast`:** Export standalone (legitimate hand-authored-palette use case; pure, precomputed-not-per-frame).
- **Q4 — `GenerationConfig` defaults:** Correct for character skins; JSDoc notes UI/card alternatives (`baseChroma: 0.08`, `baseLightness: 0.7`).

## Architect pre-implementation notes (folded into the coder's brief)
1. `oklchToRgb` JSDoc must warn about gamut/hue-shift and `@see MAX_CHROMA` (~0.35 safe upper bound).
2. `repairContrast` "never throws" JSDoc qualified: throws on malformed hex (programmer error, inheriting `parseHex`'s contract), never for valid input.
3. `GenerationStrategy` and `ContrastRepairOptions` live in `types.ts` (shared across modules/consumers), not in their function files.
4. **Cross-engine determinism test:** a golden-value test — generate seed 42, assert exact hex output (anchors the float-transcendental concern: `Math.pow`/`atan2`/`cos` sub-ULP variation must be absorbed by hex rounding).

## Determinism discipline
- Fixed 8-iter contrast repair (mirrors `IK_*_DEFAULT_ITERATIONS`). `generatePalette` uses `mulberry32`, never `Math.random`. No `Date.now()`. Pure functions throughout; palette sits in the **deterministic core** (no `ctx`/DOM — contrast with `animation/skin.ts` which is renderer-adjacent). Contrast repair is **precomputed at generation/load**, never per-frame. The simulation never reads color values (architecture boundary).

## What was rejected
- **HSL** for variation (perceptually non-uniform — hue rotation spikes perceived brightness and breaks contrast).
- **Chroma-reduction gamut mapping** (adds a `while` loop = determinism hazard; unnecessary since generation stays chroma ≤ 0.35, in-gamut; simple clamp suffices for the low-fi aesthetic).
- **Hybrid extras-bag slot model** (two access patterns, dumping ground, breaks automated repair).
- **Cosine-gradient / full-jitter generation** (semantically opaque / chaotic — harmonic rotation is aesthetically cohesive).
- Re-implementing hex/contrast math (must compose `color.ts`).
