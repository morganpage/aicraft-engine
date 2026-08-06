# Dual-grid terrain authoring baseline

This records the reproducible Phase 0 baseline for the implementation governed by
`dual-grid-terrain-authoring-plan.md`.

## Locked conventions

- Logical grid origin is top-left; data is row-major.
- A dual cell is centered on one logical-grid vertex.
- Bits are clockwise: north-west `1`, north-east `2`, south-east `4`, south-west `8`.
- World placement is `(dualX * tileSize - tileSize / 2, dualY * tileSize - tileSize / 2)`.
- Roundness `0` is genuinely square. Fill coverage owns the silhouette; contour,
  shading, clipping, and manual-layer clipping derive from it.
- Page scrolling never changes editor zoom. The room is visible before Play.

## Preserved MVP behavior

- The generated and topology fixtures remain selectable.
- Dual Grid is the default treatment and Fallback remains available.
- Play uses the platformer runtime; Escape restores authoring state.
- Clicking art reports mask, source pixel, material contribution, and all four
  logical source cells.

The old ad-hoc stroked corner path was deliberately discarded because it gave
roundness zero a rounded concave corner and allowed contour width to change the
apparent fill radius.

## Reproducible artifacts

Run `npm run benchmark:terrain-art`. It writes labeled-layout mask contact sheets
and `baseline.json` beneath `benchmarks/terrain-art/` for 16, 32, 48, 64, 96,
and 128-pixel authoring resolutions. The baseline records atlas generation time,
runtime compilation time, canonical source bytes, and raw atlas bytes.

The July 2026 reference run generated a 64px atlas in roughly 36ms and compiled
its guttered runtime atlas in roughly 38ms on the development machine. The empty
manual-art source was about 3KB; raw 64px RGBA atlas data was 256KB. These are
diagnostic baselines, not cross-machine pass/fail thresholds.

`npm run check:terrain-art-runtime-size` performs a real Vite/Rollup leaf bundle
of the baked runtime renderer. The reference run is about 3.3KB minified across
two modules. The check fails above 12KB or if reference-editor, factory,
compositor, manual-paint, or project-operation modules enter the runtime graph.

## Regression coverage

- all masks and rotational symmetry;
- square zero-roundness;
- convex/concave contour agreement;
- fill-radius independence from contour width;
- deterministic serialization and rendering;
- logical/dual hit testing;
- exhaustive 625 empty/four-material corner combinations;
- sparse manual edits, inherit erasing, transforms, resolution migration;
- deterministic variants, occurrence drift exclusion, storage, and runtime gutters.
