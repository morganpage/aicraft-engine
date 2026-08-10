# Assets

Sample art and test fixtures consumed by the showcase, the LDtk rules
oracle, and the sprite-animation tests. **Nothing here ships in the npm
tarball** — `package.json` `files` whitelists only `dist/`, `README.md`,
`LICENSE`. These assets exist for development, testing, and as copy-into-
your-game starters.

All third-party art is CC0 or public domain unless noted. See `THIRD_PARTY.md`
at the repo root for the full attribution list.

## What's here

### `ldtk/samples/` — LDtk rule oracle + showcase samples (vendored from deepnight/ldtk)
Load-bearing: `src/tests/ldtk-rules-oracle.test.ts` re-derives every tile
(20,046 across 360 rules) and demands an exact match against LDtk's own
baked output; the showcase editor glob also reads these.
- `*.ldtk` (13 projects) + `SeparateLevelFiles/*.ldtkl` (3) + `externEnums.txt`
  — MIT-licensed LDtk sample projects by Sébastien Bénard, from
  https://github.com/deepnight/ldtk (`app/extraFiles/samples`).
- `atlas/Cavernas_by_Adam_Saltsman.png` — Adam Saltsman, public domain
  (https://adamatomic.itch.io/cavernas).
- `atlas/Inca_front_by_Kronbits-extended.png`, `atlas/Inca_back2_by_Kronbits.png`
  — Kronbits, CC0/public domain (https://kronbits.itch.io/inca-game-assets).
- `atlas/SunnyLand_by_Ansimuz-extended.png` — Ansimuz, CC0
  (https://ansimuz.itch.io/sunny-land-pixel-game-art).
- `atlas/monochrome_tilemap_transparent_packed.png` — Kenney 1-bit, CC0
  (intentional copy of `vendor/kenney-1-bit-platformer/Tilemap/`; both used).
- `atlas/TopDown_by_deepnight.png` — Sébastien Bénard, **no explicit per-asset
  licence; retained as test-fixture only, NOT for showcase promotion** (see
  `THIRD_PARTY.md`).

### `sprites/samples/` — sprite-animation manifests
- `kenney-1bit.json` — Aseprite-JSON-superset manifest, references
  `vendor/kenney-1-bit-platformer/Tilemap/monochrome_tilemap_transparent_packed.png`.
- `knight-0x72.json` — references `vendor/0x72/0x72_DungeonTilesetII_v1.7.png`.

### `vendor/` — third-party tilesets (only what's consumed is vendored)
- `0x72/0x72_DungeonTilesetII_v1.7.png` + `LICENSE.txt` — 0x72, CC0
  (https://0x72.itch.io/dungeontileset-ii).
- `kenney-1-bit-platformer/{License.txt, Tilemap/monochrome_tilemap_transparent_packed.png}`
  — Kenney, CC0 (https://kenney.nl/assets/bit-platformer).
- `kenney-pixel-platformer/{License.txt, Tilemap/tilemap_packed.png}` — Kenney,
  CC0 (https://kenney.nl/assets/pixel-platformer). Only the packed sheet is
  vendored; the full upstream pack is not (re-download from kenney.nl if needed).
