# Level visuals persistence decision

**Status:** Deferred — keep visual themes outside `LevelData` for the current
release.

## Decision

Do not add `LevelVisuals`, `themeId`, or `visualSeed` to the serialized level
schema yet. Consumers supply a `LevelRenderTheme` directly and keep editor
preview selection as presentation state.

The Phase 5 playground therefore treats all of the following as non-persistent:

- Art versus Collision preview;
- selected Ruins, Cavern, or Mechanical theme;
- thumbnail dimensions and presentation mode.

These switches do not call the editor reducer, do not enter undo history, and do
not mutate `LevelData`.

## Fallback behavior

Consumers expose their own `LevelThemeOption[]` and resolve a requested id with
`resolveLevelThemeOption`:

1. use the exact requested id when available;
2. otherwise use the consumer's explicit fallback id;
3. otherwise use the first supplied option;
4. return `null` when no options exist.

There is deliberately no global theme registry.

## Why persistence is deferred

One showcase proves the authoring workflow, but it does not establish that a
theme belongs to level content rather than game, biome, campaign, or runtime
configuration. Persisting an uncertain ownership boundary would immediately
expand the versioned contract across migration, validation, serialization,
editor operations, generated content, and downstream games.

Direct theme injection already supports rendering, previews, thumbnails, and
fallbacks without that schema cost.

## Revisit criteria

Reconsider persistence only after at least two independent game consumers need
the level file itself to choose its visual theme. An approved schema change must
ship together with:

- a versioned migration and default for old levels;
- validation for missing and unknown ids;
- serialization round-trip tests;
- editor operations and undo semantics for changing the persisted value;
- generator behavior;
- runtime fallback behavior;
- documentation stating whether `visualSeed` is level-owned or game-owned.

Until those requirements are met, theme selection remains consumer-owned
presentation state.
