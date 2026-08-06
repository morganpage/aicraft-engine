# Tile-room import resolution

## Status: resolved — imported art stays at its NATIVE resolution

An earlier version of this document proposed "snapping" an imported tileset to
the level grid by resampling its source PNG at apply time (e.g. Kenney's 18px
pack down to a 16px level). That approach was **built and then reverted**.
Pixel art is authored at a specific resolution and must be drawn 1:1; any
resample — whether an explicit downsample step or the renderer scaling 18→16 at
draw time — destroys hand-authored pixels. This document records why the snap
was wrong and what the correct contract is.

## The real problem

When the imported-tileset feature first shipped, imported art looked blurry and
corrupted on the level canvas. Two separate causes were initially conflated:

1. **The main canvas never set `imageSmoothingEnabled`.** The tile-room canvas
   is scaled by DPR (`ctx.scale(dpr, dpr)`) and drew with the browser's default
   bilinear filter, so every `drawImage` was soft — including a 1:1 16→16 draw.
   Every other pixel-art canvas in the showcase already set smoothing off; the
   main canvas was the lone holdout.
2. **The "snap" fix proposed resampling 18→16.** This traded the bilinear blur
   for a nearest-neighbour downscale, which is *also* destructive: it drops and
   duplicates source pixels at a non-integer ratio (18/16), visibly corrupting
   the art. A pixel-perfect regression test confirmed the resample produced
   faithful *palette* colors but mangled the spatial arrangement of pixels.

## The fix

Two changes, both required, neither a resample:

1. **`ctx.imageSmoothingEnabled = false` on the main tile-room canvas**, set once
   at init right after the DPR scale. Pixel art draws nearest-neighbour through
   the DPR scale, matching every other canvas in the section.
2. **Imported materials keep their native `resolution` and binding `tileSize`.**
   The atlas is assembled 1:1 from the source pixels. The library resolver keeps
   its no-resample contract; the showcase feeds it the original image under the
   original `assetId`, never a resampled derivative.

For a level whose grid size matches the tileset's native size, the renderer
draws each source pixel exactly once. For a level whose grid size differs, the
renderer scales — but that scaling is the level's presentation choice (drawn
with smoothing off), not a mutation of the stored artwork. If pixel-perfect
output is required, author the level at the tileset's native tile size.

## What was removed

- `resampleTerrainArtTilesetImage`, `createImportedTilesetAssetId`,
  `parseImportedTilesetAssetId` — deleted from `src/terrain-art/import-tileset.ts`
  and its barrel. There is no resample step in the library.
- The snap machinery in `showcase/sections/tile-room-tileset-import.ts`:
  `planTileRoomTilesetImportApply`, `resolveImportedSheetLayout`,
  `resampledImages`, `ensureResampledAsset`, and `getLevelTileSize` on the host.
  `onApply` now builds the material at the sheet's native `tileSize` directly.

## Verification

`showcase/tests/tile-room-tileset-import-pixels.test.ts` loads the real Kenney
PNG and asserts, at the pixel level, that:

- every opaque pixel in the assembled atlas appears verbatim in the source
  sheet (no invented/blended colors — a resample would fail this), and
- a native-resolution level renders an interior cell byte-identical to its atlas
  tile (0 mismatches).

This is the test that catches any future drift back toward a resample.
