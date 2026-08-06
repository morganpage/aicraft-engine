# Dual-grid terrain authoring implementation record

Status: complete. Governing plan: `dual-grid-terrain-authoring-plan.md`.

## Delivered product path

The showcase Tile Room is the full reference workspace. It opens in Edit mode,
uses named terrain-kind logical tools, renders the derived dual grid, and switches
to the platformer runtime without remounting the level. Inspect opens the reusable
material/mask/variant source tile. Global source painting is the default; local
occurrence editing is an explicitly labeled advanced mode.

The workspace includes logical Pencil, Erase, Line, Rectangle, Fill, Picker,
gesture history, material selection, dual/logical overlays, matching-occurrence
highlighting, explicit zoom and scrollbar-free Fit. No wheel listener is attached.

The art panel includes procedural controls and presets; 16–128px confirmed
resolution migration; layers with visibility, order, opacity, clipping, and reset;
literal and palette-linked colors; Pencil, inherit Eraser, Eyedropper, Line,
Rectangle, Ellipse, Fill, Select/Move, Flip, Rotate, and Stamp; brush sizes;
onion skin; seam context; scoped revert; and art-only undo/redo.

Materials use ordered, disjoint corner contributions and a union-world contour.
Grass/meadow, rock, metal, and water presets can coexist. Deleting an in-use
material requires and applies a replacement. Hard/contour transition rules are
versioned source data.

Variants use coordinate-addressed weighted selection with mask/exposure filters.
Seed rerolls affect unpinned occurrences; local pins are explicit source records.
Local overrides record expected mask and variant, are classified active/stale/
orphaned/hidden, and support rebind, hide/show, delete, one-off revert, and bulk
revert. Unsafe overrides are preserved, diagnosed, and excluded.

Source persistence is canonical, hashed, migrated, validated, bounded, and wrapped
in never-throw storage adapters. Runtime compilation emits deterministic variant
atlases with extrusion gutters and a manifest. Editor/runtime pixel equality is
tested. PNG/contact-sheet export uses a host encoder; the showcase provides direct
PNG download. `aicraft-engine/terrain-art/editor` is a separate optional DOM
entrypoint; the runtime leaf bundle excludes all editor/authoring modules.

## Verification map

- Phase 0 artifacts and performance baselines: `benchmarks/terrain-art/` and
  `dual-grid-terrain-authoring-baseline.md`.
- Source, coverage, seams, compositor, serialization: `terrain-art-project`,
  `terrain-art-coverage`, `terrain-art-layers`, and `terrain-art-atlas` tests.
- Logical editing, 625 material combinations, variants, overrides, migration,
  storage, compiler gutters, and editor/runtime equality:
  `terrain-art-pipeline.test.ts`.
- Hit testing and source provenance: `terrain-art-hit-test.test.ts`.
- Manual runs, inherit semantics, transforms, and generator survival:
  `terrain-art-manual-paint.test.ts` and `terrain-art-pixel-tools.test.ts`.
- Baked renderer and viewport culling: `terrain-art-runtime.test.ts`.
- Runtime bundle isolation: `npm run check:terrain-art-runtime-size`.
- Development and deliberate UGC integration examples: `examples/`.

Unrelated humanoid work present in the worktree was preserved and is outside this
implementation record.
