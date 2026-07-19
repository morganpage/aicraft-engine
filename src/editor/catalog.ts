/**
 * Prefab catalog for the editor (Pillar 4 — Level Editor Core).
 *
 * A thin registry that maps a stable string key (e.g. `'platform'`) to
 * a {@link CatalogEntry} describing the default `rect` and `props` to
 * use when placing an entity of that kind. The reference editor
 * exposes these as "Add Platform" / "Add Exit" / etc. buttons.
 *
 * All exports are pure data / pure helpers.
 *
 * @module
 */

import type { EntityKind, LevelRect } from '../level/types';
import type { CatalogEntry, EditorOperation, EntityCatalog } from './types';

/**
 * Sensible default rect (in pixels) for each {@link EntityKind} when
 * placed via the catalog. Spawn / exit / trap / hazard / decoration /
 * trigger are 16×16 (one tile); platform / passthrough are 32×16
 * (two tiles wide, matching Spitekeep's typical platform);
 * movingPlatform is 48×16.
 */
const DEFAULT_RECT_BY_KIND: Readonly<Record<EntityKind, LevelRect>> = {
  spawn: { x: 0, y: 0, width: 16, height: 16 },
  exit: { x: 0, y: 0, width: 16, height: 16 },
  platform: { x: 0, y: 0, width: 32, height: 16 },
  passthrough: { x: 0, y: 0, width: 32, height: 16 },
  trap: { x: 0, y: 0, width: 16, height: 16 },
  hazard: { x: 0, y: 0, width: 16, height: 16 },
  decoration: { x: 0, y: 0, width: 16, height: 16 },
  trigger: { x: 0, y: 0, width: 16, height: 16 },
  movingPlatform: { x: 0, y: 0, width: 48, height: 16 },
};

/**
 * Minimal valid `defaultProps` for each {@link EntityKind}. Just enough
 * to satisfy `validateLevel` so an instantiated entry is immediately
 * valid; consumers can override at instantiation time.
 */
const DEFAULT_PROPS_BY_KIND: Readonly<Record<EntityKind, Record<string, unknown>>> = {
  spawn: {},
  exit: { isTrap: false, locked: false },
  platform: {},
  passthrough: {},
  trap: { type: 'spikes', params: {} },
  hazard: {},
  decoration: { sprite: 'default' },
  trigger: { action: 'showHint', params: {} },
  movingPlatform: { speed: 60, path: [{ x: 0, y: 0 }, { x: 48, y: 0 }], loopMode: 'loop' },
};

/**
 * Human-facing display labels for each kind.
 */
const DEFAULT_LABEL_BY_KIND: Readonly<Record<EntityKind, string>> = {
  spawn: 'Spawn Point',
  exit: 'Exit',
  platform: 'Platform',
  passthrough: 'Passthrough Platform',
  trap: 'Trap',
  hazard: 'Hazard',
  decoration: 'Decoration',
  trigger: 'Trigger',
  movingPlatform: 'Moving Platform',
};

/**
 * The shipped default catalog — one entry per {@link EntityKind}.
 *
 * Keys are lowercase-kebab versions of the kind (`'movingPlatform'`
 * becomes `'moving-platform'`). Consumers may assemble their own
 * `EntityCatalog` by spreading this and adding custom entries.
 */
