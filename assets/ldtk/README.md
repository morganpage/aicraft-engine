# Bundled LDtk tilesets

Starter tilesets shipped with the engine so that levels rendered through the
LDtk pipeline look good out of the box. These are consumed by the showcase and
may be copied verbatim into consumer games.

All assets here are **public domain or CC0** — freely redistributable,
including commercial use, with no attribution required. Per-asset provenance
and license are recorded below and in the engine's top-level `THIRD_PARTY.md`.

## Why bundle these

The engine's LDtk pipeline (`src/ldtk/`) renders `.ldtk` levels whose
auto-tiling was already resolved by the LDtk editor at save time. Bundling
known-good tilesets means the showcase and any consumer can render a level
without first sourcing art — and the art is legally safe to ship.

## Assets

| Path | Author | License | Source |
| --- | --- | --- | --- |
| `sunny-land/SunnyLand_by_Ansimuz.png` | Ansimuz | CC0 1.0 Universal | [ansimuz.itch.io/sunny-land-pixel-game-art](https://ansimuz.itch.io/sunny-land-pixel-game-art) |
| `cavernas/Cavernas_by_Adam_Saltsman.png` | Adam Saltsman | Public domain | [adamatomic.itch.io/cavernas](https://adamatomic.itch.io/cavernas) |
| `inca/Inca_front_by_Kronbits.png` | Kronbits | CC0 / public domain | [kronbits.itch.io/inca-game-assets](https://kronbits.itch.io/inca-game-assets) |

These three were chosen from LDtk's own bundled sample tilesets
([`deepnight/ldtk` `app/extraFiles/samples/atlas`](https://github.com/deepnight/ldtk/tree/master/app/extraFiles/samples/atlas))
specifically because their licenses permit redistribution in a general-purpose
engine without constraints.

## Deliberately excluded

The following LDtk sample assets are **not** bundled because their licenses are
incompatible with an unrestricted engine distribution:

- **`NuclearBlaze_by_deepnight`** — CC-BY-SA 4.0. Share-alike + attribution
  requirements make it unsuitable for bundling in a permissive engine. Do not
  add it here without a separate licensing decision.
- **`Beach by deepnight` / `TopDown by deepnight`** — authored by Sébastien
  Bénard with no explicit per-asset license file. Arguably covered by LDtk's
  top-level MIT, but treated as sample-only out of caution. Seek explicit
  clearance before bundling.

## Sample projects

`samples/` holds LDtk's own sample projects, vendored from
[`deepnight/ldtk` `app/extraFiles/samples`](https://github.com/deepnight/ldtk/tree/master/app/extraFiles/samples).
They are **test fixtures**, not showcase art, and they exist for one reason: each
file carries both the inputs to auto-tiling (an IntGrid plus the rules that skin
it) *and* the tiles LDtk itself baked from that pairing. That makes every file a
correctness oracle for `src/ldtk/rules.ts` — see
`src/tests/ldtk-rules-oracle.test.ts`.

Together they cover 360 rules exercising every auto-layer feature: all pattern
sizes, Single and Stamp modes, flips, checker, modulo, out-of-bounds values,
optional rule groups, biome gating, `chance`, Perlin gating, and multi-tile
alternatives.

`samples/atlas/` holds only the tilesets those projects reference. Note that
`SunnyLand_by_Ansimuz-extended.png` is a *different image* from
`sunny-land/SunnyLand_by_Ansimuz.png` above — different dimensions, so the two
are not interchangeable when resolving a sample's tile coordinates.

Pruned from the upstream sample set: `thumbs/` (preview images, unused),
`NuclearBlaze_by_deepnight.aseprite` (CC-BY-SA 4.0 — see the exclusions above),
`Beach by deepnight.png` and `classicAutoTiles.aseprite` (unreferenced), and the
two `WorldMap_*` projects (4.2 MB; multi-world support is out of scope and they
were verified to add no auto-layer feature coverage the others lack).

## LDtk itself

The [LDtk editor](https://ldtk.io) is MIT-licensed
([`deepnight/ldtk` LICENSE](https://github.com/deepnight/ldtk/blob/master/LICENSE)).
We redistribute its sample art (under the terms above), not the editor itself.
Authors download LDtk separately to author `.ldtk` files.
