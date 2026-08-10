# Third-party notices

This engine is zero-dependency at runtime. The assets below live under
`assets/` for the showcase, the LDtk rules oracle, and the sprite-animation
tests; they are not part of the compiled library (`dist/`). The published
package ships `dist/` alone, so nothing under `assets/` reaches consumers via
npm.

## LDtk sample atlas tilesets

Vendored under `assets/ldtk/samples/atlas/`. See
[`assets/README.md`](assets/README.md) for the master index. All are public
domain or CC0 — no attribution required, freely redistributable including
commercially.

| Asset | Author | License |
| --- | --- | --- |
| `Cavernas_by_Adam_Saltsman.png` | Adam Saltsman | Public domain |
| `SunnyLand_by_Ansimuz-extended.png` | Ansimuz | CC0 1.0 Universal |
| `Inca_front_by_Kronbits-extended.png` | Kronbits | CC0 / public domain |
| `Inca_back2_by_Kronbits.png` | Kronbits | CC0 / public domain |

Sourced from LDtk's bundled sample tilesets at
<https://github.com/deepnight/ldtk/tree/master/app/extraFiles/samples/atlas>.

> Note: the `SunnyLand_by_Ansimuz-extended.png` and `Inca_front_by_Kronbits-extended.png`
> atlas variants are *different images* (different dimensions) from the
> upstream non-extended originals. The non-extended starter copies that once
> lived under `assets/ldtk/{sunny-land,inca,cavernas}/` were removed in the
> 2026-08-10 asset audit — they duplicated the atlas and were unreferenced.

## LDtk sample projects (test fixtures)

`assets/ldtk/samples/*.ldtk` are mostly LDtk's own sample projects, vendored
from the MIT-licensed [`deepnight/ldtk`](https://github.com/deepnight/ldtk)
repository. Those serve as the correctness oracle for the auto-layer rule
engine (`src/ldtk/rules.ts`) and are referenced only by tests. The exception is
`Typical_1-bit_platformer.ldtk`, an LDtk-authored level that ships a
clean-licensed tileset into the showcase (see the Kenney entry below).

`assets/ldtk/samples/atlas/TopDown_by_deepnight.png` is authored by Sébastien
Bénard with no explicit per-asset license. It is retained **as a test fixture
only** because `Typical_TopDown_example.ldtk` references it. It is not showcase
art and is not redistributed: the published package ships `dist/` alone, so
nothing under `assets/` reaches consumers. Do not promote it to showcase use
without explicit clearance.

`NuclearBlaze_by_deepnight.aseprite` (CC-BY-SA 4.0) and
`Beach by deepnight.png` were deliberately **not** retained.

## LDtk (the editor)

The [LDtk level editor](https://ldtk.io) by Sébastien Bénard is licensed under
the [MIT License](https://github.com/deepnight/ldtk/blob/master/LICENSE). This
engine does **not** redistribute LDtk itself — only its CC0/PD sample art
(above) and a parser for its `.ldtk` JSON file format. Authors download LDtk
separately to author levels.

The `.ldtk` file format is plain JSON documented at
<https://ldtk.io/json/>. Parsing it is unrestricted.

## Kenney — Pixel Platformer

`assets/vendor/kenney-pixel-platformer/` contains assets from
[Kenney's "Pixel Platformer" pack](https://kenney.nl/assets/pixel-platformer),
licensed under CC0 (public domain). Only the packed sheet is vendored
(`Tilemap/tilemap_packed.png` + `License.txt`); the rest of the upstream pack
(unpacked per-tile PNGs, Tiled/Construct 3 project files, previews) was removed
in the 2026-08-10 asset audit as unreferenced. Used by the tileset-import
showcase panel; re-download from kenney.nl if the full pack is needed.

## Kenney — 1-Bit Platformer

`assets/vendor/kenney-1-bit-platformer/` contains the packed tileset sheet from
[Kenney's "1-Bit Platformer" pack](https://kenney.nl/assets/bit-platformer),
licensed under CC0 (public domain). Only the transparent packed sheet is
vendored (`Tilemap/monochrome_tilemap_transparent_packed.png`, 320×320 at 16px
tiles); it is consumed by the LDtk editor showcase panel via the
`Typical_1-bit_platformer.ldtk` sample.

## 0x72 — Dungeon Tileset II

`assets/vendor/0x72/` contains `0x72_DungeonTilesetII_v1.7.png` from
[0x72's "Dungeon Tileset II"](https://0x72.itch.io/dungeontileset-ii), licensed
under [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/)
(per the vendored `LICENSE.txt`). It is the showcase sprite-animation sample
for the full-color LDtk 2D platformer — consumed via
`assets/sprites/samples/knight-0x72.json` as the playable knight
(see `showcase/tests/knight-0x72-sprites.test.ts`).