export const DEFAULT_CATALOG: EntityCatalog = {
  entries: {
    spawn: {
      kind: 'spawn',
      label: DEFAULT_LABEL_BY_KIND.spawn,
      defaultRect: DEFAULT_RECT_BY_KIND.spawn,
      defaultProps: DEFAULT_PROPS_BY_KIND.spawn,
    },
    exit: {
      kind: 'exit',
      label: DEFAULT_LABEL_BY_KIND.exit,
      defaultRect: DEFAULT_RECT_BY_KIND.exit,
      defaultProps: DEFAULT_PROPS_BY_KIND.exit,
    },
    platform: {
      kind: 'platform',
      label: DEFAULT_LABEL_BY_KIND.platform,
      defaultRect: DEFAULT_RECT_BY_KIND.platform,
      defaultProps: DEFAULT_PROPS_BY_KIND.platform,
    },
    passthrough: {
      kind: 'passthrough',
      label: DEFAULT_LABEL_BY_KIND.passthrough,
      defaultRect: DEFAULT_RECT_BY_KIND.passthrough,
      defaultProps: DEFAULT_PROPS_BY_KIND.passthrough,
    },
    trap: {
      kind: 'trap',
      label: DEFAULT_LABEL_BY_KIND.trap,
      defaultRect: DEFAULT_RECT_BY_KIND.trap,
      defaultProps: DEFAULT_PROPS_BY_KIND.trap,
    },
    hazard: {
      kind: 'hazard',
      label: DEFAULT_LABEL_BY_KIND.hazard,
      defaultRect: DEFAULT_RECT_BY_KIND.hazard,
      defaultProps: DEFAULT_PROPS_BY_KIND.hazard,
    },
    decoration: {
      kind: 'decoration',
      label: DEFAULT_LABEL_BY_KIND.decoration,
      defaultRect: DEFAULT_RECT_BY_KIND.decoration,
      defaultProps: DEFAULT_PROPS_BY_KIND.decoration,
    },
    trigger: {
      kind: 'trigger',
      label: DEFAULT_LABEL_BY_KIND.trigger,
      defaultRect: DEFAULT_RECT_BY_KIND.trigger,
      defaultProps: DEFAULT_PROPS_BY_KIND.trigger,
    },
    'moving-platform': {
      kind: 'movingPlatform',
      label: DEFAULT_LABEL_BY_KIND.movingPlatform,
      defaultRect: DEFAULT_RECT_BY_KIND.movingPlatform,
      defaultProps: DEFAULT_PROPS_BY_KIND.movingPlatform,
    },
  },
};

/**
 * Helper for consumers to build a custom {@link CatalogEntry}.
 *
 * Fills in sensible defaults for `defaultRect` and `defaultProps`
 * based on `kind`, then overlays any caller-supplied overrides.
 *
 * @example
 * ```ts
 * const entry = createCatalogEntry(
 *   'platform',
 *   'Long Platform',
 *   { width: 96, height: 16 },
 *   { visual: 'cracked' },
 * );
 * ```
 *
 * @param kind          - Entity kind for the prefab.
 * @param label         - Human-facing display label.
 * @param defaultRect   - Optional rect overrides (merged onto the kind default).
 * @param defaultProps  - Optional props overrides (merged onto the kind default).
 * @returns A new {@link CatalogEntry}.
 */
export function createCatalogEntry(
  kind: EntityKind,
  label: string,
  defaultRect?: Partial<LevelRect>,
  defaultProps?: Record<string, unknown>,
): CatalogEntry {
  const baseRect = DEFAULT_RECT_BY_KIND[kind];
  const rect: LevelRect = {
    x: defaultRect?.x ?? baseRect.x,
    y: defaultRect?.y ?? baseRect.y,
    width: defaultRect?.width ?? baseRect.width,
    height: defaultRect?.height ?? baseRect.height,
  };
  const props = { ...DEFAULT_PROPS_BY_KIND[kind], ...defaultProps };
  return { kind, label, defaultRect: rect, defaultProps: props };
}

/**
 * Instantiate a {@link CatalogEntry} at a world-space position.
 *
 * Returns an `addEntity` {@link EditorOperation} that, when applied via
 * `applyOp`, will place an entity of the entry's kind at `at` (the
 * top-left of the entry's `defaultRect`, with width/height preserved).
 *
 * **Does NOT apply the op** — the caller decides whether to apply
 * directly, batch with other ops, or wrap in a transaction.
 *
 * @example
 * ```ts
 * const entry = DEFAULT_CATALOG.entries['platform'];
 * const { op } = instantiateCatalogEntry(entry, { x: 64, y: 32 });
 * const nextState = applyOp(state, op);
 * ```
 *
 * @param entry - Catalog entry to instantiate.
 * @param at    - World-space position for the entity's top-left corner.
 * @returns `{ op }` — an `addEntity` op for `applyOp`.
 */
export function instantiateCatalogEntry(
  entry: CatalogEntry,
  at: { readonly x: number; readonly y: number },
): { readonly op: EditorOperation } {
  const rect: LevelRect = {
    x: at.x,
    y: at.y,
    width: entry.defaultRect.width,
    height: entry.defaultRect.height,
  };
  return {
    op: {
      type: 'addEntity',
      kind: entry.kind,
      rect,
      props: entry.defaultProps,
    },
  };
}
