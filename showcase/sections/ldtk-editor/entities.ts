/**
 * Entity palette and instance construction for the LDtk editor.
 *
 * The library's `addLdtkEntity` deliberately takes a fully-formed instance
 * (identity and field defaults come from the host's id policy and the entity
 * definition, not anything the library can derive deterministically). This
 * module owns that construction: turn a `LdtkEntityDef` into a placeable
 * instance, decide which entity defs the palette should show for a layer, and
 * hit-test a pointer against the entities on a layer.
 *
 * Everything here is pure over plain data — no `Math.random`, no `Date.now` —
 * so a given def at a given cell always produces the same instance (modulo the
 * caller-supplied iid). That is what makes placement undoable and testable.
 */

import type {
  LdtkEntityDef,
  LdtkEntityInstance,
  LdtkFieldInstance,
  LdtkLayerInstance,
  LdtkProject,
} from '../../../src/ldtk';

/**
 * Build a fresh entity instance from its definition, ready for
 * {@link addLdtkEntity}.
 *
 * In LDtk `px` is the position of the entity's *pivot point* (not its
 * top-left), and `__grid` is the cell containing that pivot. Placement puts the
 * pivot at the clicked cell's top-left corner, so `__grid` comes out exactly
 * `[cx, cy]` — predictable for the author — and the visible offset follows the
 * def's pivot the same way LDtk itself renders. `iid` is supplied by the caller;
 * it must be stable per placement and unique within the project.
 */
export function entityInstanceFromDef(
  def: Readonly<LdtkEntityDef>,
  cell: { cx: number; cy: number },
  gridSize: number,
  iid: string,
): LdtkEntityInstance {
  const pivotX = def.pivotX ?? 0;
  const pivotY = def.pivotY ?? 0;
  // The pivot sits at the clicked cell's top-left; px stores that pivot point.
  const px = cell.cx * gridSize;
  const py = cell.cy * gridSize;
  return {
    __identifier: def.identifier,
    defUid: def.uid,
    iid,
    __tags: [...def.tags],
    px: [px, py],
    width: def.width,
    height: def.height,
    __grid: [Math.floor(px / gridSize), Math.floor(py / gridSize)],
    __pivot: [pivotX, pivotY],
    __tile: def.tileRect === null
      ? null
      : {
        tilesetUid: def.tileRect.tilesetUid,
        x: def.tileRect.x,
        y: def.tileRect.y,
        w: def.tileRect.w,
        h: def.tileRect.h,
      },
    fieldInstances: fieldInstancesFromDefs(def),
  };
}

/**
 * Seed field values from the def's `fieldDefs`.
 *
 * `defaultOverride` is honoured when present; otherwise each type falls back to
 * a sensible empty value so LDtk does not reject the instance on reload.
 */
function fieldInstancesFromDefs(def: Readonly<LdtkEntityDef>): LdtkFieldInstance[] {
  return def.fieldDefs.map((field) => ({
    __identifier: field.identifier,
    defUid: field.uid,
    __type: field.__type,
    __value: field.isArray
      ? (Array.isArray(field.defaultOverride) ? field.defaultOverride : [])
      : (field.defaultOverride ?? defaultValueForType(field.__type)),
  }));
}

/** A per-type empty value, used when the def declares no default override. */
function defaultValueForType(type: string): unknown {
  if (type.startsWith('F_Int') || type.startsWith('F_Float')) return 0;
  if (type.startsWith('F_Bool')) return false;
  return ''; // String / Enum / Multilines / FilePath / Color / Point fall back to empty.
}

/**
 * A palette entry: the def plus whatever the panel needs to render it.
 *
 * Computed once when a layer is selected; cheap to read on every render.
 */
export interface EntityPaletteEntry {
  readonly def: LdtkEntityDef;
  /** True when at least one instance of this def already exists on the layer. */
  readonly used: boolean;
}

/**
 * The palette entries for an Entities layer.
 *
 * `defs.entities` is project-global and the engine's layer-def subset does not
 * model the "restrict to one entity" linkage, so the palette offers every
 * project entity definition. The `used` flag marks which are already placed on
 * the layer, so an author can tell at a glance what the level contains.
 */
export function paletteForLayer(
  project: Readonly<LdtkProject>,
  layer: Readonly<LdtkLayerInstance> | undefined,
): readonly EntityPaletteEntry[] {
  if (layer === undefined || layer.__type !== 'Entities') return [];
  const usedIds = new Set(
    (layer.entityInstances ?? []).map((e) => e.defUid),
  );
  return project.defs.entities.map((def) => ({ def, used: usedIds.has(def.uid) }));
}

/** A pointer hit on an entity instance, resolved to its iid. */
export function entityAtPoint(
  layer: Readonly<LdtkLayerInstance> | undefined,
  px: number,
  py: number,
): LdtkEntityInstance | undefined {
  if (layer === undefined) return undefined;
  // Topmost-first: later instances draw over earlier ones, so a click where two
  // overlap belongs to the one painted on top.
  for (let i = (layer.entityInstances ?? []).length - 1; i >= 0; i--) {
    const e = (layer.entityInstances ?? [])[i];
    // `px` is the pivot, not the corner — back it out to the rect's top-left
    // before hit-testing, or a bottom-pivot entity is only grabbable below it.
    const x = e.px[0] - (e.__pivot[0] ?? 0) * e.width;
    const y = e.px[1] - (e.__pivot[1] ?? 0) * e.height;
    if (px >= x && px <= x + e.width && py >= y && py <= y + e.height) return e;
  }
  return undefined;
}

/**
 * A fresh, unique iid for a new instance on a level.
 *
 * Monotonic per level: the count never goes backwards, so two placements in the
 * same session can never collide. Built from the level iid plus a counter so it
 * is also unique across levels without a global registry. No randomness.
 */
export function nextEntityIid(levelIid: string, count: number): string {
  // LDtk iids are 8 hex chars; mimic the shape without pretending to be one.
  const tag = (count + 1).toString(16).padStart(4, '0').slice(-4);
  return `${levelIid.slice(0, 8)}-${tag}`;
}

/** Count every entity instance across a level, for iid allocation. */
export function levelEntityCount(
  layerInstances: readonly Readonly<LdtkLayerInstance>[] | null,
): number {
  if (layerInstances === null) return 0;
  let n = 0;
  for (const layer of layerInstances) {
    n += layer.entityInstances?.length ?? 0;
  }
  return n;
}
