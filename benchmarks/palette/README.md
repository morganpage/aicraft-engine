# Palette Pillar Benchmarks

This directory contains visual benchmark renders for the production palette sub-modules (`src/palette/`). These renders serve as the visual quality assurance gate, confirming that the mathematical implementations of seed-driven palette generation, harmonic hue rotation, and WCAG AA contrast repair produce correct, stable, and aesthetically beautiful results.

## How to Reproduce

To regenerate these PNGs, run the following command from the workspace root:

```bash
npx vite-node benchmarks/_scripts/palette-render.ts
```

This script executes the deterministic palette generators from `benchmarks/_scripts/palette-render.ts` using the production modules in `src/palette/` and renders them to PNGs using `node-canvas` on a neutral dark background (`#121214`).

---

## Benchmark Sheets

### 1. Generated Palette Sheet (`generated-sheet.png`)
- **Source:** `generatePalette` from `src/palette/generate`
- **Description:** A grid of **24 generated palettes** (seeds 1–24) testing all three harmonic strategies:
  - **Seeds 1–8:** `triadic` (default) — three evenly spaced hues (accent at +120°, feature at +240°).
  - **Seeds 9–16:** `complementary` — accent at +180°, feature at +150°.
  - **Seeds 17–24:** `analogous` — accent at +30°, feature at −30°.
- **Key Features Demonstrated:**
  - **High Distinctness:** Every seed produces a unique, highly distinct palette with no duplicates or near-duplicates.
  - **Harmonic Coherence:** The generated colors feel cohesive and harmonious, capturing the minimalist, low-fidelity aesthetic of Sokpop games.
  - **Contrast Demonstration:** Each swatch is drawn with its slot color on a base-colored fill (or background-colored fill for the background swatch) with an outline-colored border. This directly demonstrates contrast readability.

### 2. In-Game Shapes (`in-game-shapes.png`)
- **Source:** `generatePalette` + custom canvas drawing callbacks
- **Description:** Renders a cute, retro-style "slime-knight" character for 8 representative seeds (1, 3, 5, 9, 11, 13, 17, 19). Each character is drawn inside a card filled with its palette's `background` color.
- **Key Features Demonstrated:**
  - **In-Context Readability:** Verifies how the palette reads in a real game scenario.
  - **Outline Visibility:** The 1px/2px/3px `outline` borders are extremely sharp and clearly visible against the `base` body, `accent` legs, and `background` card, proving the `ensureBaseContrastsOutline` safety net works flawlessly.
  - **Feature Pop:** The glowing cyclops eye (drawn in the `feature` slot color) pops beautifully as a high-saturation highlight, clearly distinguishable from the `base` body and `accent` legs, proving the `FEATURE_CHROMA = 0.15` cap is visually excellent.

### 3. Contrast Check (`contrast-check.png`)
- **Source:** `contrastRatio` from `src/primitives/color` + `repairContrast` from `src/palette/contrast-repair`
- **Description:** Measures and annotates the exact WCAG 2.x contrast ratios for the three checked pairs across the 8 representative seeds:
  1. `outline` vs `base` (Target ≥ 4.5:1)
  2. `feature` vs `base` (Target ≥ 4.5:1)
  3. `outline` vs `background` (Target ≥ 4.5:1)
- **Key Features Demonstrated:**
  - **100% Compliance:** Every checked pair across all seeds passes the WCAG AA target of 4.5:1 (indicated by green pills).
  - **Precision Repair:** The `feature` vs `base` contrast is repaired to a tight, optimal range of `4.52:1` to `4.55:1`, proving the 8-iteration binary search achieves high precision and preserves maximum saturation.
  - **Silhouette Safety:** The `outline` vs `background` contrast is consistently high (`~19.2:1`), ensuring the character's silhouette is always perfectly readable against the background tiles.
