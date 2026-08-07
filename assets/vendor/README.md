# Vendored third-party assets

Art that ships from outside this repository. Each pack keeps its own upstream
licence file; this table records where it came from and under what terms.

| Pack | Source | Licence | Retrieved |
|---|---|---|---|
| `kenney-pixel-platformer/` | <https://kenney.nl/assets/pixel-platformer> | CC0 1.0 Universal | 2026-08-03 |
| `kenney-1-bit-platformer/` | <https://kenney.nl/assets/bit-platformer> | CC0 1.0 Universal | 2026-08-07 |

## Kenney — Pixel Platformer

CC0 1.0 (<http://creativecommons.org/publicdomain/zero/1.0/>) per the pack's own
`License.txt`: usable for personal, educational, and commercial work, with
attribution appreciated but not required. Crediting "Kenney" or "www.kenney.nl"
is the maintainers' stated preference and costs nothing.

`Tilemap/tilemap_packed.png` is 360×162 with **18×18** tiles, 20 columns, no
margin and no spacing.

The terrain block is laid out as four columns — capped both sides, capped left,
uncapped, capped right — rather than as a 3×3 square:

| Rows | Contents |
|---|---|
| 0–1 | grass surface, two variants |
| 2–3 | sand surface, two variants |
| 4–5 | snow surface, two variants |
| 6 | body: left edge, interior, right edge |
| 7 | body with a bottom cap: bottom-left, bottom, bottom-right |

`kenneyPixelPlatformerRoles()` in `src/terrain-art/import-tileset.ts` maps that
into the nine roles the quarter-tile importer needs. The pack has no
inner-corner tiles, which is fine — dual-grid assembly never needs them.

## Kenney — 1-Bit Platformer

CC0 1.0 (<http://creativecommons.org/publicdomain/zero/1.0/>) per the pack's own
`License.txt`, same terms as Pixel Platformer above.

Only `Tilemap/monochrome_tilemap_transparent_packed.png` is vendored: it is
**320×320** with **16×16** tiles — a 20×20 grid of 400 tiles, no margin and no
spacing. The `_transparent_` variant has an alpha channel (ink is opaque white
on transparency); the non-transparent `monochrome_tilemap_packed.png` fills
every cell's background solid and the unpacked `monochrome_tilemap.png` adds
1px spacing between tiles, so neither suits LDtk's grid import.

The full stock archive (the ~400 individual tile PNGs, Tiled `.tsx`/`.tmx`,
Construct 3 `.c3p`) is deliberately not vendored — the LDtk pipeline only ever
imports the packed sheet, so the rest would be dead weight. A copy of the
original archive lives at <https://kenney.nl/assets/bit-platformer>.

The sheet is also copied to
`assets/ldtk/samples/atlas/monochrome_tilemap_transparent_packed.png` so the
bundled `Typical_1-bit_platformer.ldtk` sample can resolve its `relPath`, and is
consumed by the LDtk editor showcase panel.
