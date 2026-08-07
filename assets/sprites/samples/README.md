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

## `knight-0x72.json`

The armored knight from 0x72's **DungeonTileset II** (CC0), driven off the
single sheet
[`0x72_DungeonTilesetII_v1.7.png`](../../vendor/0x72/0x72_DungeonTilesetII_v1.7.png)
(512×512, 16px tiles, 32×32 grid). Used as the **player** for the full-color
LDtk 2D platformer sample (`Typical_2D_platformer_example.ldtk`). The 1-bit
platformer sample keeps the Kenney player + slime/walker mobs from
`kenney-1bit.json`; the two samples use disjoint sprite sets. Defines one
character:

| Character | Anims | Tile-index ranges (32-col grid) |
|-----------|-------|---------------------------------|
| `knight`  | `idle`, `walk`, `jump`, `fall` | idle 296, walk 296-297, jump 301, fall 304 (row 9) |

Two differences from the Kenney sheet:

- **Full-color, not tinted.** The 0x72 sheet is RGBA pixel art, not 1-bit white
  ink, so the knight is drawn **without** a tint — `playerTintFor` returns
  `undefined` for a `colored: true` bundle and `drawSprite` blits the raw pixels.
  The Kenney `source-in` recolor path would flatten the knight to a flat
  silhouette.
- **Top-down source art.** The DungeonTileset II is a top-down dungeon crawler
  tileset, so the knight frames are top-down poses (the selected row-9 frames
  face toward the camera). In the side-scrolling platformer the knight reads as
  facing the viewer rather than running in profile — recognizable as a knight,
  but not a true side-view run/jump cycle. The frames were chosen from the
  face-camera row for the clearest silhouette.

> Like the Kenney entry above, these tile indices were derived by slicing the
> sheet (programmatically — the sheet has irregular spacing and no published
> index map) and **refining by eye**. If a frame reads wrong, editing this file
> is the only step needed; the engine consumes any valid ranges. Guarded by
> `showcase/tests/knight-0x72-sprites.test.ts`.

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
