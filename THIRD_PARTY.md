# Third-party notices

This engine is zero-dependency at runtime. The assets below are bundled under
`assets/ldtk/` for the showcase and for consumer convenience; they are not part
of the compiled library (`dist/`).

## LDtk sample tilesets

Bundled under `assets/ldtk/`. See [`assets/ldtk/README.md`](assets/ldtk/README.md)
for the per-asset breakdown. All are public domain or CC0 — no attribution
required, freely redistributable including commercially.

| Asset | Author | License |
| --- | --- | --- |
| `SunnyLand_by_Ansimuz.png` | Ansimuz | CC0 1.0 Universal |
| `Cavernas_by_Adam_Saltsman.png` | Adam Saltsman | Public domain |
| `Inca_front_by_Kronbits.png` | Kronbits | CC0 / public domain |

Sourced from LDtk's bundled sample tilesets at
<https://github.com/deepnight/ldtk/tree/master/app/extraFiles/samples/atlas>.

## LDtk sample projects (test fixtures)

`assets/ldtk/samples/*.ldtk` are LDtk's own sample projects, vendored from the
MIT-licensed [`deepnight/ldtk`](https://github.com/deepnight/ldtk) repository.
They serve as the correctness oracle for the auto-layer rule engine
(`src/ldtk/rules.ts`) and are referenced only by tests.

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
licensed under CC0 (public domain). Used by the legacy tileset-import showcase
panel; being superseded by the LDtk pipeline.
