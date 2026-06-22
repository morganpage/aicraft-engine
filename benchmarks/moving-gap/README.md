# Moving Gap Platform Primitive Benchmark

This directory contains the visual benchmark sample sheet for the **moving-gap-on-platform** primitive. It serves as the visual-QA verification that the "void is never standable" invariant holds by construction.

## Visual Artifacts

- **`sample-sheet.png`**: The primary composite sheet showing all 6 test scenes side-by-side across their respective frames.

---

## The 6 Test Scenes Explained

The benchmark renders 6 distinct scenes, each testing a specific aspect of the geometry and motion APIs:

1. **`sweep` (Sweep left → right)**:
   - **Frames**: 6 frames.
   - **What it shows**: The gap sweeping smoothly across the platform span.
   - **Invariant Verification**: Frame 4 (labeled `centerX=480 (4/6)`) contains three player overlays:
     - Left player: Standing safely on the left solid fragment.
     - Center player: Falling through the gap (rendered in red inside the void).
     - Right player: Standing safely on the right solid fragment.
     - This visually confirms that a player can stand safely on the remaining solid pieces while another falls through the gap in the exact same frame.

2. **`chase` (Chase mode)**:
   - **Frames**: 2 frames.
   - **What it shows**: 
     - Frame 1: The gap actively chasing the player's target position.
     - Frame 2: The player has escaped past the `giveUpRadius` (200px), and the gap disengages and holds its position.

3. **`expand` (Expand mode)**:
   - **Frames**: 5 frames.
   - **What it shows**: The gap width growing linearly from `minWidth` (16px) to `maxWidth` (128px) over a 60-tick cycle, then resetting.

4. **`edge-full-void` (Edge: gap ≥ span)**:
   - **Frames**: 1 frame.
   - **What it shows**: `gapWidth = span.width` (720px).
   - **Invariant Verification**: The entire span is rendered as void (dark fill). There are **exactly 0 solid fragments** generated. No stray solid slivers or rounding artifacts exist.

5. **`edge-no-gap` (Edge: gap ≤ 0)**:
   - **Frames**: 2 frames.
   - **What it shows**: `gapWidth = 0` and `gapWidth = -50`.
   - **Invariant Verification**: In both cases, the entire span is rendered as **1 full-span solid fragment** with no void fill at all.

6. **`edge-clamp` (Edge: centerX clamp)**:
   - **Frames**: 4 frames.
   - **What it shows**: 
     - Frame 1: Gap flush left (`centerX = span.x + half`).
     - Frame 2: Gap flush right (`centerX = span.x + span.width - half`).
     - Frame 3: Absurd left center (`centerX = -9999`).
     - Frame 4: Absurd right center (`centerX = +9999`).
   - **Invariant Verification**: In all 4 frames, the gap sits perfectly flush at the left or right edge of the span. It **never extends past the span outline**, and the void fill is entirely contained within the platform box. The out-of-bounds centers are clamped perfectly to the boundaries.

---

## Load-Bearing Invariant Verification

This benchmark visually proves the core architectural goal of the primitive: **the void is never standable**.

By separating **motion** (ideal center) from **geometry** (clamped fragments), and putting the clamp inside the geometry helper (`gapSolids`), we guarantee that:
1. The physical collision fragments are always perfectly aligned with the clamped gap.
2. The visual renderer (which queries the same clamped geometry) can never desync from the physics.
3. Pathological inputs (like negative widths, huge gaps, or absurd coordinates) are handled gracefully by construction.

For the full clamp algorithm details, see `docs/design/moving-gap-proposal.md`. For the physics and gravity-first resolution context, see `docs/research/moving-gap-platform.md`.

---

## How to Reproduce / Re-render

To regenerate the sample sheet, run the following command from the workspace root:

```bash
npx tsx benchmarks/_scripts/moving-gap-render.ts
```

This script is 100% deterministic. Because the library and prototype code use pure mathematical calculations and seeded RNG, re-running the script will produce byte-identical PNG outputs.
