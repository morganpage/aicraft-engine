# Sprite animation samples

Sample `.json` + `.png` pairs that exercise the sprite-animation pipeline
(`src/sprites/`). One JSON + one PNG defines every character/animation in a
game, mirroring how one `.ldtk` + a tileset defines a whole level.

## `kenney-1bit.json`

The character cast from Kenney's **1-Bit Platformer** pack (CC0), driven off
the single packed sheet
[`monochrome_tilemap_transparent_packed.png`](../../vendor/kenney-1-bit-platformer/Tilemap/monochrome_tilemap_transparent_packed.png)
(320×320, 16px tiles, 20×20 grid). The sheet mingles terrain, items, and
characters; this file references only the character tiles via
`meta.grid` + tile-index `frameTags`, and groups them into three
`characters[]`:

| Character | Anims | Tile-index ranges (20-col grid) |
|-----------|-------|---------------------------------|
| `player`  | `idle`, `walk`, `jump`, `fall` | idle/walk rows 16-17 cols 0-5 (320-325), jump/fall row 17 (343, 345) |
| `slime`   | `idle`, `walk` | rows 12-13 cols 0-6 (240-246, 260-266) |
| `walker`  | `idle`, `walk` | rows 18-19 cols 0-6 (360-366, 380-386) |

> The 1-bit pack ships **no** per-frame metadata or animation tables — only
> the packed grid PNG. These index ranges were derived by inspecting the
> sheet's character block (rows 12-19, cols 0-6) and grouping visually similar
> tiles into cycles. **Refine them by eye** against the sheet if a frame
> reads wrong; the engine consumes any valid ranges, so editing this file is
> the only step needed.

The `player` character also maps the physics-derived anim kinds
(`ascent`/`apex`/`descent` from `deriveSpriteAnimKind`) onto `jump`/`fall`
tags, so the player animates correctly in the air with just four authored
clips.

### Reusing the format

This file is a valid **Aseprite-JSON superset** document. To author your own:

- **From Aseprite/LibreSprite**: tag your frames (`idle`, `walk`, …), export
  "JSON data" alongside the PNG, and drop the file in. The `frames`/`meta`/
  `frameTags` fields are read verbatim — no `meta.grid` needed.
- **For a uniform-grid sheet (Kenney-style)**: omit `frames`, add
  `meta.grid` `{ tileWidth, tileHeight, columns }`, and write `frameTags`
  whose `from`/`to` are tile indices.
- **For multiple characters in one file**: add a top-level `characters[]`
  array mapping each character's semantic keys (`idle`, `walk`, …) to tag
  names.
